// ==============================================================================
// 🎂 SAORI BIRTHDAY MODULE (DrakesCraft Network)
// Mensajes interactivos, botones, modales y celebración automatizada
// ==============================================================================

const fs = require('fs');
const path = require('path');
const { 
    EmbedBuilder, 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle 
} = require('discord.js');

const DATA_FILE = path.join(__dirname, 'data', 'birthdays.json');

const MESES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const DIAS_POR_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function parseMonth(str) {
    if (!str) return null;
    const clean = str.toString().trim().toLowerCase();
    const num = parseInt(clean, 10);
    if (!isNaN(num) && num >= 1 && num <= 12) return num;
    const names = {
        'ene': 1, 'enero': 1,
        'feb': 2, 'febrero': 2,
        'mar': 3, 'marzo': 3,
        'abr': 4, 'abril': 4,
        'may': 5, 'mayo': 5,
        'jun': 6, 'junio': 6,
        'jul': 7, 'julio': 7,
        'ago': 8, 'agosto': 8,
        'sep': 9, 'sept': 9, 'septiembre': 9, 'setiembre': 9,
        'oct': 10, 'octubre': 10,
        'nov': 11, 'noviembre': 11,
        'dic': 12, 'diciembre': 12
    };
    return names[clean] || null;
}

class BirthdayManager {
    constructor(client, channelId, jackId) {
        this.client = client;
        this.channelId = channelId;
        this.jackId = jackId || '425816911679094784';
        this.birthdays = this.loadData();
    }

    loadData() {
        try {
            if (!fs.existsSync(DATA_FILE)) {
                fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2), 'utf8');
                return {};
            }
            const content = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(content || '{}');
        } catch (err) {
            console.error('[BIRTHDAYS] Error cargando birthdays.json:', err.message);
            return {};
        }
    }

    saveData() {
        try {
            const dir = path.dirname(DATA_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const tmpFile = DATA_FILE + '.tmp';
            fs.writeFileSync(tmpFile, JSON.stringify(this.birthdays, null, 2), 'utf8');
            fs.renameSync(tmpFile, DATA_FILE);
            return true;
        } catch (err) {
            console.error('[BIRTHDAYS] Error guardando birthdays.json:', err.message);
            return false;
        }
    }

    isValidDate(day, month, year) {
        if (!Number.isInteger(day) || !Number.isInteger(month)) return false;
        if (month < 1 || month > 12) return false;
        if (day < 1 || day > DIAS_POR_MES[month - 1]) return false;

        if (month === 2 && day === 29 && year) {
            const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
            if (!isLeap) return false;
        }

        if (year !== null && year !== undefined) {
            const currentYear = new Date().getFullYear();
            if (year < 1920 || year > currentYear - 3) return false;
        }

        return true;
    }

    setBirthday(userId, username, day, month, year = null) {
        if (!this.isValidDate(day, month, year)) {
            return { success: false, error: 'Fecha inválida. Verifica el día (1-31), mes (1-12) y año ingresados.' };
        }

        this.birthdays[userId] = {
            username,
            day,
            month,
            year: year || null,
            updatedAt: new Date().toISOString(),
            lastCelebratedYear: this.birthdays[userId]?.lastCelebratedYear || null
        };

        this.saveData();
        return { success: true, day, month, year };
    }

    removeBirthday(userId) {
        if (!this.birthdays[userId]) return false;
        delete this.birthdays[userId];
        this.saveData();
        return true;
    }

    getBirthday(userId) {
        return this.birthdays[userId] || null;
    }

    getCurrentSantiagoTime() {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Santiago',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        const parts = formatter.formatToParts(now);
        const map = {};
        for (const p of parts) map[p.type] = p.value;
        return {
            year: parseInt(map.year, 10),
            month: parseInt(map.month, 10),
            day: parseInt(map.day, 10),
            hour: parseInt(map.hour, 10),
            minute: parseInt(map.minute, 10)
        };
    }

    calculateDaysUntil(day, month) {
        const santiago = this.getCurrentSantiagoTime();
        const currentYear = santiago.year;

        let target = new Date(Date.UTC(currentYear, month - 1, day));
        const today = new Date(Date.UTC(currentYear, santiago.month - 1, santiago.day));

        if (target < today) {
            target = new Date(Date.UTC(currentYear + 1, month - 1, day));
        }

        const diffTime = target - today;
        return Math.round(diffTime / (1000 * 60 * 60 * 24));
    }

    calculateAge(year) {
        if (!year) return null;
        const santiago = this.getCurrentSantiagoTime();
        return santiago.year - year;
    }

    getUpcoming(limit = 10) {
        const list = [];
        for (const [userId, data] of Object.entries(this.birthdays)) {
            const daysLeft = this.calculateDaysUntil(data.day, data.month);
            list.push({
                userId,
                ...data,
                daysLeft
            });
        }

        list.sort((a, b) => a.daysLeft - b.daysLeft);
        return list.slice(0, limit);
    }

    buildInteractivePanelEmbed() {
        const totalRegistered = Object.keys(this.birthdays).length;

        const embed = new EmbedBuilder()
            .setTitle('🎂 Pᴀɴᴇʟ Iɴᴛᴇʀᴀᴄᴛɪᴠᴏ ᴅᴇ Cᴜᴍᴘʟᴇᴀñᴏs · DʀᴀᴋᴇsCʀᴀғᴛ')
            .setColor(0xF39C12) // Oro cálido
            .setDescription(
                `¡Bienvenido al sistema comunitario de celebraciones de **DrakesCraft Network**! 🎉\n\n` +
                `SAORI se encarga de recordar cada cumpleaños de nuestra comunidad a las **00:00 hrs**, publicando un homenaje con privilegios del Olimpo, humor del servidor y bendiciones especiales.\n\n` +
                `### 📋 Opciones Rápidas:\n` +
                `• **🎂 Registrar mi Cumpleaños:** Abre el formulario interactivo para guardar tu fecha.\n` +
                `• **🔍 Ver mi Cumpleaños:** Consulta tu fecha guardada y la cuenta regresiva.\n` +
                `• **📅 Próximos Cumpleaños:** Cartelera con los cumpleañeros que vienen.\n` +
                `• **🗑️ Borrar:** Desvincula tu fecha del sistema.\n\n` +
                `👥 **Miembros registrados:** \`${totalRegistered}\` cumpleañeros listos para festejar.`
            )
            .addFields(
                { name: '✨ ¿Qué incluye tu festejo?', value: 'Homenaje público en este canal, cálculo de edad, bendiciones del servidor, tarta simbólica y reacciones festivas de la comunidad.', inline: false }
            )
            .setFooter({ text: 'S.A.O.R.I. · Inteligencia y Convivencia DrakesCraft', iconURL: this.client.user.displayAvatarURL() })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_cumple_registrar')
                .setLabel('Registrar / Actualizar')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🎂'),
            new ButtonBuilder()
                .setCustomId('btn_cumple_ver')
                .setLabel('Ver mi Cumple')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔍'),
            new ButtonBuilder()
                .setCustomId('btn_cumple_proximos')
                .setLabel('Próximos')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('📅'),
            new ButtonBuilder()
                .setCustomId('btn_cumple_borrar')
                .setLabel('Borrar')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️')
        );

        return { embed, row };
    }

    async ensureChannelPanel() {
        try {
            const channel = await this.client.channels.fetch(this.channelId).catch(() => null);
            if (!channel) return;

            const messages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
            if (messages) {
                const existing = messages.find(m => m.author.id === this.client.user.id && m.embeds[0]?.title?.includes('Pᴀɴᴇʟ Iɴᴛᴇʀᴀᴄᴛɪᴠᴏ ᴅᴇ Cᴜᴍᴘʟᴇᴀñᴏs'));
                if (existing) {
                    const { embed, row } = this.buildInteractivePanelEmbed();
                    await existing.edit({ embeds: [embed], components: [row] }).catch(() => {});
                    console.log('[BIRTHDAYS] ✅ Panel interactivo de cumpleaños actualizado en el canal.');
                    return;
                }
            }

            const { embed, row } = this.buildInteractivePanelEmbed();
            const panelMsg = await channel.send({ embeds: [embed], components: [row] });
            await panelMsg.pin().catch(() => {});
            console.log('[BIRTHDAYS] ✅ Panel interactivo de cumpleaños publicado y fijado.');
        } catch (err) {
            console.error('[BIRTHDAYS] Error publicando panel interactivo en canal:', err.message);
        }
    }

    generateCelebrationMessage(userId, data) {
        const age = data.year ? this.calculateAge(data.year) : null;
        const ageText = age ? (' (' + age + ' años de leyenda)') : '';

        const TITLES = [
            '🎉 ¡ALERTA OLÍMPICA: HOY CUMPLE AÑOS <@' + userId + '>! 🎂',
            '🌟 ¡Día Histórico en DrakesCraft: Feliz Cumpleaños <@' + userId + '>! 🥳',
            '👑 ¡Hagan sonar las campanas del Spawn! Hoy cumple <@' + userId + '> 🎂',
            '✨ ¡Un año más de aventuras y victorias para <@' + userId + '>! 🎁',
            '🔥 ¡El Reino de Hefesto está de fiesta por el natalicio de <@' + userId + '>! 🎈'
        ];

        const INTROS = [
            'Hoy toda la comunidad de **DrakesCraft Network** se une en un solo clamor para desearte el más extraordinario de los cumpleaños.',
            'En este día tan especial celebramos tu presencia, tu buena energía y cada momento compartido en el servidor.',
            'Desde las profundidades del Nether hasta la cima del Olimpo, hoy todos los dioses y aldeanos festejan tu vida.',
            'Es un honor y una inmensa alegría para todos nosotros tenerte en la comunidad un año más.'
        ];

        const HILARIOUS_PERKS = [
            '🥔 **Decreto Supremo de la Papatrueque:** Por hoy, tus papas se cotizan como lingotes de Netherita y Jack prometió no nerfear tu economía por 24 horas.',
            '⚡ **Protocolo Anti-Lag:** SAORI ha solicitado formalmente a los servidores que hoy el TPS permanezca en 20.0 y que los cables de Slimefun no colapsen en tu honor.',
            '🛡️ **Inmunidad Diplomática:** El Staff ha recibido órdenes de posponer cualquier sanción o mute; hoy tus travesuras cuentan como *festejos oficiales*.',
            '🍰 **Tarta de Hefesto:** Los herreros del Olimpo intentaron forjarte un pastel en el Magic Basin... ¡milagrosamente sobrevivió sin quemar la base!',
            '🌾 **Bendición Agrícola:** Tus semillas en Cultivation tienen hoy un 100% de probabilidad mágica de crecer 10.10.10 sin mutar a maleza.',
            '⛏️ **Regalo de las Tuneladoras:** Las terrabores de IDreamOfEasy cavaron un conducto subterráneo directo al Olimpo para traerte suministros infinitos.',
            '✨ **Seguro contra el Vacío:** Se te concede la bendición de caer en el End y rebotar como si hubiera camas invisibles (por favor no lo pruebes en Survival).',
            '🎶 **Coro de Aldeanos:** Un grupo selecto de clérigos y herreros del spawn ha ensayado el \'¡Hrmmm!\' de cumpleaños más afinado y festivo jamás escuchado.'
        ];

        const CLOSINGS = [
            'Que este nuevo año de vida venga cargado de salud, proyectos cumplidos, diamantes en abundancia y momentos inolvidables tanto dentro como fuera del juego. ¡Te queremos un montón! 💖',
            'Disfruta muchísimo tu día con tu familia, tus seres queridos y por supuesto con tu familia de DrakesCraft. ¡A comer mucha tarta y festejar como te mereces! 🥳🎂',
            '¡Que el universo te sonría y que cada meta que te propongas se cumpla! Gracias por formar parte activa del corazón de nuestra comunidad. 🌟',
            'Por muchas más construcciones legendarias, exploraciones compartidas y risas en Discord y Minecraft. ¡Feliz cumpleaños de parte de Jack, el Staff y SAORI! 🥂'
        ];

        const title = TITLES[Math.floor(Math.random() * TITLES.length)];
        const intro = INTROS[Math.floor(Math.random() * INTROS.length)];
        const perk1 = HILARIOUS_PERKS[Math.floor(Math.random() * HILARIOUS_PERKS.length)];
        let perk2 = HILARIOUS_PERKS[Math.floor(Math.random() * HILARIOUS_PERKS.length)];
        while (perk2 === perk1) {
            perk2 = HILARIOUS_PERKS[Math.floor(Math.random() * HILARIOUS_PERKS.length)];
        }
        const closing = CLOSINGS[Math.floor(Math.random() * CLOSINGS.length)];

        return { title, ageText, intro, perk1, perk2, closing };
    }

    async celebrateUser(userId, data, isTest = false) {
        try {
            const channel = await this.client.channels.fetch(this.channelId).catch(() => null);
            if (!channel) {
                console.error(`[BIRTHDAYS] No se encontró el canal de cumpleaños con ID: ${this.channelId}`);
                return false;
            }

            const member = await channel.guild.members.fetch(userId).catch(() => null);
            const displayName = member ? member.displayName : (data.username || 'Cumpleañero/a');
            const avatarUrl = member ? member.user.displayAvatarURL({ dynamic: true, size: 512 }) : null;

            const msg = this.generateCelebrationMessage(userId, data);

            const embed = new EmbedBuilder()
                .setTitle(`🎂 ¡Fᴇʟɪᴢ Cᴜᴍᴘʟᴇᴀñᴏs, ${displayName.toUpperCase()}!${msg.ageText}`)
                .setColor(0xF1C40F)
                .setDescription(
                    `🎊 **¡Hoy celebramos a lo grande a <@${userId}>!** 🎊\n\n` +
                    `${msg.intro}\n\n` +
                    `### 🎁 Privilegios & Regalos del Olimpo:\n` +
                    `${msg.perk1}\n\n` +
                    `${msg.perk2}\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `${msg.closing}`
                )
                .setFooter({
                    text: isTest ? '🎂 SAORI SRE · Modo Prueba de Celebración' : '🎂 DrakesCraft Network · Celebraciones Oficiales',
                    iconURL: this.client.user.displayAvatarURL()
                })
                .setTimestamp();

            if (avatarUrl) {
                embed.setThumbnail(avatarUrl);
            }

            const sentMessage = await channel.send({
                content: `🥳 ¡Atención comunidad! Hoy es el cumpleaños de <@${userId}>! Dejen sus felicitaciones y amor aquí abajo: 🎉`,
                embeds: [embed]
            });

            const emojis = ['🎂', '🎉', '🥳', '🎁', '💖'];
            for (const emoji of emojis) {
                await sentMessage.react(emoji).catch(() => {});
            }

            if (!isTest) {
                const santiago = this.getCurrentSantiagoTime();
                this.birthdays[userId].lastCelebratedYear = santiago.year;
                this.saveData();
            }

            console.log(`[BIRTHDAYS] ✅ Cumpleaños celebrado exitosamente para ${displayName} (${userId})`);
            return true;
        } catch (err) {
            console.error(`[BIRTHDAYS] Error celebrando cumpleaños de ${userId}:`, err.message);
            return false;
        }
    }

    async checkDailyBirthdays() {
        const santiago = this.getCurrentSantiagoTime();
        console.log(`[BIRTHDAYS] 🕒 Revisando cumpleaños para la fecha ${santiago.day}/${santiago.month}/${santiago.year}...`);

        let celebratedCount = 0;
        for (const [userId, data] of Object.entries(this.birthdays)) {
            if (data.day === santiago.day && data.month === santiago.month) {
                if (data.lastCelebratedYear !== santiago.year) {
                    await this.celebrateUser(userId, data, false);
                    celebratedCount++;
                }
            }
        }

        if (celebratedCount > 0) {
            console.log(`[BIRTHDAYS] 🎊 Se celebraron ${celebratedCount} cumpleaños hoy.`);
        } else {
            console.log(`[BIRTHDAYS] ℹ️ No hay cumpleaños pendientes por celebrar en esta revisión.`);
        }
    }

    startScheduler() {
        console.log('[BIRTHDAYS] 🚀 Inicializando programador diario de cumpleaños (cada 30 min)...');
        setTimeout(() => {
            this.ensureChannelPanel().catch(console.error);
            this.checkDailyBirthdays().catch(console.error);
        }, 10000);

        setInterval(() => {
            this.checkDailyBirthdays().catch(console.error);
        }, 30 * 60 * 1000);
    }
}

function getSlashCommandBuilders() {
    const build = (name) => new SlashCommandBuilder()
        .setName(name)
        .setDescription('🎂 Gestiona y consulta los cumpleaños de la comunidad de DrakesCraft')
        .addSubcommand(sub =>
            sub.setName('panel')
                .setDescription('Muestra el panel interactivo de cumpleaños de SAORI')
        )
        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('Registra o actualiza tu fecha de cumpleaños')
                .addIntegerOption(o => o.setName('dia').setDescription('Día de nacimiento (1-31)').setRequired(true).setMinValue(1).setMaxValue(31))
                .addIntegerOption(o => o.setName('mes').setDescription('Mes de nacimiento (1-12)').setRequired(true).setMinValue(1).setMaxValue(12))
                .addIntegerOption(o => o.setName('ano').setDescription('Año de nacimiento (ej. 2002) - Opcional').setRequired(false).setMinValue(1920).setMaxValue(new Date().getFullYear() - 3))
        )
        .addSubcommand(sub =>
            sub.setName('ver')
                .setDescription('Consulta el cumpleaños de un miembro o el tuyo')
                .addUserOption(o => o.setName('usuario').setDescription('Usuario a consultar (por defecto tú)').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('proximos')
                .setDescription('Muestra la lista de los próximos cumpleaños en DrakesCraft')
        )
        .addSubcommand(sub =>
            sub.setName('borrar')
                .setDescription('Elimina tu fecha de cumpleaños de la base de datos')
        )
        .addSubcommand(sub =>
            sub.setName('test')
                .setDescription('🛡️ Jack / Staff: Fuerza una celebración de prueba en el canal de cumpleaños')
                .addUserOption(o => o.setName('usuario').setDescription('Usuario a celebrar (por defecto tú)').setRequired(false))
        );

    return [build('cumple'), build('scumple')];
}

// Modal interactivo
function buildBirthdayRegistrationModal() {
    const modal = new ModalBuilder()
        .setCustomId('modal_cumple_register')
        .setTitle('🎂 Registrar mi Cumpleaños');

    const diaInput = new TextInputBuilder()
        .setCustomId('dia')
        .setLabel('Día de Nacimiento (1 a 31)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ejemplo: 16')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(2);

    const mesInput = new TextInputBuilder()
        .setCustomId('mes')
        .setLabel('Mes de Nacimiento (1-12 o Nombre)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ejemplo: 9 o Septiembre')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(15);

    const anoInput = new TextInputBuilder()
        .setCustomId('ano')
        .setLabel('Año de Nacimiento (Opcional)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ejemplo: 2002 (Opcional, para calcular edad)')
        .setRequired(false)
        .setMinLength(4)
        .setMaxLength(4);

    modal.addComponents(
        new ActionRowBuilder().addComponents(diaInput),
        new ActionRowBuilder().addComponents(mesInput),
        new ActionRowBuilder().addComponents(anoInput)
    );

    return modal;
}

// Manejador de botones interactivos
async function handleBirthdayButton(interaction, manager) {
    const id = interaction.customId;
    const userId = interaction.user.id;

    if (id === 'btn_cumple_registrar') {
        const modal = buildBirthdayRegistrationModal();
        return await interaction.showModal(modal);
    }

    if (id === 'btn_cumple_ver') {
        const data = manager.getBirthday(userId);
        if (!data) {
            return await interaction.reply({
                content: '❌ Aún no tienes un cumpleaños registrado. Pulsa el botón **🎂 Registrar / Actualizar** para guardarlo en un segundo.',
                ephemeral: true
            });
        }

        const mesNombre = MESES[data.month - 1];
        const anoText = data.year ? ` de ${data.year}` : '';
        const age = data.year ? manager.calculateAge(data.year) : null;
        const daysLeft = manager.calculateDaysUntil(data.day, data.month);

        let countdown = `Faltan **${daysLeft} días** para tu próximo festejo.`;
        if (daysLeft === 0) countdown = '🎉 **¡HOY ES TU CUMPLEAÑOS!** 🥳';

        const embed = new EmbedBuilder()
            .setTitle(`🎂 Tu Cumpleaños Registrado`)
            .setColor(0x3498DB)
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '📅 Fecha Registrada', value: `${data.day} de ${mesNombre}${anoText}`, inline: true },
                { name: '⏳ Cuenta Regresiva', value: countdown, inline: true }
            );

        if (age !== null) {
            embed.addFields({ name: '🌟 Edad Cumplida', value: `${age} años`, inline: true });
        }

        embed.setFooter({ text: 'DrakesCraft Network · Panel Interactivo', iconURL: interaction.client.user.displayAvatarURL() });

        return await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (id === 'btn_cumple_proximos') {
        const upcoming = manager.getUpcoming(10);
        if (upcoming.length === 0) {
            return await interaction.reply({
                content: '📭 Aún no hay cumpleaños registrados en la comunidad. ¡Sé el primero en pulsar **🎂 Registrar**!',
                ephemeral: true
            });
        }

        const lines = upcoming.map((u, i) => {
            const mesNombre = MESES[u.month - 1];
            const when = u.daysLeft === 0 ? '🎉 **¡HOY!**' : `en ${u.daysLeft} días`;
            return `**${i + 1}.** <@${u.userId}> — **${u.day} de ${mesNombre}** (${when})`;
        });

        const embed = new EmbedBuilder()
            .setTitle('📅 Próximos Cumpleaños en DrakesCraft')
            .setColor(0xE67E22)
            .setDescription(lines.join('\n\n'))
            .setFooter({ text: 'DrakesCraft Network · Panel Interactivo', iconURL: interaction.client.user.displayAvatarURL() });

        return await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (id === 'btn_cumple_borrar') {
        const removed = manager.removeBirthday(userId);
        if (!removed) {
            return await interaction.reply({ content: 'ℹ️ No tenías ningún cumpleaños registrado.', ephemeral: true });
        }
        return await interaction.reply({ content: '✅ Tu fecha de cumpleaños ha sido eliminada del sistema.', ephemeral: true });
    }
}

// Manejador de modal submit
async function handleBirthdayModalSubmit(interaction, manager) {
    if (interaction.customId !== 'modal_cumple_register') return false;

    const diaRaw = interaction.fields.getTextInputValue('dia');
    const mesRaw = interaction.fields.getTextInputValue('mes');
    const anoRaw = interaction.fields.getTextInputValue('ano');

    const dia = parseInt(diaRaw.trim(), 10);
    const mes = parseMonth(mesRaw);
    let ano = null;

    if (anoRaw && anoRaw.trim()) {
        ano = parseInt(anoRaw.trim(), 10);
        if (isNaN(ano)) ano = null;
    }

    if (!dia || isNaN(dia) || !mes) {
        return await interaction.reply({
            content: '❌ Error en los datos: Por favor asegúrate de indicar un día válido (1-31) y un mes (1-12 o nombre ej. Septiembre).',
            ephemeral: true
        });
    }

    const userId = interaction.user.id;
    const res = manager.setBirthday(userId, interaction.user.username, dia, mes, ano);

    if (!res.success) {
        return await interaction.reply({ content: `❌ ${res.error}`, ephemeral: true });
    }

    const mesNombre = MESES[mes - 1];
    const anoText = ano ? ` de ${ano}` : '';
    const daysLeft = manager.calculateDaysUntil(dia, mes);
    const daysText = daysLeft === 0 ? '¡Hoy mismo es tu cumpleaños! 🎉' : `Faltan **${daysLeft} días** para tu próximo festejo.`;

    const embed = new EmbedBuilder()
        .setTitle('🎂 ¡Cumpleaños Registrado con Éxito!')
        .setColor(0x2ECC71)
        .setDescription(
            `¡Perfecto, <@${userId}>!\n\n` +
            `He guardado tu fecha: **${dia} de ${mesNombre}${anoText}**.\n` +
            `📅 ${daysText}\n\n` +
            `El día de tu cumpleaños, SAORI publicará automáticamente tu homenaje y regalos en <#${manager.channelId}>.`
        )
        .setFooter({ text: 'DrakesCraft Network · Panel Interactivo', iconURL: interaction.client.user.displayAvatarURL() });

    await interaction.reply({ embeds: [embed], ephemeral: true });

    // Actualiza el contador del panel general
    manager.ensureChannelPanel().catch(() => {});
    return true;
}

async function handleBirthdaySlashCommand(interaction, manager) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === 'panel') {
        const { embed, row } = manager.buildInteractivePanelEmbed();
        return await interaction.reply({ embeds: [embed], components: [row] });
    }

    if (sub === 'set') {
        const dia = interaction.options.getInteger('dia');
        const mes = interaction.options.getInteger('mes');
        const ano = interaction.options.getInteger('ano');

        const res = manager.setBirthday(userId, interaction.user.username, dia, mes, ano);
        if (!res.success) {
            return await interaction.reply({ content: `❌ ${res.error}`, ephemeral: true });
        }

        const mesNombre = MESES[mes - 1];
        const anoText = ano ? ` de ${ano}` : '';
        const daysLeft = manager.calculateDaysUntil(dia, mes);
        const daysText = daysLeft === 0 ? '¡Hoy mismo es tu cumpleaños! 🎉' : `Faltan **${daysLeft} días** para tu próximo festejo.`;

        const embed = new EmbedBuilder()
            .setTitle('🎂 Cumpleaños Guardado con Éxito')
            .setColor(0x2ECC71)
            .setDescription(
                `¡Excelente, <@${userId}>!\n\n` +
                `He registrado tu cumpleaños para el **${dia} de ${mesNombre}${anoText}**.\n` +
                `📅 ${daysText}\n\n` +
                `Cuando llegue tu día especial, SAORI enviará una felicitación única y llena de sorpresas en <#${manager.channelId}>.`
            )
            .setFooter({ text: 'DrakesCraft Network · Sistema de Cumpleaños', iconURL: interaction.client.user.displayAvatarURL() });

        return await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'ver') {
        const targetUser = interaction.options.getUser('usuario') || interaction.user;
        const data = manager.getBirthday(targetUser.id);

        if (!data) {
            const isSelf = targetUser.id === userId;
            const msg = isSelf
                ? '❌ Aún no has registrado tu cumpleaños. Usa `/cumple set [dia] [mes] [año]` o pulsa el botón del panel.'
                : `❌ <@${targetUser.id}> aún no ha registrado su fecha de cumpleaños.`;
            return await interaction.reply({ content: msg, ephemeral: true });
        }

        const mesNombre = MESES[data.month - 1];
        const anoText = data.year ? ` de ${data.year}` : '';
        const age = data.year ? manager.calculateAge(data.year) : null;
        const daysLeft = manager.calculateDaysUntil(data.day, data.month);

        let countdown = `Faltan **${daysLeft} días** para su próxima fiesta.`;
        if (daysLeft === 0) countdown = '🎉 **¡HOY ES SU CUMPLEAÑOS!** 🥳';

        const embed = new EmbedBuilder()
            .setTitle(`🎂 Cumpleaños de ${targetUser.username}`)
            .setColor(0x3498DB)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '📅 Fecha Registrada', value: `${data.day} de ${mesNombre}${anoText}`, inline: true },
                { name: '⏳ Cuenta Regresiva', value: countdown, inline: true }
            );

        if (age !== null) {
            embed.addFields({ name: '🌟 Edad Cumplida', value: `${age} años`, inline: true });
        }

        embed.setFooter({ text: 'DrakesCraft Network · Sistema de Cumpleaños', iconURL: interaction.client.user.displayAvatarURL() });

        return await interaction.reply({ embeds: [embed] });
    }

    if (sub === 'proximos') {
        const upcoming = manager.getUpcoming(10);
        if (upcoming.length === 0) {
            return await interaction.reply({
                content: '📭 Aún no hay cumpleaños registrados en la comunidad. ¡Sé el primero en usar `/cumple set`!',
                ephemeral: true
            });
        }

        const lines = upcoming.map((u, i) => {
            const mesNombre = MESES[u.month - 1];
            const when = u.daysLeft === 0 ? '🎉 **¡HOY!**' : `en ${u.daysLeft} días`;
            return `**${i + 1}.** <@${u.userId}> — **${u.day} de ${mesNombre}** (${when})`;
        });

        const embed = new EmbedBuilder()
            .setTitle('📅 Próximos Cumpleaños en DrakesCraft')
            .setColor(0xE67E22)
            .setDescription(lines.join('\n\n'))
            .setFooter({ text: 'Usa /cumple set para registrar el tuyo', iconURL: interaction.client.user.displayAvatarURL() });

        return await interaction.reply({ embeds: [embed] });
    }

    if (sub === 'borrar') {
        const removed = manager.removeBirthday(userId);
        if (!removed) {
            return await interaction.reply({ content: 'ℹ️ No tenías ningún cumpleaños registrado.', ephemeral: true });
        }
        return await interaction.reply({ content: '✅ Tu fecha de cumpleaños ha sido eliminada del sistema.', ephemeral: true });
    }

    if (sub === 'test') {
        if (interaction.user.id !== manager.jackId) {
            return await interaction.reply({ content: '❌ Solo Jack tiene autorización para forzar pruebas del canal de cumpleaños.', ephemeral: true });
        }

        const targetUser = interaction.options.getUser('usuario') || interaction.user;
        let data = manager.getBirthday(targetUser.id);
        if (!data) {
            data = {
                username: targetUser.username,
                day: new Date().getDate(),
                month: new Date().getMonth() + 1,
                year: 2000
            };
        }

        await interaction.deferReply({ ephemeral: true });
        const ok = await manager.celebrateUser(targetUser.id, data, true);
        if (ok) {
            return await interaction.editReply({ content: `✅ Felicitación de prueba enviada con éxito a <#${manager.channelId}> para <@${targetUser.id}>!` });
        } else {
            return await interaction.editReply({ content: `❌ Error al enviar la celebración de prueba. Revisa los logs.` });
        }
    }
}

module.exports = {
    BirthdayManager,
    getSlashCommandBuilders,
    handleBirthdaySlashCommand,
    handleBirthdayButton,
    handleBirthdayModalSubmit
};

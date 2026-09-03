// SAORI Discord SRE & Support Engine · Full Image Generation with Rate Limiting (3/hour)

require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    ActivityType, 
    EmbedBuilder,
    AttachmentBuilder
} = require('discord.js');
const fetch = require('node-fetch');
const { execFile } = require('child_process');
const fs = require('fs');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const AI_DAEMON_URL = process.env.AI_DAEMON_URL || 'http://127.0.0.1:8089/chat';
const IMAGE_DAEMON_URL = 'http://127.0.0.1:8089/image';
const TTS_URL = 'http://127.0.0.1:8089/tts';
const STT_URL = 'http://127.0.0.1:8089/stt';

const JACK_DISCORD_ID = '493868699489665044';
const CHANNELS = {
    BIENVENIDAS: '1540356407705079879',       // 👋・ʙɪᴇɴᴠᴇɴɪᴅᴀꜱ
    TICKETS_SOPORTE: '1539636904482578482',   // 🎫・ᴛɪᴄᴋᴇᴛs-sᴏᴘᴏʀᴛᴇ
    CATEGORIA_TICKETS: '1539764389530312815', // ᴛɪᴄᴋᴇᴛꜱ
    GENERAL_ES: '1539636493725864037',        // 💬・ɢᴇɴᴇʀᴀʟ-ᴇsᴘᴀñᴏʟ
    STAFF_CHAT: '1539637349284061185',        // 💬・sᴛᴀғғ-ᴄʜᴀᴛ
    TAREAS_PENDIENTES: '1539637422692769802', // 📋・ᴛᴀʀᴇᴀs-ᴘᴇɴᴅɪᴇɴᴛᴇs
    REGLAS: '1539635930577641543',            // 📜・ʀᴇɢʟᴀs-ʏ-ɴᴏʀᴍᴀs
    AUTO_ROLES: '1539636390751502376',        // 🎭・ᴀᴜᴛᴏ-ʀᴏʟᴇs
    SAORI_CHAT: '1544811720571355196'         // 💬・habla-con-saori (Canal exclusivo)
};

const ticketConversations = new Map();
const escalatedTickets = new Set();

// Rate limiting: 3 imágenes por hora por usuario (Jack sin límite)
const userImageTimestamps = new Map(); // userId -> Array<timestamp>

function canGenerateImage(userId, isJack) {
    if (isJack) return { allowed: true };
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    if (!userImageTimestamps.has(userId)) {
        userImageTimestamps.set(userId, []);
    }
    const timestamps = userImageTimestamps.get(userId).filter(t => (now - t) < oneHour);
    userImageTimestamps.set(userId, timestamps);

    if (timestamps.length >= 3) {
        const oldest = timestamps[0];
        const waitMins = Math.ceil((oneHour - (now - oldest)) / (60 * 1000));
        return { allowed: false, waitMins };
    }
    return { allowed: true, count: timestamps.length };
}

function recordImageGenerated(userId) {
    const now = Date.now();
    if (!userImageTimestamps.has(userId)) {
        userImageTimestamps.set(userId, []);
    }
    userImageTimestamps.get(userId).push(now);
}

if (!DISCORD_BOT_TOKEN) {
    console.error('❌ [SAORI-DISCORD] Error: DISCORD_BOT_TOKEN no definido.');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User]
});

async function askSaoriBrain(prompt, sender, context = '') {
    try {
        const fullPrompt = context ? `[Contexto Canal/Ticket: ${context}]\n${prompt}` : prompt;
        const res = await fetch(AI_DAEMON_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: fullPrompt, sender }),
            timeout: 30000
        });
        if (res.ok) {
            const data = await res.json();
            if (data.response) {
                return data.response.trim();
            }
        }
    } catch (e) {
        console.error('[SAORI-DISCORD] Error contactando Saori Brain:', e.message);
    }
    return `Hola ${sender}, estoy procesando datos en Star. Dime qué necesitas.`;
}

async function generateImageViaDaemon(prompt) {
    try {
        const outPath = `/tmp/saori_img_${Date.now()}.png`;
        const res = await fetch(IMAGE_DAEMON_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, out_path: outPath }),
            timeout: 45000
        });
        if (res.ok) {
            const data = await res.json();
            if (data.ok && fs.existsSync(outPath)) {
                return outPath;
            }
        }
    } catch (e) {
        console.error('[SAORI-IMG] Error generando imagen:', e.message);
    }
    return null;
}

async function generateVoiceAudio(text) {
    try {
        const outPath = `/tmp/saori_dc_voice_${Date.now()}.mp3`;
        const res = await fetch(TTS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, out_path: outPath }),
            timeout: 20000
        });
        if (res.ok) {
            const data = await res.json();
            if (data.ok && fs.existsSync(outPath)) {
                return outPath;
            }
        }
    } catch (e) {
        console.error('[SAORI-TTS] Error generando voz:', e.message);
    }
    return null;
}

function dispatchTicketToTriad(title, desc, author, channelName) {
    return new Promise((resolve) => {
        execFile('/usr/bin/python3', ['/home/jack/ai-hub/scripts/dispatch_ticket.py', title, desc, author, channelName], (err, stdout) => {
            if (err) {
                console.error('[SAORI-DISCORD] Error ejecutando dispatch_ticket.py:', err);
                return resolve(null);
            }
            resolve(stdout.trim());
        });
    });
}

// Gestión de roles de Discord
async function handleDiscordManagement(message, cleanPrompt, isJack) {
    const promptLower = cleanPrompt.toLowerCase();

    if (promptLower.includes('crea un rol') || promptLower.includes('crear rol') || promptLower.includes('nuevo rol') || promptLower.includes('crea el rol')) {
        if (!isJack) {
            return `Acceso denegado: Solo Jack puede ordenar la creación o modificación de roles en Discord.`;
        }
        try {
            let roleName = cleanPrompt.replace(/.*(rol|rango)\s+/i, '').replace(/y colocaselo.*/i, '').trim();
            if (!roleName) roleName = "Nuevo Rol";

            const role = await message.guild.roles.create({
                name: roleName,
                color: '#FF69B4',
                reason: `Rol creado automáticamente por SAORI a petición de Jack`
            });

            if (promptLower.includes('colocaselo a jack') || promptLower.includes('ponselo a jack') || promptLower.includes('asignaselo a jack')) {
                const jackMember = await message.guild.members.fetch(JACK_DISCORD_ID).catch(() => null);
                if (jackMember) {
                    await jackMember.roles.add(role);
                    return `Listo Jack, creé el rol **${role.name}** y te lo asigné.`;
                }
            }
            return `Listo Jack, creé el rol **${role.name}**.`;
        } catch (e) {
            return `Error al crear rol: ${e.message}`;
        }
    }

    return null;
}

client.once('ready', () => {
    console.log(`✅ [SAORI-DISCORD] ¡Conectada como ${client.user.tag}! Voice, Images (3/h) & Channel #${CHANNELS.SAORI_CHAT} activos.`);
    client.user.setActivity('DrakesCraft SRE & Soporte 🛡️', { type: ActivityType.Watching });
});

// Bienvenidas automáticas
client.on('guildMemberAdd', async (member) => {
    try {
        const channel = member.guild.channels.cache.get(CHANNELS.BIENVENIDAS) || 
                        await member.guild.channels.fetch(CHANNELS.BIENVENIDAS).catch(() => null);

        if (!channel) return;

        const welcomeEmbed = new EmbedBuilder()
            .setColor(0xE6A8D7)
            .setTitle(`🌸 ¡Bienvenido/a a ⚡ ᴅʀᴀᴋᴇsᴄʀᴀғᴛ ɴᴇᴛᴡᴏʀᴋ ⚡!`)
            .setDescription(`¡Hola ${member}! Soy **SAORI**, la IA del servidor. ✨\n\n` +
                            `Te dejamos unos accesos rápidos:`)
            .addFields(
                { name: '📜 Reglas', value: `<#${CHANNELS.REGLAS}>`, inline: true },
                { name: '🎭 Auto-Roles', value: `<#${CHANNELS.AUTO_ROLES}>`, inline: true },
                { name: '💬 Chat con Saori', value: `<#${CHANNELS.SAORI_CHAT}>`, inline: true },
                { name: '🎮 IP', value: '`play.drakescraft.cl`', inline: false }
            )
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .setFooter({ text: 'DrakesCraft AI SRE · Creada por Jack', iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        await channel.send({ content: `👋 ¡Bienvenido/a ${member}!`, embeds: [welcomeEmbed] });
        console.log(`[SAORI-DISCORD] 🌸 Bienvenida enviada a ${member.user.tag}`);
    } catch (e) {
        console.error('[SAORI-DISCORD] Error enviando bienvenida:', e.message);
    }
});

function normalizeDiscordName(name, fallback = 'amigo') {
    if (!name) return fallback;
    let s = name.replace(/\[.*?\]|\(.*?\)/g, '').replace(/[-–—|].*$/, '').trim();
    const smallCapsMap = {
        'ᴀ':'a','ʙ':'b','ᴄ':'c','ᴅ':'d','ᴇ':'e','ғ':'f','ɢ':'g','ʜ':'h','ɪ':'i','ᴊ':'j',
        'ᴋ':'k','ʟ':'l','ᴍ':'m','ɴ':'n','ᴏ':'o','ᴘ':'p','ǫ':'q','ʀ':'r','s':'s','ᴛ':'t',
        'ᴜ':'u','ᴠ':'v','ᴡ':'w','x':'x','ʏ':'y','ᴢ':'z'
    };
    let res = '';
    for (const ch of s) {
        res += smallCapsMap[ch] || ch;
    }
    // Normalizar fuentes matematicas, cursivas, negritas y diacriticos
    try {
        res = res.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    } catch (e) {}
    res = res.replace(/[^a-zA-Z0-9_]/g, ' ').trim().split(/\s+/)[0];
    if (!res || res.length < 2) {
        return fallback;
    }
    return res.charAt(0).toUpperCase() + res.slice(1);
}

// Gestión de Mensajes y Tickets
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const isDM = !message.guild;
    const isJack = message.author.id === JACK_DISCORD_ID;
    const content = message.content.trim();
    const contentLower = content.toLowerCase();

    // ⚡ COMANDOS RÁPIDOS DE DISCORD (!ip, !web, !tienda, !musica, !bots, !guia)
    if (['!ip', '!server', '!servidor', '!conexion', '!mc', '!port', '!puerto'].includes(contentLower)) {
        const ipEmbed = new EmbedBuilder()
            .setColor(0x00D26A)
            .setTitle('⚡ Conexión a DrakesCraft Network')
            .setDescription('¡Conéctate y juega en la comunidad de DrakesCraft!')
            .addFields(
                { name: '☕ Java Edition', value: 'IP: `mc.drakescraft.cl:25565` *(o `play.drakescraft.cl`)*\nVersiones: `1.20.x - 1.21.x`', inline: false },
                { name: '📱 Bedrock Edition (Móvil / Consolas)', value: 'IP: `mc.drakescraft.cl`\nPuerto: `25565`', inline: false },
                { name: '🌐 Web & Tienda Oficial', value: '[Portal Web](https://web.drakescraft.cl/) · [Tienda de Rangos](https://web.drakescraft.cl/store.html)', inline: false }
            )
            .setFooter({ text: 'DrakesCraft Network · mc.drakescraft.cl', iconURL: client.user.displayAvatarURL() })
            .setTimestamp();
        await message.reply({ embeds: [ipEmbed], allowedMentions: { repliedUser: false } });
        return;
    }

    if (['!web', '!portal', '!pagina'].includes(contentLower)) {
        await message.reply({
            content: `🌐 **Portal Web Oficial de DrakesCraft:** https://web.drakescraft.cl/`,
            allowedMentions: { repliedUser: false }
        });
        return;
    }

    if (['!tienda', '!shop', '!store', '!comprar', '!rangos'].includes(contentLower)) {
        const shopEmbed = new EmbedBuilder()
            .setColor(0xF59E0B)
            .setTitle('🛒 Tienda Oficial de DrakesCraft')
            .setDescription('Adquiere Rangos VIP, Pases de Batalla, Dragmas y beneficios exclusivos para apoyar al servidor.')
            .addFields(
                { name: '🔗 Enlace Directo', value: 'https://web.drakescraft.cl/store.html' },
                { name: '💎 Beneficios', value: '• Rangos VIP, Titan, Dios\n• Desbloqueos y pases cosméticos\n• Activación automática al instante' }
            )
            .setFooter({ text: 'DrakesCraft Store', iconURL: client.user.displayAvatarURL() });
        await message.reply({ embeds: [shopEmbed], allowedMentions: { repliedUser: false } });
        return;
    }

    if (['!guia', '!guias', '!wiki', '!comandos'].includes(contentLower)) {
        await message.reply({
            content: `📚 **Guía Completa de DrakesCraft (Economía, XP, Slimefun y Comandos):** https://web.drakescraft.cl/guia.html`,
            allowedMentions: { repliedUser: false }
        });
        return;
    }

    if (['!musica', '!music', '!cancion', '!song'].includes(contentLower)) {
        const musicEmbed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🎵 Música en DrakesCraft')
            .setDescription('Disfruta de música tanto en Discord como dentro del servidor Minecraft:')
            .addFields(
                { name: '🎧 Bot Chip (Voz)', value: 'Usa `/play <cancion/enlace>` en canales de voz.', inline: true },
                { name: '🎸 Bot Jockie Music (Voz)', value: 'Usa `m!play <cancion/enlace>` en canales de voz.', inline: true },
                { name: '📻 In-Game Jukebox', value: 'Escribe `/musica` dentro de Minecraft para abrir el reproductor musical.', inline: false }
            )
            .setFooter({ text: 'DrakesCraft Music System', iconURL: client.user.displayAvatarURL() });
        await message.reply({ embeds: [musicEmbed], allowedMentions: { repliedUser: false } });
        return;
    }

    if (['!bots', '!botlist'].includes(contentLower)) {
        const botsEmbed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('🤖 Bots Oficiales del Servidor')
            .addFields(
                { name: '🎵 Música', value: '• **Chip** (`/help`)\n• **Jockie Music** (`m!help`)', inline: true },
                { name: '🛡️ Seguridad & Logs', value: '• **Wick** (Seguridad/Anti-Raid)\n• **Quark Logger** (Logs)\n• **ServerStats** (Estadísticas)', inline: true },
                { name: '🎮 Utilidades & Minijuegos', value: '• **Mudae** (`$help` Waifus)\n• **Ticket King** (Tickets)\n• **Zira** (Auto-Roles)\n• **Xenon** (Backups)\n• **SAORI** (IA SRE & Soporte)', inline: true }
            )
            .setFooter({ text: 'DrakesCraft Discord Ecosystem', iconURL: client.user.displayAvatarURL() });
        await message.reply({ embeds: [botsEmbed], allowedMentions: { repliedUser: false } });
        return;
    }

    if (['!ping', '!latencia', '!ms'].includes(contentLower)) {
        const wsPing = client.ws.ping;
        const msgPing = Date.now() - message.createdTimestamp;
        const pingEmbed = new EmbedBuilder()
            .setColor(0x00FF88)
            .setTitle('🏓 Pong! Latencia de SAORI')
            .addFields(
                { name: '🌐 Gateway Discord', value: `\`${wsPing} ms\``, inline: true },
                { name: '⚡ Tiempo de Respuesta', value: `\`${msgPing} ms\``, inline: true },
                { name: '🖥️ Servidor Star', value: '`ONLINE · 192.168.0.120`', inline: true }
            )
            .setFooter({ text: 'SAORI SRE Monitor' });
        await message.reply({ embeds: [pingEmbed], allowedMentions: { repliedUser: false } });
        return;
    }

    // 🧹 LIMPIEZA DE CHAT Y PURGA EN DISCORD (!clear, !purge, o lenguaje natural)
    const isClearRequest = contentLower.startsWith('!clear') || 
                           contentLower.startsWith('!purge') || 
                           contentLower.startsWith('!limpiar') ||
                           anyKeyword(contentLower, ['borra el historial', 'limpia el chat', 'borra los mensajes', 'limpiar chat', 'purga el chat', 'borra este chat', 'limpia este canal', 'limpiar este canal', 'borra el chat']);

    if (isClearRequest) {
        const hasPerm = isJack || (message.member && (message.member.permissions.has('ManageMessages') || message.member.permissions.has('Administrator')));
        if (!hasPerm) {
            await message.reply({ content: '❌ Acceso denegado: Necesitas permisos de **Gestionar Mensajes** o **Administrador** para limpiar el chat.', allowedMentions: { repliedUser: false } });
            return;
        }

        let amount = 50;
        const matchNumber = content.match(/\d+/);
        if (matchNumber) {
            amount = Math.min(parseInt(matchNumber[0], 10), 100);
        }

        try {
            const fetched = await message.channel.messages.fetch({ limit: amount + 1 }).catch(() => null);
            if (fetched && fetched.size > 0) {
                const deleted = await message.channel.bulkDelete(fetched, true).catch(() => null);
                const count = deleted ? deleted.size : fetched.size;
                const confirmMsg = await message.channel.send(`🧹 **Limpieza completada:** Se eliminaron **${count}** mensajes y se restableció el contexto del canal.`);
                setTimeout(() => { confirmMsg.delete().catch(() => {}); }, 5000);
                return;
            }
        } catch (e) {
            console.error('[SAORI-CLEAR] Error en limpieza:', e.message);
            await message.reply({ content: `❌ Error al limpiar mensajes: ${e.message}`, allowedMentions: { repliedUser: false } });
            return;
        }
    }

    const botMentioned = message.mentions.has(client.user);
    const isSaoriDedicatedChannel = message.channel.id === CHANNELS.SAORI_CHAT;

    // Filtro de mensajes ultra cortos
    if (content.length <= 2 || ['xd', 'xdxd', 'lol', 'ok', 'a', 'si', 'no', 'ui', 'wey', 'wena', 'f', 'gg'].includes(contentLower)) {
        if (!botMentioned && !isDM) return;
    }

    const isTicketChannel = message.channel.parentId === CHANNELS.CATEGORIA_TICKETS || 
                            message.channel.id === CHANNELS.TICKETS_SOPORTE || 
                            message.channel.name.startsWith('ticket-') ||
                            message.channel.name.includes('soporte');

    const shouldRespond = isSaoriDedicatedChannel ||
                          isTicketChannel || 
                          isDM || 
                          botMentioned || 
                          contentLower.startsWith('saori') || 
                          contentLower.includes('@saori');

    if (!shouldRespond) return;

    let rawSender = isJack ? 'Jack' : message.author.username;
    if (!isJack && message.member && message.member.displayName) {
        rawSender = message.member.displayName;
    }
    const senderName = isJack ? 'Jack' : normalizeDiscordName(rawSender, message.author.username);

    let cleanPrompt = content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
    if (cleanPrompt.toLowerCase().startsWith('saori')) {
        cleanPrompt = cleanPrompt.replace(/^saori[\s,:]*/i, '').trim();
    }
    
    if (!cleanPrompt || cleanPrompt.length <= 2) {
        if (!isTicketChannel) return;
        cleanPrompt = 'Hola, ¿en qué te puedo ayudar con tu ticket?';
    }

    const contextTag = isTicketChannel ? `Ticket #${message.channel.name}` : (isDM ? 'DM' : `#${message.channel.name}`);
    console.log(`[SAORI-DISCORD] 📨 [${isJack ? 'ADMIN/JACK' : senderName} en ${contextTag}]: ${cleanPrompt}`);

    // Detección de petición de IMAGEN
    const isImageRequest = anyKeyword(cleanPrompt.toLowerCase(), [
        'genera una imagen', 'crea una imagen', 'generar imagen', 'crear imagen', 
        'generate una imagen', 'dibuja', 'dibujame', 'haz una imagen', 'creame una imagen'
    ]);

    if (isImageRequest) {
        const rateCheck = canGenerateImage(message.author.id, isJack);
        if (!rateCheck.allowed) {
            await message.reply({ 
                content: `⏳ Límite alcanzado: Para cuidar los recursos de Star, el límite es de 3 imágenes por hora. Podrás generar otra en aproximadamente **${rateCheck.waitMins} minutos**.`,
                allowedMentions: { repliedUser: false }
            });
            return;
        }

        try {
            await message.channel.sendTyping();
            const promptForImg = cleanPrompt.replace(/.*(imagen|dibuja|dibujame)\s+(de\s+)?/i, '').trim() || cleanPrompt;
            
            const waitingMsg = await message.reply({ 
                content: `🎨 *Pintando y renderizando con los motores de Star...* ✨`,
                allowedMentions: { repliedUser: false }
            });

            const imgPath = await generateImageViaDaemon(promptForImg);
            if (imgPath) {
                recordImageGenerated(message.author.id);
                const attachment = new AttachmentBuilder(imgPath, { name: 'saori_art.png' });
                
                const imgEmbed = new EmbedBuilder()
                    .setColor(0xFF69B4)
                    .setTitle(`🌸 Arte Generado por SAORI`)
                    .setDescription(`**Prompt:** ${promptForImg}`)
                    .setImage('attachment://saori_art.png')
                    .setFooter({ text: `DrakesCraft AI Art · Solicitado por ${senderName}`, iconURL: client.user.displayAvatarURL() });

                await waitingMsg.edit({ content: '', embeds: [imgEmbed], files: [attachment] });
                if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
                console.log(`[SAORI-DISCORD] 🎨 Imagen enviada con éxito.`);
                return;
            } else {
                await waitingMsg.edit({ content: `❌ No se pudo completar la generación en este momento. Intenta de nuevo en unos segundos.` });
                return;
            }
        } catch (e) {
            console.error('[SAORI-DISCORD] Error en flujo de imagen:', e.message);
        }
    }

    // Gestión administrativa en Discord
    const mgmtResponse = await handleDiscordManagement(message, cleanPrompt, isJack);
    if (mgmtResponse) {
        await message.reply({ content: mgmtResponse, allowedMentions: { repliedUser: false } });
        return;
    }

    // RBAC para acciones de servidor
    const isSensitiveAction = content.startsWith('/') || 
                              content.startsWith('!') || 
                              contentLower.includes('reinicia') || 
                              contentLower.includes('apaga') || 
                              contentLower.includes('deten el server') ||
                              contentLower.includes('ejecuta en consola') ||
                              (contentLower.includes('kick') && !isTicketChannel);

    if (isSensitiveAction && !isJack) {
        await message.reply({
            content: `Acceso denegado: Solo Jack tiene autorización para ejecutar órdenes críticas en la infraestructura.`,
            allowedMentions: { repliedUser: false }
        });
        return;
    }

    // Detección de escalado a la Tríada
    if (isTicketChannel && !escalatedTickets.has(message.channel.id)) {
        if (!ticketConversations.has(message.channel.id)) {
            ticketConversations.set(message.channel.id, []);
        }
        const history = ticketConversations.get(message.channel.id);
        history.push({ sender: senderName, text: cleanPrompt, timestamp: Date.now() });

        const totalWords = history.reduce((acc, curr) => acc + curr.text.split(' ').length, 0);
        const hasTechnicalDetails = history.some(m => 
            m.text.length > 50 || 
            anyKeyword(m.text.toLowerCase(), ['bug', 'error', 'falla', 'item', 'mundo', 'isla', 'inventario', 'banco', 'rango', 'slimefun', 'bentobox', 'oneblock', 'skyblock'])
        );

        if (totalWords >= 15 && hasTechnicalDetails) {
            escalatedTickets.add(message.channel.id);
            const fullDescription = history.map(h => `- **${h.sender}:** ${h.text}`).join('\n');
            const ticketTitle = `Soporte en #${message.channel.name} (${senderName})`;
            
            const ticketId = await dispatchTicketToTriad(ticketTitle, fullDescription, senderName, message.channel.name);

            const escalationEmbed = new EmbedBuilder()
                .setColor(0x00FF88)
                .setTitle(`🎫 Ticket #${ticketId || 'SRE'} Desplegado a la Tríada de Agentes 🤖`)
                .setDescription(`He consolidado la información y la he desplegado a los **3 Agentes Autónomos de Star**:\n\n` +
                                `🏛️ **SAORI SRE Engine** · *Telemetría*\n` +
                                `⚡ **Claude-Code** · *Plugins y Lógica*\n` +
                                `🛠️ **Codex Agent** · *Diagnóstico y Ejecución*\n\n` +
                                `_El reporte ya fue emitido al grupo técnico y al panel de Star._ 🚀`)
                .setFooter({ text: 'DrakesCraft Autonomous SRE Fleet', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [escalationEmbed] });
        }
    }

    try {
        await message.channel.sendTyping();
    } catch (e) {}

    const reply = await askSaoriBrain(cleanPrompt, senderName, isTicketChannel ? 'Canal de Ticket de Soporte' : (isSaoriDedicatedChannel ? 'Canal dedicado a hablar con Saori' : ''));

    const wantsAudio = cleanPrompt.toLowerCase().includes('manda audio') || 
                       cleanPrompt.toLowerCase().includes('en audio') || 
                       cleanPrompt.toLowerCase().includes('un audio') ||
                       cleanPrompt.toLowerCase().includes('responde en audio');

    try {
        if (wantsAudio) {
            const audioPath = await generateVoiceAudio(reply);
            if (audioPath) {
                const attachment = new AttachmentBuilder(audioPath, { name: 'saori_voice.mp3' });
                await message.reply({ 
                    content: `🌸 Nota de Voz:`, 
                    files: [attachment],
                    allowedMentions: { repliedUser: false } 
                });
                if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                console.log(`[SAORI-DISCORD] 🎙️ Audio enviado.`);
                return;
            }
        }

        if (message.reference) {
            await message.channel.send({ content: reply });
        } else {
            await message.reply({ content: reply, allowedMentions: { repliedUser: false } });
        }
        console.log(`[SAORI-DISCORD] 📤 Mensaje enviado a Discord.`);
    } catch (e) {
        console.error('[SAORI-DISCORD] Error enviando mensaje:', e.message);
    }
});

function anyKeyword(text, list) {
    return list.some(k => text.includes(k));
}

client.login(DISCORD_BOT_TOKEN).catch(err => {
    console.error('❌ [SAORI-DISCORD] Error al iniciar sesión en Discord:', err.message);
});

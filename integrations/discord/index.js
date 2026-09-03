// SAORI Discord SRE & Support Engine · Channel Purge & Moderation Suite

require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    ActivityType, 
    EmbedBuilder,
    AttachmentBuilder,
    PermissionsBitField,
    AuditLogEvent
} = require('discord.js');
const fetch = require('node-fetch');
const { execFile } = require('child_process');
const fs = require('fs');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const AI_DAEMON_URL = process.env.AI_DAEMON_URL || 'http://127.0.0.1:8089/chat';
const IMAGE_DAEMON_URL = 'http://127.0.0.1:8089/image';
const TTS_URL = 'http://127.0.0.1:8089/tts';
const STT_URL = 'http://127.0.0.1:8089/stt';

process.on('unhandledRejection', (reason, promise) => {
    console.error('[SAORI-DISCORD] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[SAORI-DISCORD] Uncaught Exception:', err);
});


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
    SAORI_CHAT: '1544811720571355196',        // 💬・habla-con-saori (Canal exclusivo)
    MINECRAFT_CHAT: '1539636691151888454',    // 🟢・ᴍɪɴᴇᴄʀᴀғᴛ-ᴄʜᴀᴛ
    AUDITORIA: '1539768514322235402'          // 🛡️・ᴀᴜᴅɪᴛᴏʀíᴀ
};


const ALLOWED_MC_CHAT_ROLES = [
    '1539643506258092032', // 📜 ︱ ᴏʟᴅsᴄʜᴏᴏʟ
    '1539643449186328626', // 🦁 ︱ ʜᴇʀᴄᴜʟᴇs
    '1539643395507752980', // 🕯️ ︱ ʜᴇsᴛɪᴀ
    '1539643334354534490', // 💨 ︱ ʜᴇʀᴍᴇs
    '1539643276125274263', // 🔥 ︱ ʜᴇғᴇsᴛᴏ
    '1539643212938088568', // 🏹 ︱ ᴀʀᴛᴇᴍɪsᴀ
    '1539643159900983347', // 💖 ︱ ᴀғʀᴏᴅɪᴛᴀ
    '1539643102954782760', // 💀 ︱ ᴀɴᴜʙɪs
    '1539643031869857792', // 🌊 ︱ ᴘᴏsᴇɪᴅᴏɴ
    '1539642971287199744', // ⚡ ︱ ᴛʜᴏʀ
    '1539642860473688185', // 👑 ︱ ᴢᴇᴜs
    '1539642806480674816', // ⚡ ︱ ᴛɪᴛᴀɴ
    '1539642703263043634', // 💎 ︱ ʙᴏᴏsᴛᴇʀ
    '1544689169371107439', // Server Booster
    '1539768983287496855', // STAFF
    '1539641774392348754', // DUEÑO
    '1539642179822161940', // ADMIN
    '1539642260621369454', // DEV
    '1539642370356940861', // MOD
    '1539642446861041694'  // HELPER
];


const ticketConversations = new Map();
const escalatedTickets = new Set();
const userImageTimestamps = new Map();

const SMALL_CAPS_MAP = {
    'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ғ': 'f', 'ɢ': 'g', 'ʜ': 'h',
    'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p',
    'ǫ': 'q', 'ʀ': 'r', 's': 's', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'x': 'x',
    'ʏ': 'y', 'ᴢ': 'z'
};

function cleanUserName(rawName, isJack) {
    if (isJack) return 'Jack';
    if (!rawName) return 'Usuario';
    
    // Transliterar small caps a normal
    let transliterated = '';
    for (const char of rawName) {
        transliterated += SMALL_CAPS_MAP[char] || char;
    }
    
    // Normalizar unicode y quitar roles/tags
    let clean = transliterated.normalize('NFKD')
        .replace(/\[.*?\]|\(.*?\)|[-|✦│︱•~].*/g, '')
        .trim();
        
    let words = clean.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return 'Amigo';
    
    let first = words[0].replace(/^[_]+|[_]+$/g, '').trim();
    if (first.toLowerCase().startsWith('mr_') && first.length > 3) {
        first = first.substring(3);
    } else if (first.toLowerCase().startsWith('mr') && first.length > 2) {
        first = first.substring(2);
    }
    
    let firstLower = first.toLowerCase();
    if (firstLower.includes('pablo') || firstLower.includes('jack')) return 'Jack';
    if (firstLower.includes('emilio') || firstLower.includes('em1lio')) return 'Emilio';
    if (firstLower.includes('pasiente') || firstLower.includes('pacox')) return 'Pasiente';
    if (firstLower.includes('pepino')) return 'Pepino';
    if (firstLower.includes('chagui')) return 'Chagui';
    if (firstLower.includes('lauti') || firstLower.includes('lautaro')) return 'Lauti';
    if (firstLower.includes('kika')) return 'Kika';
    if (firstLower.includes('derem')) return 'Derem';

    // Capitalizar
    return first.charAt(0).toUpperCase() + first.slice(1) || 'Amigo';
}


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

// Detecta si el texto parece estar en inglés basándose en palabras clave comunes
function detectLanguage(text) {
    const t = text.toLowerCase();
    const enWords = ['i ', 'the ', 'is ', 'are ', 'my ', 'you ', 'it ', 'have ', 'want ', 'need ', 'can ', 'would ', 'like ', 'please ', 'hello', 'hi ', 'how ', 'what ', 'where ', 'when ', 'this ', 'that ', 'with ', 'for ', 'and ', 'but '];
    const esWords = ['yo ', 'el ', 'la ', 'es ', 'son ', 'mi ', 'tu ', 'quiero ', 'necesito ', 'puedo ', 'hola', 'como ', 'donde ', 'cuando ', 'esto ', 'eso ', 'con ', 'para ', 'y ', 'pero ', 'tengo '];
    const enScore = enWords.filter(w => t.includes(w)).length;
    const esScore = esWords.filter(w => t.includes(w)).length;
    return enScore > esScore ? 'en' : 'es';
}

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
    return `Hola ${sender}, dime qué necesitas.`;
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

// -----------------------------------------------------------------------------
// GESTIÓN ADMINISTRATIVA EN DISCORD (PURGA DE MENSAJES, ROLES, AUTO-PERMISOS)
// -----------------------------------------------------------------------------
async function handleDiscordManagement(message, cleanPrompt, isJack) {
    const promptLower = cleanPrompt.toLowerCase();

    // 1. PURGA Y LIMPIEZA MASIVA DE CANAL (SOLO JACK)
    if (promptLower.includes('borra el registro') || 
        promptLower.includes('borra el historial') || 
        promptLower.includes('borra los mensajes') || 
        promptLower.includes('limpia el canal') || 
        promptLower.includes('limpiar canal') ||
        promptLower.includes('purge') ||
        promptLower.includes('clear')) {
        
        if (!isJack) {
            return `Acceso denegado: Solo Jack puede autorizar la purga o eliminación de historial de canales.`;
        }

        try {
            const channel = message.channel;
            // Intentar purga masiva de hasta 100 mensajes
            let fetched;
            let totalDeleted = 0;
            do {
                fetched = await channel.messages.fetch({ limit: 100 });
                if (fetched.size === 0) break;
                
                // bulkDelete solo puede borrar mensajes de menos de 14 días
                const deleted = await channel.bulkDelete(fetched, true).catch(() => null);
                if (deleted) {
                    totalDeleted += deleted.size;
                    if (deleted.size < fetched.size) {
                        // Mensajes antiguos: borrarlos uno a uno si es necesario o terminar
                        break;
                    }
                } else {
                    break;
                }
            } while (fetched.size >= 100 && totalDeleted < 300);

            const confirmation = await channel.send(`🧹 **Historial purgado:** Se eliminaron **${totalDeleted}** mensajes de este canal por orden de Jack.`);
            setTimeout(() => {
                confirmation.delete().catch(() => {});
            }, 5000);
            return '__HANDLED__';
        } catch (e) {
            return `Error durante la purga de mensajes: ${e.message}`;
        }
    }

    // 2. Auto-configuración de permisos del propio Bot (Jack)
    if (promptLower.includes('permisos') || promptLower.includes('configurate') || promptLower.includes('auto-permisos') || promptLower.includes('darte permisos')) {
        if (!isJack) {
            return `Acceso denegado: Solo Jack puede autorizar configuraciones de permisos en Discord.`;
        }
        try {
            const me = await message.guild.members.fetchMe();
            const highestRole = me.roles.highest;
            const hasAdmin = me.permissions.has(PermissionsBitField.Flags.Administrator);

            return `🛡️ **Estado de Permisos de SAORI:**\n` +
                   `- **Rol:** ${highestRole.name}\n` +
                   `- **Administrador:** ${hasAdmin ? '✅ Activo' : '⚠️ Limitado'}\n` +
                   `- **Funciones:** Purgar canales, crear roles, enviar audios e imágenes y moderación autorizada por Jack.`;
        } catch (e) {
            return `Error revisando permisos: ${e.message}`;
        }
    }

    // 3. Creación y asignación de roles
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

async function sendAuditLog(embed) {
    try {
        const auditChan = client.channels.cache.get(CHANNELS.AUDITORIA) || 
                          await client.channels.fetch(CHANNELS.AUDITORIA).catch(() => null);
        if (auditChan) {
            await auditChan.send({ embeds: [embed] });
        }
    } catch (e) {
        console.error('[AUDIT-LOG] Error al despachar log a auditoría:', e.message);
    }
}

client.once('ready', async () => {
    console.log(`✅ [SAORI-DISCORD] ¡Conectada como ${client.user.tag}! Voice, Images (3/h), Purge, Auditoría (#${CHANNELS.AUDITORIA}) & Channel #${CHANNELS.SAORI_CHAT} activos.`);
    client.user.setActivity('DrakesCraft SRE & Auditoría 🛡️', { type: ActivityType.Watching });

    // Pre-cachear mensajes recientes de todos los canales para auditoría perfecta
    try {
        const guild = client.guilds.cache.first();
        if (guild) {
            const textChannels = guild.channels.cache.filter(c => c.isTextBased() && !c.isVoiceBased());
            for (const [id, ch] of textChannels) {
                await ch.messages.fetch({ limit: 40 }).catch(() => {});
            }
            console.log(`[AUDIT-CACHE] ✅ Mensajes recientes pre-cacheados en ${textChannels.size} canales.`);
        }
    } catch (e) {
        console.error('[AUDIT-CACHE] Error pre-cacheando mensajes:', e.message);
    }
});

// Bienvenidas automáticas y Auditoría de Ingreso
client.on('guildMemberAdd', async (member) => {
    try {
        const channel = member.guild.channels.cache.get(CHANNELS.BIENVENIDAS) || 
                        await member.guild.channels.fetch(CHANNELS.BIENVENIDAS).catch(() => null);

        if (channel) {
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
        }

        // 🛡️ Auditoría de Ingreso
        const joinAudit = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('📥 Miembro Nuevo Ingresó al Servidor')
            .setAuthor({ name: `${member.user.tag} (${member.user.id})`, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
            .addFields(
                { name: '👤 Usuario', value: `${member.user.tag} (\`${member.user.id}\`)`, inline: true },
                { name: '📅 Cuenta Creada', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '👥 Total Miembros', value: `\`${member.guild.memberCount}\``, inline: true }
            )
            .setFooter({ text: `ID Usuario: ${member.user.id}` })
            .setTimestamp();
        await sendAuditLog(joinAudit);

    } catch (e) {
        console.error('[SAORI-DISCORD] Error enviando bienvenida/auditoría ingreso:', e.message);
    }
});

// 🛡️ AUDITORÍA: Miembro Salió del Servidor
client.on('guildMemberRemove', async (member) => {
    try {
        const rolesStr = member.roles?.cache
            .filter(r => r.name !== '@everyone')
            .map(r => `\`${r.name}\``)
            .join(', ') || 'Ninguno';

        const embed = new EmbedBuilder()
            .setColor(0x95A5A6)
            .setTitle('📤 Miembro Salió del Servidor')
            .setAuthor({ name: `${member.user.tag} (${member.user.id})`, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
            .addFields(
                { name: '👤 Usuario', value: `${member.user.tag} (\`${member.user.id}\`)`, inline: true },
                { name: '👥 Total Restante', value: `\`${member.guild.memberCount}\``, inline: true },
                { name: '🎭 Roles que poseía', value: rolesStr.slice(0, 1024), inline: false }
            )
            .setFooter({ text: `ID Usuario: ${member.user.id}` })
            .setTimestamp();

        await sendAuditLog(embed);
    } catch (err) {
        console.error('[AUDIT] Error en guildMemberRemove:', err);
    }
});

// 🛡️ AUDITORÍA: Mensaje Eliminado
client.on('messageDelete', async (message) => {
    try {
        if (message.author?.bot && message.author.id === client.user.id) return;
        if (message.channel?.id === CHANNELS.AUDITORIA) return;

        let executor = null;
        if (message.guild) {
            try {
                const auditLogs = await message.guild.fetchAuditLogs({
                    type: AuditLogEvent.MessageDelete,
                    limit: 1
                }).catch(() => null);
                const entry = auditLogs?.entries.first();
                if (entry && (Date.now() - entry.createdTimestamp) < 5000) {
                    executor = entry.executor;
                }
            } catch (e) {}
        }

        const isUncached = message.partial || !message.author;
        const authorTag = message.author ? `${message.author.tag}` : (isUncached ? 'No registrado en caché' : 'Desconocido');
        const authorAvatar = message.author?.displayAvatarURL({ dynamic: true }) || client.user.displayAvatarURL();
        
        let content = message.content ? (message.content.length > 1000 ? message.content.slice(0, 1000) + '...' : message.content) : null;
        if (!content) {
            content = isUncached ? '*(Mensaje previo al reinicio del bot o fuera de caché local)*' : '*(Sin texto / Solo archivo o embed)*';
        }

        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('🗑️ Mensaje Eliminado')
            .setAuthor({ name: `${authorTag}`, iconURL: authorAvatar })
            .addFields(
                { name: '📍 Canal', value: `<#${message.channel.id}> (\`${message.channel?.name || 'Canal'}\`)`, inline: true },
                { name: '👤 Autor Original', value: message.author ? `<@${message.author.id}> (\`${message.author.tag}\`)` : '`No disponible en caché`', inline: true }
            );

        if (executor) {
            embed.addFields({ name: '🛡️ Eliminado por (Staff)', value: `${executor} (\`${executor.tag}\`)`, inline: true });
        }

        embed.addFields({ name: '📝 Contenido', value: content, inline: false });

        if (message.attachments?.size > 0) {
            const attNames = message.attachments.map(a => `• [${a.name}](${a.url})`).join('\n');
            embed.addFields({ name: `📎 Archivos Adjuntos (${message.attachments.size})`, value: attNames.slice(0, 1024), inline: false });
        }

        embed.setFooter({ text: `ID Mensaje: ${message.id} · ID Autor: ${message.author?.id || 'N/A'}` })
            .setTimestamp();

        await sendAuditLog(embed);
    } catch (err) {
        console.error('[AUDIT] Error en messageDelete:', err);
    }
});

// 🛡️ AUDITORÍA: Mensaje Editado
client.on('messageUpdate', async (oldMessage, newMessage) => {
    try {
        if (newMessage.author?.bot) return;
        if (oldMessage.content === newMessage.content) return;
        if (newMessage.channel?.id === CHANNELS.AUDITORIA) return;

        const authorTag = newMessage.author ? `${newMessage.author.tag}` : 'Desconocido';
        const authorAvatar = newMessage.author?.displayAvatarURL({ dynamic: true }) || client.user.displayAvatarURL();

        const oldContent = oldMessage.content ? (oldMessage.content.length > 900 ? oldMessage.content.slice(0, 900) + '...' : oldMessage.content) : '*(No cacheado / Vacío)*';
        const newContent = newMessage.content ? (newMessage.content.length > 900 ? newMessage.content.slice(0, 900) + '...' : newMessage.content) : '*(Vacío)*';

        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('✏️ Mensaje Editado')
            .setAuthor({ name: `${authorTag}`, iconURL: authorAvatar })
            .addFields(
                { name: '📍 Canal', value: `<#${newMessage.channel.id}> (\`${newMessage.channel.name}\`)`, inline: true },
                { name: '🔗 Enlace', value: `[Ir al Mensaje](${newMessage.url})`, inline: true },
                { name: '⬅️ Antes', value: oldContent, inline: false },
                { name: '➡️ Después', value: newContent, inline: false }
            )
            .setFooter({ text: `ID Mensaje: ${newMessage.id} · ID Autor: ${newMessage.author?.id || 'N/A'}` })
            .setTimestamp();

        await sendAuditLog(embed);
    } catch (err) {
        console.error('[AUDIT] Error en messageUpdate:', err);
    }
});

// 🛡️ AUDITORÍA: Modificación de Roles y Apodos de Miembros
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
        const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
        const nicknameChanged = oldMember.nickname !== newMember.nickname;

        if (addedRoles.size === 0 && removedRoles.size === 0 && !nicknameChanged) return;

        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('👤 Miembro Actualizado')
            .setAuthor({ name: `${newMember.user.tag} (${newMember.user.id})`, iconURL: newMember.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        if (addedRoles.size > 0) {
            embed.addFields({ name: '➕ Roles Asignados', value: addedRoles.map(r => `• \`${r.name}\``).join('\n'), inline: true });
        }
        if (removedRoles.size > 0) {
            embed.addFields({ name: '➖ Roles Removidos', value: removedRoles.map(r => `• \`${r.name}\``).join('\n'), inline: true });
        }
        if (nicknameChanged) {
            embed.addFields({ 
                name: '🏷️ Apodo Modificado', 
                value: `**Antes:** \`${oldMember.nickname || oldMember.user.username}\`\n**Ahora:** \`${newMember.nickname || newMember.user.username}\``, 
                inline: false 
            });
        }

        await sendAuditLog(embed);
    } catch (err) {
        console.error('[AUDIT] Error en guildMemberUpdate:', err);
    }
});


// Gestión de Mensajes y Tickets
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const isDM = !message.guild;
    const isJack = message.author.id === JACK_DISCORD_ID;

    // =========================================================================
    // MODERACIÓN AUTOMÁTICA DE CANAL MINECRAFT-CHAT (Solo OldSchool, VIPs y Staff)
    // =========================================================================
    if (message.channel.id === CHANNELS.MINECRAFT_CHAT && !isDM && !isJack) {
        const memberRoles = message.member?.roles.cache.map(r => r.id) || [];
        const hasPermission = ALLOWED_MC_CHAT_ROLES.some(rId => memberRoles.includes(rId));
        
        if (!hasPermission) {
            try {
                await message.delete();
                const warnMsg = await message.channel.send({
                    content: `⚠️ ${message.author}, solo miembros con rango **📜 OldSchool**, **Dioses/VIPs** o **Boosters** pueden enviar mensajes al chat de Minecraft. Los usuarios Polis tienen modo solo lectura.`
                });
                setTimeout(() => warnMsg.delete().catch(() => null), 7000);
            } catch (e) {
                console.error('[SAORI-DISCORD] Error moderando #minecraft-chat:', e.message);
            }
            return;
        }
    }

    const botMentioned = message.mentions.has(client.user);
    const isSaoriDedicatedChannel = message.channel.id === CHANNELS.SAORI_CHAT;
    const content = message.content.trim();
    const contentLower = content.toLowerCase();


    const isTicketChannel = message.channel.parentId === CHANNELS.CATEGORIA_TICKETS || 
                            message.channel.id === CHANNELS.TICKETS_SOPORTE || 
                            message.channel.name.startsWith('ticket-') ||
                            message.channel.name.includes('soporte');

    // Filtro de mensajes ultra cortos o fragmentos de listado en tickets
    const spamWords = ['xd', 'xdxd', 'lol', 'ok', 'a', 'si', 'no', 'ui', 'wey', 'wena', 'f', 'gg', 'jaja', 'jajaja', 'haha'];
    const isTooShort = content.length <= 2 || spamWords.includes(contentLower);
    // En tickets, <=5 palabras sin "?" ni mención directa son listados/aclaraciones — no responder
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
    const isListFragment = isTicketChannel && wordCount <= 5 && !content.includes('?') && !botMentioned;
    if ((isTooShort || isListFragment) && !botMentioned && !isDM && !isJack && !isSaoriDedicatedChannel) return;

    const shouldRespond = isSaoriDedicatedChannel ||
                          isTicketChannel || 
                          isDM || 
                          botMentioned || 
                          contentLower.startsWith('saori') || 
                          contentLower.includes('@saori') ||
                          contentLower === 'shelp' ||
                          contentLower.startsWith('/shelp') ||
                          contentLower.startsWith('!shelp');

    if (!shouldRespond) return;

    let rawSender = message.member?.displayName || message.author.username;
    let senderName = cleanUserName(rawSender, isJack);

    // =========================================================================
    // COMANDO SHELP (GUÍA COMPLETA DE COMANDOS SAORI)
    // =========================================================================
    if (contentLower === 'shelp' || contentLower === '/shelp' || contentLower === '!shelp' || contentLower === 'saori help' || contentLower === 'saori shelp') {
        const helpEmbed = new EmbedBuilder()
            .setTitle('🐺 S.A.O.R.I. · Guía Completa de Comandos')
            .setColor(0x00E5FF)
            .setDescription('**S.A.O.R.I. (Server Autonomous Orchestrator for Resilient Infrastructure)**\nAquí tienes la lista completa y detallada de todas mis funciones y comandos:')
            .addFields(
                { 
                    name: '🎫 1. Sistema de Tickets & Trinidad SRE (sticket)', 
                    value: '• `sticket <problema>` · Registra formalmente un ticket técnico en Star.\n*¿Cómo funciona?* Tu reporte se asigna a la Trinidad de Agentes (Claude Code analiza logs, Codex programa el parche y Antigravity compila y verifica). Se notifica automáticamente a Jack por WhatsApp cuando queda solucionado.\n*Ejemplo:* `sticket No puedo abrir la mesa de crafteo reforzada en SkyBlock`' 
                },
                { 
                    name: '🎵 2. Música & Spotify en Canales de Voz', 
                    value: '• `splay <canción / link spotify>` · Reproduce canciones o playlists en tu canal de voz.\n• `sskip` · Salta a la siguiente pista de la cola.\n• `spause` / `sresume` · Pausa o reanuda la reproducción.\n• `squeue` · Muestra las próximas pistas en cola.\n• `sstop` · Detiene la música y vacía la cola.\n• `smusica` · Guía de música en Discord y reproductor `/musica` in-game.' 
                },
                { 
                    name: '📊 3. Telemetría y Servidor de Minecraft', 
                    value: '• `sstats` / `sstats drakes` · Rendimiento, 20.0 TPS y estado de DrakesCraft.\n• `sstats star` · Servidor físico central, RAM y Docker.\n• `sstats nova` / `sstats nexus` · Telemetría de nodos de desarrollo y render.\n• `sip` · Direcciones de conexión (Java `mc.drakescraft.cl:25565` y Bedrock `19132`).\n• `sping` · Latencia del bot y enlace con la infraestructura.' 
                },
                { 
                    name: '🌐 4. Enlaces Oficiales & Guías', 
                    value: '• `sweb` · Portal web oficial de DrakesCraft (https://web.drakescraft.cl).\n• `stienda` · Tienda oficial con garantía de entrega y compensación (https://tienda.drakescraft.cl).\n• `sguia` · Enciclopedia de Slimefun, economía, trabajos y comandos.' 
                },
                { 
                    name: '🎨 5. Arte Neural & Chat Inteligente', 
                    value: '• `!imagen <descripción>` · Genera arte e ilustraciones en vivo con IA.\n• **Chat Natural:** Habla conmigo en <#1544811720571355196> o mencióname (`@SAORI`).' 
                },
                { 
                    name: '🛡️ 6. Moderación y Roles (Staff)', 
                    value: '• `sroles` · Muestra todos los roles del servidor y cantidad de miembros.\n• `srole dar @usuario <Rol>` · Asigna un rol a un miembro.\n• `srole quitar @usuario <Rol>` · Remueve un rol.\n• `sclear <cantidad>` o `!purge <cantidad>` · Purga mensajes de un canal.' 
                }
            )
            .setFooter({ text: 'S.A.O.R.I. SRE Core · DrakesCraft Network', iconURL: client.user.displayAvatarURL() });
        return message.reply({ embeds: [helpEmbed], allowedMentions: { repliedUser: false } });
    }

    // Comandos directos y accesos rápidos
    if (contentLower === 'sip') {
        return message.reply({ content: '⛏️ **IP de Conexión DrakesCraft:**\n• **Java:** `mc.drakescraft.cl:25565` (1.20 - 1.21.x)\n• **Bedrock:** `mc.drakescraft.cl` (Puerto: `19132`)', allowedMentions: { repliedUser: false } });
    }
    if (contentLower === 'sweb') {
        return message.reply({ content: '🌐 **Web Oficial:** https://web.drakescraft.cl', allowedMentions: { repliedUser: false } });
    }
    if (contentLower === 'stienda') {
        return message.reply({ content: '🛒 **Tienda Oficial:** https://tienda.drakescraft.cl', allowedMentions: { repliedUser: false } });
    }
    if (contentLower === 'sping') {
        const ping = client.ws.ping;
        return message.reply({ content: `🏓 **Pong!** Latencia de enlace con Discord: **${ping}ms** · Enlace con Star: **0.1ms**`, allowedMentions: { repliedUser: false } });
    }
    if (contentLower === 'sroles') {
        try {
            const guild = message.guild;
            if (!guild) return message.reply({ content: '❌ Este comando solo puede usarse en un servidor.' });
            
            const roles = await guild.roles.fetch();
            const staffRoles = [];
            const godRoles = [];
            const otherRoles = [];

            const roleCategories = {
                staff: ['dueño', 'admin', 'dev', 'mod', 'helper', 'builder', 'staff'],
                gods: ['titan', 'zeus', 'thor', 'poseidon', 'anubis', 'afrodita', 'artemisa', 'hefesto', 'hermes', 'hestia', 'hercules', 'oldschool', 'booster']
            };

            for (const [id, r] of roles) {
                if (r.name === '@everyone') continue;
                const nameLower = r.name.toLowerCase();
                const count = r.members.size;
                const formatted = `• **${r.name}**: \`${count}\` miembros`;

                if (roleCategories.staff.some(s => nameLower.includes(s))) {
                    staffRoles.push(formatted);
                } else if (roleCategories.gods.some(g => nameLower.includes(g))) {
                    godRoles.push(formatted);
                } else if (count > 0 && otherRoles.length < 10) {
                    otherRoles.push(formatted);
                }
            }

            const rolesEmbed = new EmbedBuilder()
                .setTitle('🛡️ Roles y Miembros de DrakesCraft')
                .setColor(0x00E5FF)
                .setDescription(`Censo de rangos sincronizados en Discord (**${guild.memberCount} miembros totales**):`)
                .addFields(
                    { name: '👑 Equipo de Staff', value: staffRoles.join('\n') || 'Sin datos', inline: false },
                    { name: '⚡ Rangos Dioses, VIPs & OldSchool', value: godRoles.join('\n') || 'Sin datos', inline: false }
                )
                .setFooter({ text: 'S.A.O.R.I. SRE · Sincronización Automática', iconURL: client.user.displayAvatarURL() });

            return message.reply({ embeds: [rolesEmbed], allowedMentions: { repliedUser: false } });
        } catch (e) {
            return message.reply({ content: `❌ Error al obtener roles: ${e.message}` });
        }
    }



    let cleanPrompt = content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();

    if (cleanPrompt.toLowerCase().startsWith('saori')) {
        cleanPrompt = cleanPrompt.replace(/^saori[\s,:]*/i, '').trim();
    }
    
    if (!cleanPrompt || cleanPrompt.length <= 2) {
        if (isSaoriDedicatedChannel || isDM) {
            cleanPrompt = 'Hola Saori, ¿cómo estás?';
        } else if (isTicketChannel) {
            cleanPrompt = 'Hola, ¿en qué te puedo ayudar con tu ticket?';
        } else {
            return;
        }
    }

    const contextTag = isTicketChannel ? `Ticket #${message.channel.name}` : (isDM ? 'DM' : `#${message.channel.name}`);
    console.log(`[SAORI-DISCORD] 📨 [${isJack ? 'Jack' : senderName} en ${contextTag}]: ${cleanPrompt}`);


    // =========================================================================
    // 1. GESTIÓN ADMINISTRATIVA EN DISCORD (PURGA, PERMISOS, ROLES)
    // =========================================================================
    const mgmtResponse = await handleDiscordManagement(message, cleanPrompt, isJack);
    if (mgmtResponse) {
        if (mgmtResponse !== '__HANDLED__') {
            await message.reply({ content: mgmtResponse, allowedMentions: { repliedUser: false } });
        }
        return;
    }

    // =========================================================================
    // 2. DETECCIÓN DE PETICIÓN DE AUDIO / VOZ DIRECTA
    // =========================================================================
    const wantsAudio = anyKeyword(cleanPrompt.toLowerCase(), [
        'audio', 'voz', 'manda audio', 'en audio', 'un audio', 'responde en audio', 
        'crea un audio', 'graba un audio', 'nota de voz', 'habla', 'di con tu voz',
        'manda un audio'
    ]);

    if (wantsAudio) {
        let recordingMsg = null;
        try {
            await message.channel.sendTyping();
            recordingMsg = await message.reply({
                content: `🎙️ *Grabando y procesando audio con la voz de SAORI...* ✨`,
                allowedMentions: { repliedUser: false }
            });

            const speechText = await askSaoriBrain(cleanPrompt, senderName, 'Petición directa de nota de voz/audio');
            const audioPath = await generateVoiceAudio(speechText);
            if (audioPath) {
                const attachment = new AttachmentBuilder(audioPath, { name: 'saori_voice.mp3' });
                await recordingMsg.edit({ 
                    content: `🌸 **Nota de Voz de SAORI:**\n_${speechText}_`, 
                    files: [attachment]
                });
                if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                console.log(`[SAORI-DISCORD] 🎙️ Audio generado y enviado exitosamente.`);
                return;
            } else {
                if (recordingMsg) await recordingMsg.edit({ content: `❌ Error generando audio.` });
            }
        } catch (e) {
            console.error('[SAORI-DISCORD] Error generando audio:', e.message);
            if (recordingMsg) await recordingMsg.edit({ content: `❌ Error de síntesis de voz.` });
        }
        return;
    }

    // =========================================================================
    // 3. DETECCIÓN DE PETICIÓN DE IMAGEN (POLLINATIONS + CODEX)
    // =========================================================================
    const isImageRequest = anyKeyword(cleanPrompt.toLowerCase(), [
        'genera una imagen', 'crea una imagen', 'generar imagen', 'crear imagen', 
        'generate una imagen', 'dibuja', 'dibujame', 'haz una imagen', 'creame una imagen'
    ]);

    if (isImageRequest) {
        const rateCheck = canGenerateImage(message.author.id, isJack);
        if (!rateCheck.allowed) {
            await message.reply({ 
                content: `⏳ Límite alcanzado: El límite es de 3 imágenes por hora. Podrás generar otra en aproximadamente **${rateCheck.waitMins} minutos**.`,
                allowedMentions: { repliedUser: false }
            });
            return;
        }

        try {
            await message.channel.sendTyping();
            const promptForImg = cleanPrompt.replace(/.*(imagen|dibuja|dibujame)\s+(de\s+)?/i, '').trim() || cleanPrompt;
            
            const waitingMsg = await message.reply({ 
                content: `🎨 *Pintando imagen...* ✨`,
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
                    .setFooter({ text: `DrakesCraft AI Art · Para ${senderName}`, iconURL: client.user.displayAvatarURL() });

                await waitingMsg.edit({ content: '', embeds: [imgEmbed], files: [attachment] });
                if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
                console.log(`[SAORI-DISCORD] 🎨 Imagen enviada con éxito.`);
                return;
            } else {
                await waitingMsg.edit({ content: `❌ No se pudo completar la imagen. Intenta en unos segundos.` });
                return;
            }
        } catch (e) {
            console.error('[SAORI-DISCORD] Error en flujo de imagen:', e.message);
        }
    }

    // =========================================================================
    // 4. RBAC PARA ACCIONES CRÍTICAS DE MINECRAFT
    // =========================================================================
    const isSensitiveAction = content.startsWith('/') || 
                              content.startsWith('!') || 
                              contentLower.includes('reinicia') || 
                              contentLower.includes('apaga') || 
                              contentLower.includes('deten el server') ||
                              contentLower.includes('ejecuta en consola') ||
                              (contentLower.includes('kick') && !isTicketChannel);

    if (isSensitiveAction && !isJack) {
        await message.reply({
            content: `Acceso denegado: Solo Jack y el Staff tienen autorización para ejecutar órdenes críticas en la infraestructura.`,
            allowedMentions: { repliedUser: false }
        });
        return;
    }

    // =========================================================================
    // 5. ESCALADO DE TICKETS A LA TRÍADA
    // =========================================================================
    if (isTicketChannel && !escalatedTickets.has(message.channel.id)) {
        if (!ticketConversations.has(message.channel.id)) {
            ticketConversations.set(message.channel.id, []);
        }
        const history = ticketConversations.get(message.channel.id);
        history.push({ sender: senderName, text: cleanPrompt, timestamp: Date.now() });

        const totalWords = history.reduce((acc, curr) => acc + curr.text.split(' ').length, 0);
        // Solo escalar si hay un problema técnico real: mínimo 60 palabras acumuladas Y un mensaje largo
        // Y el usuario no-Jack describe un problema concreto (no solo Jack respondiendo)
        const playerMessages = history.filter(h => h.sender !== 'Jack');
        const playerWords = playerMessages.reduce((acc, curr) => acc + curr.text.split(' ').length, 0);
        const hasSubstantiveProblem = playerMessages.some(m =>
            m.text.length > 80 &&
            anyKeyword(m.text.toLowerCase(), ['bug', 'error', 'falla', 'perdí', 'perdi', 'desapareció', 'desaparecio',
                'no funciona', 'no puedo', 'crash', 'rollback', 'griefing', 'hackearon', 'robaron',
                'inventario', 'banco', 'rango', 'item perdido', 'isla corrompida'])
        );

        if (playerWords >= 60 && hasSubstantiveProblem) {
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

    const lang = detectLanguage(cleanPrompt);
    const langInstruction = lang === 'en'
        ? 'IMPORTANT: The user is writing in English. You MUST reply in English only.'
        : 'El usuario escribe en español. Responde siempre en español.';
    const ticketContext = isTicketChannel
        ? `Canal de Ticket de Soporte. ${langInstruction} REGLA CRÍTICA: Jack (el dueño del servidor) es la máxima autoridad. NUNCA contradigas, corrijas ni cuestiones lo que Jack diga. Si Jack afirma que algo es así, es así.`
        : (isSaoriDedicatedChannel ? `Canal dedicado a hablar con Saori. ${langInstruction}` : langInstruction);
    const reply = await askSaoriBrain(cleanPrompt, senderName, ticketContext);

    try {
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

const RANK_MAPPINGS = {
    'oldschool': '1539643506258092032',
    'hermes': '1539643334354534490',
    'hestia': '1539643395507752980',
    'hercules': '1539643449186328626',
    'hefesto': '1539643276125274263',
    'artemisa': '1539643212938088568',
    'afrodita': '1539643159900983347',
    'anubis': '1539643102954782760',
    'poseidon': '1539643031869857792',
    'thor': '1539642971287199744',
    'zeus': '1539642860473688185',
    'titan': '1539642806480674816'
};

async function syncPlayerRanksWithDiscord(guild) {
    if (!guild) return;
    try {
        const members = await guild.members.fetch();
        console.log(`[SAORI-SYNC] 🔄 Sincronizando rangos de Minecraft con Discord (${members.size} miembros)...`);
        
        // Mapeo conocido directo (ign/nick/username -> rango)
        const knownUsers = {
            'mr_em1lio': 'oldschool',
            'em1lio': 'oldschool',
            'macacra334': 'hermes',
            'macacrack334': 'hermes',
            'stoneageking': 'zeus'
        };

        for (const [id, member] of members) {
            if (member.user.bot) continue;
            const username = member.user.username.toLowerCase();
            const nick = (member.nickname || '').toLowerCase();
            
            for (const [ign, rankKey] of Object.entries(knownUsers)) {
                if (username.includes(ign) || nick.includes(ign)) {
                    const roleId = RANK_MAPPINGS[rankKey];
                    if (roleId && !member.roles.cache.has(roleId)) {
                        await member.roles.add(roleId).catch(err => console.error(`Error agregando rol ${rankKey} a ${username}:`, err.message));
                        console.log(`[SAORI-SYNC] ✅ Rol ${rankKey.toUpperCase()} asignado a ${member.user.tag}`);
                    }
                }
            }
        }
    } catch (e) {
        console.error('[SAORI-SYNC] Error en sincronización de rangos:', e.message);
    }
}

// Sincronización periódica cada 10 minutos
client.once('ready', () => {
    setInterval(() => {
        const guild = client.guilds.cache.first();
        if (guild) syncPlayerRanksWithDiscord(guild);
    }, 10 * 60 * 1000);
});

function anyKeyword(text, list) {
    return list.some(k => text.includes(k));
}

client.login(DISCORD_BOT_TOKEN).catch(err => {
    console.error('❌ [SAORI-DISCORD] Error al iniciar sesión en Discord:', err.message);
});


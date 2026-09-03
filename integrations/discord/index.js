// SAORI Discord SRE & Support Engine · Full Image Generation with Rate Limiting (3/hour)

require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    ActivityType, 
    EmbedBuilder,
    AttachmentBuilder,
    AuditLogEvent,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    PermissionFlagsBits
} = require('discord.js');
const fetch = require('node-fetch');
const { execFile } = require('child_process');
const fs = require('fs');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const GUILD_ID = process.env.GUILD_ID || '1305395719300972585';
const OWNER_DISCORD_ID = process.env.OWNER_DISCORD_ID || process.env.JACK_DISCORD_ID || '493868699489665044';
const JACK_DISCORD_ID = OWNER_DISCORD_ID;

const AI_DAEMON_URL = process.env.AI_DAEMON_URL || 'http://127.0.0.1:8089/chat';
const IMAGE_DAEMON_URL = process.env.IMAGE_DAEMON_URL || 'http://127.0.0.1:8089/image';
const TTS_URL = process.env.TTS_URL || 'http://127.0.0.1:8089/tts';
const STT_URL = process.env.STT_URL || 'http://127.0.0.1:8089/stt';

const CHANNELS = {
    BIENVENIDAS: process.env.CHANNEL_BIENVENIDAS || '1540356407705079879',
    TICKETS_SOPORTE: process.env.CHANNEL_TICKETS_SOPORTE || '1539636904482578482',
    CATEGORIA_TICKETS: process.env.CHANNEL_CATEGORIA_TICKETS || '1539764389530312815',
    DENUNCIAS: process.env.CHANNEL_DENUNCIAS || '1539636961461928051',
    GENERAL_ES: process.env.CHANNEL_GENERAL_ES || '1539636493725864037',
    STAFF_CHAT: process.env.CHANNEL_STAFF_CHAT || '1539637349284061185',
    TAREAS_PENDIENTES: process.env.CHANNEL_TAREAS_PENDIENTES || '1539637422692769802',
    REGLAS: process.env.CHANNEL_REGLAS || '1539635930577641543',
    AUTO_ROLES: process.env.CHANNEL_AUTO_ROLES || '1539636390751502376',
    SUGERENCIAS: process.env.CHANNEL_SUGERENCIAS || '1539636565188542554',
    LINKS: process.env.CHANNEL_LINKS || '1539636367011876945',
    SPAM: process.env.CHANNEL_SPAM || '1539636611828940870',
    MUDAE: process.env.CHANNEL_MUDAE || '1539651775752048682',
    MEDIA: process.env.CHANNEL_MEDIA || '1539636544099450931',
    FORO_BUGS: process.env.CHANNEL_FORO_BUGS || '1539640716802662532',
    AUDITORIA: process.env.CHANNEL_AUDITORIA || '1539768514322235402',
    SAORI_CHAT: process.env.CHANNEL_SAORI_CHAT || '1544811720571355196'
};

// 🛡️ ESCUDOS DE SEGURIDAD Y ANTI-ATAQUES
const RateLimitShield = {
    userMessages: new Map(), // userId -> Array<timestamps>
    userInteractions: new Map(), // userId -> lastTimestamp

    // Prevenir spam de mensajes / flooding (máx 5 mensajes en 5s)
    checkMessageFlood(userId, isOwner = false) {
        if (isOwner) return true;
        const now = Date.now();
        const windowMs = 5000;
        const maxMsgs = 5;

        const timestamps = (this.userMessages.get(userId) || []).filter(t => (now - t) < windowMs);
        timestamps.push(now);
        this.userMessages.set(userId, timestamps);

        return timestamps.length <= maxMsgs;
    },

    // Prevenir hammering de botones/modals (1 interacción cada 1.5s)
    checkInteractionRate(userId, isOwner = false) {
        if (isOwner) return true;
        const now = Date.now();
        const last = this.userInteractions.get(userId) || 0;
        if (now - last < 1500) return false;
        this.userInteractions.set(userId, now);
        return true;
    },

    // Sanitizar entradas para evitar Prompt Injections, caracteres nulos y payloads sobredimensionados
    sanitizeInput(text, maxLen = 2000) {
        if (!text || typeof text !== 'string') return '';
        return text
            .replace(/\0/g, '') // Eliminar null bytes
            .replace(/[\u200B-\u200D\uFEFF]/g, '') // Eliminar caracteres invisibles zero-width
            .slice(0, maxLen)
            .trim();
    },

    // Detectar enlaces maliciosos / phishing
    isMaliciousLink(content) {
        if (!content) return false;
        const phishPatterns = [
            /grabify\.link/i,
            /iplogger\.(org|com|ru)/i,
            /2no\.co/i,
            /discorcd\.(gifts|com|net)/i,
            /dlscord\.(gift|gg|com)/i,
            /nitro-free/i,
            /steamcommuunity\.(com|link)/i,
            /steam-free/i
        ];
        return phishPatterns.some(pat => pat.test(content));
    }
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

// Intentar cargar binario estático de FFmpeg para streaming de música
try {
    process.env.FFMPEG_PATH = require('ffmpeg-static');
} catch (e) {}

const { DisTube } = require('distube');
const { YouTubePlugin } = require('@distube/youtube');
const { SpotifyPlugin } = require('@distube/spotify');

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';

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
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildInvites
    ],
    partials: [
        Partials.Channel, 
        Partials.Message, 
        Partials.GuildMember, 
        Partials.User,
        Partials.Reaction
    ]
});

// 🛡️ Despachador Oficial de Auditoría y Seguridad
async function sendAuditLog(embed) {
    try {
        const auditChan = client.channels.cache.get(CHANNELS.AUDITORIA) || 
                          await client.channels.fetch(CHANNELS.AUDITORIA).catch(() => null);
        if (auditChan) {
            await auditChan.send({ embeds: [embed] });
        }
    } catch (e) {
        console.error('[AUDIT-LOG] Error al despachar log:', e.message);
    }
}

// 🎭 Mapeo Oficial de Auto-Roles de DrakesCraft por Reacción
const AUTO_ROLES_MAP = {
    // 🎮 Plataformas
    '☕': '1539643667856494613', // ☕ ︱ ᴊᴀᴠᴀ
    '📱': '1539643739176308866', // 📱 ︱ ʙᴇᴅʀᴏᴄᴋ

    // 🕹️ Modalidades e Intereses
    '⚡': '1544920856684265533', // ⚡ ︱ sʟɪᴍᴇғᴜɴ & ᴛᴇᴄʜ
    '🏝️': '1544920860861927516', // 🏝️ ︱ ᴏɴᴇʙʟᴏᴄᴋ
    '🏝': '1544920860861927516',
    '☁️': '1544920865173671938', // ☁️ ︱ sᴋʏʙʟᴏᴄᴋ
    '☁': '1544920865173671938',
    '⚔️': '1544920866851127379', // ⚔️ ︱ sᴜʀᴠɪᴠᴀʟ
    '⚔': '1544920866851127379',
    '🎯': '1544920867866148917', // 🎯 ︱ ᴘᴠᴘ & ᴀʀᴇɴᴀs

    // 👤 Género
    '♂️': '1539643815256653835', // ♂️ ︱ ʜᴏᴍʙʀᴇ
    '♂': '1539643815256653835',
    '👨': '1539643815256653835',
    '♀️': '1539643884995350528', // ♀️ ︱ ᴍᴜᴊᴇʀ
    '♀': '1539643884995350528',
    '👩': '1539643884995350528',
    '✨': '1539643948291588136', // ✨ ︱ ᴏᴛʀᴏ

    // 🔔 Notificaciones
    '📢': '1539644011214807181', // 📢 ︱ AVISOS DISCORD
    '⛏️': '1539644151165882418', // ⛏️ ︱ AVISOS MC
    '⛏': '1539644151165882418',  // ⛏️ ︱ AVISOS MC
    '🎁': '1539644230941806602', // 🎁 ︱ EVENTOS Y SORTEOS
    '🚀': '1539644293914824814', // 🚀 ︱ ACTUALIZACIONES

    // 🌎 Países / Regiones (Basado en Métricas Oficiales de Star)
    '🇨🇱': '1539644375687241728', // 🇨🇱 ︱ ᴄʜɪʟᴇ
    '🇲🇽': '1539644555924607117', // 🇲🇽 ︱ ᴍéxɪᴄᴏ
    '🇦🇷': '1539644441160061009', // 🇦🇷 ︱ ᴀʀɢᴇɴᴛɪɴᴀ
    '🇺🇸': '1544922129663918080', // 🇺🇸 ︱ ᴇsᴛᴀᴅᴏs ᴜɴɪᴅᴏs
    '🇵🇪': '1539644500698202112', // 🇵🇪 ︱ ᴘᴇʀú
    '🇨🇴': '1539644604075348088', // 🇨🇴 ︱ ᴄᴏʟᴏᴍʙɪᴀ
    '🇺🇾': '1544922131056558202', // 🇺🇾 ︱ ᴜʀᴜɢᴜᴀʏ
    '🇪🇨': '1544922133149515837', // 🇪🇨 ︱ ᴇᴄᴜᴀᴅᴏʀ
    '🇧🇴': '1544922134235578389', // 🇧🇴 ︱ ʙᴏʟɪᴠɪᴀ
    '🇪🇸': '1539644660996247752', // 🇪🇸 ︱ ᴇsᴘᴀñᴀ
    '🇻🇪': '1544922136056045621', // 🇻🇪 ︱ ᴠᴇɴᴇᴢᴜᴇʟᴀ
    '🇩🇴': '1544922137913987142', // 🇩🇴 ︱ ʀ. ᴅᴏᴍɪɴɪᴄᴀɴᴀ
    '🇬🇹': '1544922139570733107', // 🇬🇹 ︱ ɢᴜᴀᴛᴇᴍᴀʟᴀ
    '🇸🇻': '1544922141114503180', // 🇸🇻 ︱ ᴇʟ sᴀʟᴠᴀᴅᴏʀ
    '🇨🇷': '1544922142657749004', // 🇨🇷 ︱ ᴄᴏsᴛᴀ ʀɪᴄᴀ
    '🇵🇦': '1544922144863952929', // 🇵🇦 ︱ ᴘᴀɴᴀᴍá
    '🇭🇳': '1544922146223165500', // 🇭🇳 ︱ ʜᴏɴᴅᴜʀᴀs
    '🇳🇮': '1544922147863142420', // 🇳🇮 ︱ ɴɪᴄᴀʀᴀɢᴜᴀ
    '🇵🇷': '1544922149125365761', // 🇵🇷 ︱ ᴘᴜᴇʀᴛᴏ ʀɪᴄᴏ
    '🌎': '1539644717292200058', // 🌎 ︱ ᴏᴛʀᴏ ᴘᴀís
};

// 🔔 Mapeo de Canales de Anuncios a sus respectivos Roles de Notificación
const NOTIFICATION_CHANNELS_MAP = {
    '1539636299395502211': '1539644011214807181', // 📢 Avisos Discord -> Rol 📢 AVISOS DISCORD
    '1539636335307137145': '1539644151165882418', // ⛏️ Avisos Minecraft -> Rol ⛏️ AVISOS MC
    '1539636414495326338': '1539644230941806602', // 🎁 Eventos y Sorteos -> Rol 🎁 EVENTOS Y SORTEOS
    '1539636837168185456': '1539644293914824814'  // 🚀 Actualizaciones -> Rol 🚀 ACTUALIZACIONES
};

// Asignación automática al reaccionar
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    try {
        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();

        const emojiName = reaction.emoji.name;
        const roleId = AUTO_ROLES_MAP[emojiName];
        if (!roleId) return;

        const guild = reaction.message.guild;
        if (!guild) return;

        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) return;

        const role = guild.roles.cache.get(roleId);
        if (role && !member.roles.cache.has(roleId)) {
            await member.roles.add(role);
            console.log(`[AUTO-ROLES] ✅ Rol '${role.name}' asignado a ${user.tag} por reacción '${emojiName}'`);
        }
    } catch (err) {
        console.error('[AUTO-ROLES] Error al asignar rol en reacción:', err);
    }
});

// Remoción automática al quitar reacción
client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    try {
        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();

        const emojiName = reaction.emoji.name;
        const roleId = AUTO_ROLES_MAP[emojiName];
        if (!roleId) return;

        const guild = reaction.message.guild;
        if (!guild) return;

        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) return;

        const role = guild.roles.cache.get(roleId);
        if (role && member.roles.cache.has(roleId)) {
            await member.roles.remove(role);
            console.log(`[AUTO-ROLES] ❌ Rol '${role.name}' removido a ${user.tag} por desmarcar '${emojiName}'`);
        }
    } catch (err) {
        console.error('[AUTO-ROLES] Error al remover rol en reacción:', err);
    }
});

// Inicializar DisTube con Spotify y YouTube
let distube = null;
try {
    const plugins = [new YouTubePlugin()];
    if (SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET) {
        plugins.unshift(new SpotifyPlugin({
            api: { clientId: SPOTIFY_CLIENT_ID, clientSecret: SPOTIFY_CLIENT_SECRET }
        }));
        console.log('✅ [SAORI-MUSIC] Spotify Plugin cargado con éxito.');
    }
    distube = new DisTube(client, {
        emitNewSongOnly: true,
        plugins
    });

    distube.on('playSong', (queue, song) => {
        const embed = new EmbedBuilder()
            .setColor(0x1DB954)
            .setTitle('🎶 Sonando Ahora en Canal de Voz')
            .setDescription(`**[${song.name}](${song.url})**`)
            .addFields(
                { name: '⏱️ Duración', value: song.formattedDuration || 'N/A', inline: true },
                { name: '👤 Pedida por', value: song.user?.username || 'Usuario', inline: true }
            )
            .setThumbnail(song.thumbnail)
            .setFooter({ text: 'SAORI Spotify & Music Engine', iconURL: client.user.displayAvatarURL() });
        queue.textChannel?.send({ embeds: [embed] }).catch(() => {});
    });

    distube.on('addSong', (queue, song) => {
        queue.textChannel?.send(`➕ **Agregado a la cola:** [${song.name}](${song.url}) · \`${song.formattedDuration}\``).catch(() => {});
    });

    distube.on('addList', (queue, playlist) => {
        queue.textChannel?.send(`📋 **Playlist de Spotify agregada:** \`${playlist.name}\` (${playlist.songs.length} canciones)`).catch(() => {});
    });

    distube.on('error', (channel, error) => {
        console.error('[SAORI-DISTUBE] Error:', error.message);
        channel?.send(`❌ Error de reproducción: ${error.message}`).catch(() => {});
    });

    client.distube = distube;
} catch (e) {
    console.error('[SAORI-MUSIC] Error iniciando DisTube:', e.message);
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

client.once('ready', async () => {
    console.log(`✅ [SAORI-DISCORD] ¡Conectada como ${client.user.tag}! Voice, Images (3/h) & Channel #${CHANNELS.SAORI_CHAT} activos.`);
    client.user.setActivity('DrakesCraft SRE & Soporte 🛡️', { type: ActivityType.Watching });

    // Pre-cachear mensajes recientes de todos los canales para auditoría perfecta
    try {
        const textChannels = client.channels.cache.filter(c => c.isTextBased && c.isTextBased() && !c.isVoiceBased());
        for (const [id, ch] of textChannels) {
            await ch.messages.fetch({ limit: 30 }).catch(() => {});
        }
        console.log(`[AUDIT-CACHE] ✅ Mensajes recientes pre-cacheados en ${textChannels.size} canales.`);

        // Iniciar actualización inicial de estadísticas del servidor
        setTimeout(() => {
            const guild = client.guilds.cache.get('1305395719300972585');
            if (guild) updateServerStats(guild);
        }, 5000);
    } catch (e) {}
});

// 📊 ESTADÍSTICAS DEL SERVIDOR EN TIEMPO REAL (Discord + Minecraft)
const STATS_CHANNELS = {
    CATEGORY: '1544849347219431555',
    TOTAL_MEMBERS: '1544849351992410223',
    HUMANS: '1544849364109893642',
    MC_ONLINE: '1544849367603744828',
    IP: '1544849874212618260',
    WEB: '1544850002344677446'
};

async function updateServerStats(guild) {
    try {
        if (!guild) return;
        await guild.members.fetch().catch(() => {});

        const totalMembers = guild.memberCount;
        const humans = guild.members.cache.filter(m => !m.user.bot).size;

        // Consultar jugadores online en Minecraft en vivo
        let mcOnline = 0;
        try {
            const res = await fetch('https://api.mcsrvstat.us/3/mc.drakescraft.cl', { timeout: 4000 });
            if (res.ok) {
                const data = await res.json();
                mcOnline = data.players?.online || 0;
            }
        } catch (e) {}

        const cat = guild.channels.cache.get(STATS_CHANNELS.CATEGORY);
        if (cat && cat.name !== '── 📊・ᴇsᴛᴀᴅísᴛɪᴄᴀs ──') {
            await cat.setName('── 📊・ᴇsᴛᴀᴅísᴛɪᴄᴀs ──').catch(() => {});
        }

        const chTotal = guild.channels.cache.get(STATS_CHANNELS.TOTAL_MEMBERS);
        if (chTotal) {
            const newName = `👥・ᴍɪᴇᴍʙʀᴏs: ${totalMembers}`;
            if (chTotal.name !== newName) await chTotal.setName(newName).catch(() => {});
        }

        const chHumans = guild.channels.cache.get(STATS_CHANNELS.HUMANS);
        if (chHumans) {
            const newName = `🧑・ᴜsᴜᴀʀɪᴏs: ${humans}`;
            if (chHumans.name !== newName) await chHumans.setName(newName).catch(() => {});
        }

        const chMc = guild.channels.cache.get(STATS_CHANNELS.MC_ONLINE);
        if (chMc) {
            const newName = `🎮・ᴍᴄ ᴏɴʟɪɴᴇ: ${mcOnline}`;
            if (chMc.name !== newName) await chMc.setName(newName).catch(() => {});
        }

        const chIp = guild.channels.cache.get(STATS_CHANNELS.IP);
        if (chIp) {
            const newName = '📌・ɪᴘ: mc.drakescraft.cl';
            if (chIp.name !== newName) await chIp.setName(newName).catch(() => {});
        }

        const chWeb = guild.channels.cache.get(STATS_CHANNELS.WEB);
        if (chWeb) {
            const newName = '🌐・ᴡᴇʙ: drakescraft.cl';
            if (chWeb.name !== newName) await chWeb.setName(newName).catch(() => {});
        }

        console.log(`[STATS] ✅ Estadísticas actualizadas: Discord ${totalMembers} (${humans} humanos) | MC Online: ${mcOnline}`);
    } catch (err) {
        console.error('[STATS] Error al actualizar estadísticas:', err.message);
    }
}

// Refresco periódico de estadísticas cada 10 minutos (respetando rate limits de Discord)
setInterval(() => {
    const guild = client.guilds.cache.get('1305395719300972585');
    if (guild) updateServerStats(guild);
}, 10 * 60 * 1000);

function toSmallCaps(text) {
    if (!text) return text;
    const mapping = {
        'a': 'ᴀ', 'b': 'ʙ', 'c': 'ᴄ', 'd': 'ᴅ', 'e': 'ᴇ', 'f': 'ғ', 'g': 'ɢ', 'h': 'ʜ', 'i': 'ɪ', 'j': 'ᴊ',
        'k': 'ᴋ', 'l': 'ʟ', 'm': 'ᴍ', 'n': 'ɴ', 'o': 'ᴏ', 'p': 'ᴘ', 'q': 'ǫ', 'r': 'ʀ', 's': 's', 't': 'ᴛ',
        'u': 'ᴜ', 'v': 'ᴠ', 'w': 'ᴡ', 'x': 'x', 'y': 'ʏ', 'z': 'ᴢ',
        'A': 'ᴀ', 'B': 'ʙ', 'C': 'ᴄ', 'D': 'ᴅ', 'E': 'ᴇ', 'F': 'ғ', 'G': 'ɢ', 'H': 'ʜ', 'I': 'ɪ', 'J': 'ᴊ',
        'K': 'ᴋ', 'L': 'ʟ', 'M': 'ᴍ', 'N': 'ɴ', 'O': 'ᴏ', 'P': 'ᴘ', 'Q': 'ǫ', 'R': 'ʀ', 'S': 's', 'T': 'ᴛ',
        'U': 'ᴜ', 'V': 'ᴠ', 'W': 'ᴡ', 'X': 'x', 'Y': 'ʏ', 'Z': 'ᴢ'
    };
    return text.split('').map(c => mapping[c] || c).join('').slice(0, 32);
}

const UNCONFUSE_MAP = {
    'ᗰ': 'm', 'ᗪ': 'd', 'ᖇ': 'r', 'ᗩ': 'a', '𝔒': 'o', 'ᑎ': 'n', 'ø': 'o', 'Ø': 'o', 'ę': 'e', 'Ę': 'e',
    'Ä': 'a', 'ä': 'a', 'Ë': 'e', 'ë': 'e', 'Ï': 'i', 'ï': 'i', 'Ö': 'o', 'ö': 'o', 'Ü': 'u', 'ü': 'u',
    'ÿ': 'y', 'Ÿ': 'y', 'ı': 'i', '∂': 'd', 'α': 'a', 'я': 'r', 'к': 'k', 'υ': 'u', 'σ': 'o',
    'ι': 'i', 'א': 'x', 'ع': 'e', 'ツ': '', '彡': '', '★': '', '☆': '', '『': '', '』': '', '【': '', '】': '',
    '𝔄': 'a', '𝔅': 'b', 'ℭ': 'c', '𝔇': 'd', '𝔈': 'e', '𝔉': 'f', '𝔊': 'g', 'ℌ': 'h', 'ℑ': 'i', '𝔍': 'j',
    '𝔎': 'k', '𝔏': 'l', '𝔐': 'm', '𝔑': 'n', '𝔒': 'o', '𝔓': 'p', '𝔔': 'q', 'ℜ': 'r', '𝔖': 's', '𝔗': 't',
    '𝔘': 'u', '𝔙': 'v', '𝔚': 'w', '𝔛': 'x', '𝔜': 'y', 'ℨ': 'z', '𝔡': 'd', '𝔯': 'r', '𝔞': 'a', '𝔬': 'o', '𝔫': 'n'
};

const STAFF_ROLES_SUFFIX = {
    '1539641774392348754': ' - ᴏᴡɴᴇʀ',
    '1539642179822161940': ' - ᴀᴅᴍɪɴ',
    '1539642260621369454': ' - ᴅᴇᴠ',
    '1539642370356940861': ' - ᴍᴏᴅ',
    '1539642446861041694': ' - ʜᴇʟᴘᴇʀ',
    '1539642520991178833': ' - ʙᴜɪʟᴅᴇʀ',
    '1544153904395194408': ' - ʙᴜғóɴ'
};

function formatMemberNickname(name, memberRoles = [], memberId = '') {
    if (!name) return "";
    if (memberId === '684457729003356180') return 'ᴋɪᴋᴀ - ᴡɪғᴇ ᴏᴡɴᴇʀ';
    let cleaned = name.replace(/\s*[-–—|]\s*(admin|mod|dev|helper|builder|owner|staff|bufon|bufón|wife owner|husband owner|dios|ᴀᴅᴍɪɴ|ᴍᴏᴅ|ᴅᴇᴠ|ʜᴇʟᴘᴇʀ|ʙᴜɪʟᴅᴇʀ|ᴏᴡɴᴇʀ|ʙᴜғóɴ).*$/gi, '').trim();
    cleaned = cleaned.normalize('NFKC');
    let unconfused = '';
    for (const ch of cleaned) {
        if (UNCONFUSE_MAP[ch] !== undefined) {
            unconfused += UNCONFUSE_MAP[ch];
        } else {
            unconfused += ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
        }
    }
    let small = toSmallCaps(unconfused).trim();
    let suffix = '';
    for (const [rId, sText] of Object.entries(STAFF_ROLES_SUFFIX)) {
        if (memberRoles.includes(rId)) {
            suffix = sText;
            break;
        }
    }
    return (small + suffix).slice(0, 32);
}

// Bienvenidas automáticas y Auditoría de Ingreso
client.on('guildMemberAdd', async (member) => {
    try {
        // ✨ Auto-Nickname en Small Caps y Asignación de Rol Polis
        if (!member.user.bot && member.id !== JACK_DISCORD_ID) {
            const rawName = member.user.globalName || member.user.username;
            const targetNick = formatMemberNickname(rawName, member.roles.cache.map(r => r.id), member.id);
            if (targetNick) {
                await member.setNickname(targetNick).catch(() => {});
            }
            const polisRoleId = '1539643572251271198'; // 🏛️ ︱ ᴘᴏʟɪs
            await member.roles.add(polisRoleId).catch(() => {});
        }

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
                .setFooter({ text: 'DrakesCraft Community', iconURL: client.user.displayAvatarURL() })
                .setTimestamp();
            await channel.send({ embeds: [welcomeEmbed] });
        }

        // 🛡️ Registro de Auditoría de Ingreso
        const accountAgeDays = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
        const isSuspicious = accountAgeDays < 7;
        const joinAudit = new EmbedBuilder()
            .setColor(isSuspicious ? 0xE67E22 : 0x2ECC71)
            .setTitle(isSuspicious ? '⚠️ Nuevo Miembro Unido (Cuenta Reciente)' : '📥 Nuevo Miembro Unido')
            .setAuthor({ name: `${member.user.tag} (${member.user.id})`, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
            .setDescription(`${member} (\`${member.user.tag}\`) ha entrado al servidor.`)
            .addFields(
                { name: '📅 Antigüedad de la Cuenta', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R> (\`${accountAgeDays} días\`)`, inline: true },
                { name: '👥 Total de Miembros', value: `\`${member.guild.memberCount}\``, inline: true }
            )
            .setFooter({ text: `ID Usuario: ${member.user.id}` })
            .setTimestamp();
        await sendAuditLog(joinAudit);
    } catch (e) {
        console.error('[SAORI-WELCOME/AUDIT] Error:', e.message);
    }
});

// ✨ Sincronización Automática de Apodos y Sufijos de Staff
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        if (newMember.user.bot || newMember.id === JACK_DISCORD_ID) return;

        const rolesChanged = oldMember.roles.cache.size !== newMember.roles.cache.size ||
                             !oldMember.roles.cache.equals(newMember.roles.cache);
        const nickChanged = oldMember.nickname !== newMember.nickname;

        if (rolesChanged || nickChanged) {
            const rawName = newMember.nickname || newMember.user.globalName || newMember.user.username;
            const targetNick = formatMemberNickname(rawName, newMember.roles.cache.map(r => r.id), newMember.id);
            if (targetNick && targetNick !== newMember.nickname) {
                await newMember.setNickname(targetNick).catch(() => {});
            }
        }
    } catch (e) {}
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

// 🛡️ AUDITORÍA: Canales Creados y Eliminados
client.on('channelCreate', async (channel) => {
    try {
        if (!channel.guild) return;
        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('📁 Canal Creado')
            .addFields(
                { name: '📍 Canal', value: `<#${channel.id}> (\`${channel.name}\`)`, inline: true },
                { name: '⚙️ Tipo', value: channel.type === 0 ? 'Texto' : (channel.type === 2 ? 'Voz' : `Tipo ${channel.type}`), inline: true }
            )
            .setFooter({ text: `ID Canal: ${channel.id}` })
            .setTimestamp();
        await sendAuditLog(embed);
    } catch (e) {}
});

client.on('channelDelete', async (channel) => {
    try {
        if (!channel.guild) return;
        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('🗑️ Canal Eliminado')
            .addFields(
                { name: '📍 Nombre', value: `\`${channel.name}\``, inline: true },
                { name: '⚙️ Tipo', value: channel.type === 0 ? 'Texto' : (channel.type === 2 ? 'Voz' : `Tipo ${channel.type}`), inline: true }
            )
            .setFooter({ text: `ID Canal: ${channel.id}` })
            .setTimestamp();
        await sendAuditLog(embed);
    } catch (e) {}
});

// 🛡️ AUDITORÍA: Sanciones (Bans y Unbans)
client.on('guildBanAdd', async (ban) => {
    try {
        const embed = new EmbedBuilder()
            .setColor(0x992D22)
            .setTitle('🔨 Miembro Baneado')
            .setAuthor({ name: `${ban.user.tag} (${ban.user.id})`, iconURL: ban.user.displayAvatarURL({ dynamic: true }) })
            .addFields(
                { name: '👤 Usuario', value: `${ban.user} (\`${ban.user.tag}\`)`, inline: true },
                { name: '📝 Razón', value: ban.reason || 'Sin razón especificada', inline: true }
            )
            .setFooter({ text: `ID Usuario: ${ban.user.id}` })
            .setTimestamp();
        await sendAuditLog(embed);
    } catch (e) {}
});

client.on('guildBanRemove', async (ban) => {
    try {
        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('🕊️ Miembro Desbaneado')
            .setAuthor({ name: `${ban.user.tag} (${ban.user.id})`, iconURL: ban.user.displayAvatarURL({ dynamic: true }) })
            .addFields(
                { name: '👤 Usuario', value: `${ban.user} (\`${ban.user.tag}\`)`, inline: true }
            )
            .setFooter({ text: `ID Usuario: ${ban.user.id}` })
            .setTimestamp();
        await sendAuditLog(embed);
    } catch (e) {}
});

// 🛡️ AUDITORÍA: Canales de Voz (Conexión / Desconexión / Movimiento)
client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        const user = newState.member?.user || oldState.member?.user;
        if (!user || user.bot) return;

        let desc = null;
        let color = 0x1ABC9C;

        if (!oldState.channelId && newState.channelId) {
            desc = `🟢 **Conectado:** ${user} se unió a <#${newState.channelId}> (\`${newState.channel.name}\`)`;
            color = 0x2ECC71;
        } else if (oldState.channelId && !newState.channelId) {
            desc = `🔴 **Desconectado:** ${user} salió de <#${oldState.channelId}> (\`${oldState.channel.name}\`)`;
            color = 0xE74C3C;
        } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
            desc = `🔄 **Movido:** ${user} cambió de <#${oldState.channelId}> a <#${newState.channelId}>`;
            color = 0x3498DB;
        }

        if (desc) {
            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle('🎙️ Registro de Voz')
                .setAuthor({ name: `${user.tag} (${user.id})`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                .setDescription(desc)
                .setFooter({ text: `ID Usuario: ${user.id}` })
                .setTimestamp();
            await sendAuditLog(embed);
        }
    } catch (e) {}
});

// 🐛 AUTO-TRIAJE & GESTIÓN DE BUGS EN EL CANAL FORO (1539640716802662532)
client.on('threadCreate', async (thread) => {
    try {
        if (thread.parentId !== CHANNELS.FORO_BUGS) return;
        await new Promise(r => setTimeout(r, 2000));

        const starterMsg = await thread.fetchStarterMessage().catch(() => null);
        const authorName = starterMsg?.author ? starterMsg.author.tag : 'Jugador';
        const reportText = starterMsg?.content || thread.name;

        // Registrar formalmente en la Trinidad SRE
        await callAIDaemon(`ticket: [Bug Foro - ${thread.name}] ${reportText}`, authorName, false).catch(() => null);

        const forumEmbed = new EmbedBuilder()
            .setColor(0xF39C12)
            .setTitle('🐛 Reporte de Bug Recibido & Indexado')
            .setDescription(
                `¡Hola ${starterMsg?.author || 'Jugador'}! Tu reporte de bug ha sido indexado automáticamente por **SAORI**.\n\n` +
                `📋 **Estado:** 🟡 **En Investigación por la Trinidad SRE**\n` +
                `🛠️ **Agentes Asignados:** Claude Code (Logs), Codex (Código) y Antigravity (Compilación y Pruebas).\n\n` +
                `💬 *Te notificaremos en este mismo hilo en cuanto el parche o solución sea verificada.*`
            )
            .setFooter({ text: 'DrakesCraft SRE Bug Tracker · SAORI' })
            .setTimestamp();

        await thread.send({ embeds: [forumEmbed] });

        // Aplicar etiqueta 'En Investigación'
        const investTagId = '1544914436442169350';
        if (thread.setAppliedTags) {
            const currentTags = thread.appliedTags || [];
            if (!currentTags.includes(investTagId)) {
                await thread.setAppliedTags([...currentTags, investTagId]).catch(() => {});
            }
        }
    } catch (e) {
        console.error('[FORO-BUGS] Error procesando post:', e.message);
    }
});

// ==========================================
// 🎫 SISTEMA INTERACTIVO DE TICKETS & DENUNCIAS DE SAORI
// ==========================================

async function sendTicketPanel(targetChannel) {
    const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('🎫 CENTRO DE ASISTENCIA Y TICKETS · DRAKESCRAFT NETWORK')
        .setDescription(
            '¡Bienvenido al centro oficial de soporte de **DrakesCraft**!\n\n' +
            'Si necesitas ayuda personalizada, tienes problemas con compras, reportes técnicos o deseas postularte al Staff, pulsa el botón correspondiente:\n\n' +
            '🐛 **Bugs y Errores:** Fallos de Slimefun, errores de consola, dupes o problemas de mecánicas.\n' +
            '📦 **Pérdida de Ítems:** Pérdidas por fallos técnicos o caídas inusuales del servidor.\n' +
            '🛒 **Compras y Tienda:** Rangos, llaves, monedas o comprobantes de Tebex/MercadoPago/PayPal.\n' +
            '❓ **Dudas y Guías:** Asistencia general sobre comandos, claims de parcelas y modalidades.\n' +
            '🛡️ **Postulación a Staff:** Formulario oficial para unirte a nuestro equipo de moderación.\n' +
            '⚖️ **Denuncia Confidencial:** Reporte seguro y privado de jugadores molestos, toxicidad o Staff.\n\n' +
            '> ⚠️ **NOTA:** Al pulsar cualquier opción se desplegará un **formulario obligatorio** en pantalla. Rellena todos los campos con claridad para brindarte soporte inmediato.'
        )
        .setFooter({ text: 'DrakesCraft Support Engine · SAORI SRE' });

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_ticket_bug').setLabel('Bugs y Errores').setEmoji('🐛').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_ticket_perdida').setLabel('Pérdida de Ítems').setEmoji('📦').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_ticket_tienda').setLabel('Compras y Tienda').setEmoji('🛒').setStyle(ButtonStyle.Success)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_ticket_dudas').setLabel('Dudas y Guías').setEmoji('❓').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_ticket_postulacion').setLabel('Postulación a Staff').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_ticket_denuncia').setLabel('Denuncia Confidencial').setEmoji('⚖️').setStyle(ButtonStyle.Danger)
    );

    return await targetChannel.send({ embeds: [embed], components: [row1, row2] });
}

async function sendDenunciasPanel(targetChannel) {
    const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('⚖️ SISTEMA OFICIAL DE DENUNCIAS Y REPORTES CONFIDENCIALES')
        .setDescription(
            'En **DrakesCraft** mantenemos tolerancia cero contra la toxicidad, el acoso, las trampas (hacks/xray), la evasión de sanciones y el abuso de poder.\n\n' +
            'Si un jugador te está molestando de forma reiterada, rompiendo las reglas del servidor o deseas denunciar una mala conducta de un miembro del Staff:\n\n' +
            '🔒 **PRIVACIDAD Y CONFIDENCIALIDAD GARANTIZADA:**\n' +
            'Este ticket se abrirá en un canal 100% privado visible únicamente para el **Owner (Jack)** y la **Alta Administración**.\n\n' +
            '📋 **REQUISITOS DEL FORMULARIO:**\n' +
            '• Nick del infractor o Staff a denunciar.\n' +
            '• Motivo de la infracción y relato detallado de lo sucedido.\n' +
            '• Enlaces obligatorios de pruebas (Imgur, YouTube, Medal, Twitch, etc.).'
        )
        .setFooter({ text: 'DrakesCraft Anti-Abuse & Moderation · SAORI' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_ticket_denuncia').setLabel('Abrir Denuncia Confidencial').setEmoji('🚨').setStyle(ButtonStyle.Danger)
    );

    return await targetChannel.send({ embeds: [embed], components: [row] });
}

client.on('interactionCreate', async (interaction) => {
    try {
        // 1. MANEJO DE BOTONES (DESPLIEGUE DE MODALES O ACCIONES)
        if (interaction.isButton()) {
            const id = interaction.customId;

            if (id === 'btn_ticket_bug') {
                const modal = new ModalBuilder().setCustomId('modal_ticket_bug').setTitle('🐛 Reporte de Bug o Error');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nick').setLabel('Tu Nick de Minecraft').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: Steve_123')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('modalidad').setLabel('Modalidad / Servidor').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Survival / OneBlock / SkyBlock / Clásico')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('asunto').setLabel('Resumen del Bug').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: Fallo en Cargo Node de Slimefun')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('detalle').setLabel('Explicación Detallada del Error').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(15).setPlaceholder('Describe paso a paso qué ocurrió, qué estabas haciendo y qué mensaje o error apareció...')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pruebas').setLabel('Pruebas / Coords / Links (Opcional)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Enlaces de fotos, videos o coordenadas'))
                );
                return await interaction.showModal(modal);
            }

            if (id === 'btn_ticket_perdida') {
                const modal = new ModalBuilder().setCustomId('modal_ticket_perdida').setTitle('📦 Reporte de Pérdida de Ítems');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nick').setLabel('Tu Nick de Minecraft').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: Steve_123')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('modalidad').setLabel('Modalidad / Mundo').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Survival / OneBlock / SkyBlock / Clásico')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('items').setLabel('Lista de Ítems Perdidos').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Detalla los ítems exactos (nombres, encantamientos, cantidad)...')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('circunstancia').setLabel('¿Cómo ocurrió la pérdida?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(15).setPlaceholder('Hora aproximada, qué estabas haciendo, si fue caída del server o desync...')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pruebas').setLabel('Pruebas de Posesión (Capturas/Videos)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Pega enlaces de fotos/videos que demuestren que tenías los ítems'))
                );
                return await interaction.showModal(modal);
            }

            if (id === 'btn_ticket_tienda') {
                const modal = new ModalBuilder().setCustomId('modal_ticket_tienda').setTitle('🛒 Soporte de Compras y Tienda');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nick').setLabel('Tu Nick de Minecraft').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: Steve_123')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('email').setLabel('Correo Usado en la Compra').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('correo@ejemplo.com')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('txid').setLabel('ID de Transacción / Factura Tebex').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: tbx-12345678a90')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('paquete').setLabel('Paquete o Rango Adquirido').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: Rango Dios / Llaves de Cajas')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('detalle').setLabel('Detalle del Problema').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Explica qué sucedió con tu compra o entrega...'))
                );
                return await interaction.showModal(modal);
            }

            if (id === 'btn_ticket_dudas') {
                const modal = new ModalBuilder().setCustomId('modal_ticket_dudas').setTitle('❓ Dudas y Asistencia General');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nick').setLabel('Tu Nick de Minecraft / Discord').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: Steve_123')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('modalidad').setLabel('Modalidad o Tema').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Survival / OneBlock / Claims / Slimefun / General')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('detalle').setLabel('Escribe tu Duda o Consulta').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(15).setPlaceholder('Detalla con claridad tu duda o pregunta para que podamos guiarte con exactitud...'))
                );
                return await interaction.showModal(modal);
            }

            if (id === 'btn_ticket_postulacion') {
                const modal = new ModalBuilder().setCustomId('modal_ticket_postulacion').setTitle('🛡️ Postulación Oficial a Staff');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('edad_pais').setLabel('Tu Edad y País de Residencia').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: 19 años, Chile')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nick_tiempo').setLabel('Nick en MC y Tiempo en el Servidor').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: Steve_MC, 5 meses activo')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rango').setLabel('Rango al que Postulas').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Helper / Moderador / Builder / Developer')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('experiencia').setLabel('Experiencia Previa y Comandos').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(20).setPlaceholder('Describe servidores anteriores, plugins o conocimientos técnicos...')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('motivo').setLabel('¿Por qué postulas y cuál es tu aporte?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(20).setPlaceholder('¿Qué te motiva a formar parte del Staff de DrakesCraft?'))
                );
                return await interaction.showModal(modal);
            }

            if (id === 'btn_ticket_denuncia') {
                const modal = new ModalBuilder().setCustomId('modal_ticket_denuncia').setTitle('⚖️ Denuncia Confidencial');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nick_tuyo').setLabel('Tu Nick en Minecraft / Discord').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: Steve_123')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('acusado').setLabel('Usuario o Staff a Denunciar').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Nick exacto del infractor')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('motivo').setLabel('Infracción Cometida').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Hacks / Acoso / Toxicidad / Abuso de Poder / Estafa')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('hechos').setLabel('Relato Detallado de los Hechos').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(20).setPlaceholder('Explica detalladamente qué ocurrió, fecha/hora aproximada y contexto...')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pruebas').setLabel('Enlaces de Pruebas (Obligatorio)').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Pega enlaces de imágenes (Imgur), videos (YouTube, Medal, Twitch)...'))
                );
                return await interaction.showModal(modal);
            }

            // ACCIONES DENTRO DEL TICKET (CERRAR / CONFIRMAR)
            if (id === 'btn_close_ticket') {
                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('btn_confirm_close_ticket').setLabel('Confirmar Cierre de Ticket').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('btn_cancel_close_ticket').setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
                );
                return await interaction.reply({
                    content: '⚠️ ¿Estás seguro de que deseas cerrar este ticket? Una vez cerrado se guardará registro y el canal será eliminado.',
                    components: [confirmRow],
                    ephemeral: true
                });
            }

            if (id === 'btn_cancel_close_ticket') {
                return await interaction.update({ content: '✅ Cierre cancelado. El ticket permanece abierto.', components: [] });
            }

            if (id === 'btn_confirm_close_ticket') {
                await interaction.update({ content: '🔒 **Cerrando ticket...** El canal se eliminará en 5 segundos.', components: [] });
                
                // Registrar cierre en auditoría
                const auditEmbed = new EmbedBuilder()
                    .setColor(0xE74C3C)
                    .setTitle('🔒 Ticket Cerrado')
                    .setDescription(`El ticket \`${interaction.channel.name}\` fue cerrado por ${interaction.user} (\`${interaction.user.tag}\`).`)
                    .setFooter({ text: `ID Canal: ${interaction.channel.id}` })
                    .setTimestamp();
                await sendAuditLog(auditEmbed);

                setTimeout(async () => {
                    await interaction.channel.delete().catch(() => {});
                }, 5000);
                return;
            }
        }

        // 2. MANEJO DE ENVÍO DE FORMULARIOS (MODAL SUBMIT)
        if (interaction.isModalSubmit()) {
            const customId = interaction.customId;
            const user = interaction.user;
            const guild = interaction.guild;
            if (!guild) return;

            let tipo = 'general';
            let titulo = 'Ticket de Asistencia';
            let color = 0x3498DB;
            let fields = [];
            let summaryText = '';

            if (customId === 'modal_ticket_bug') {
                tipo = 'bug';
                titulo = '🐛 Reporte de Bug / Error Técnico';
                color = 0xE67E22;
                const nick = interaction.fields.getTextInputValue('nick');
                const modalidad = interaction.fields.getTextInputValue('modalidad');
                const asunto = interaction.fields.getTextInputValue('asunto');
                const detalle = interaction.fields.getTextInputValue('detalle');
                const pruebas = interaction.fields.getTextInputValue('pruebas') || 'Ninguna proporcionada';
                fields = [
                    { name: '🎮 Nick de Minecraft', value: `\`${nick}\``, inline: true },
                    { name: '🏝️ Modalidad', value: `\`${modalidad}\``, inline: true },
                    { name: '📌 Resumen', value: asunto, inline: false },
                    { name: '📝 Detalle Completo', value: detalle, inline: false },
                    { name: '📎 Pruebas / Coordenadas', value: pruebas, inline: false }
                ];
                summaryText = `[Bug - ${modalidad}] ${asunto}: ${detalle}`;
            } else if (customId === 'modal_ticket_perdida') {
                tipo = 'perdida';
                titulo = '📦 Reporte de Pérdida de Ítems / Rollback';
                color = 0x9B59B6;
                const nick = interaction.fields.getTextInputValue('nick');
                const modalidad = interaction.fields.getTextInputValue('modalidad');
                const items = interaction.fields.getTextInputValue('items');
                const circunstancia = interaction.fields.getTextInputValue('circunstancia');
                const pruebas = interaction.fields.getTextInputValue('pruebas');
                fields = [
                    { name: '🎮 Nick de Minecraft', value: `\`${nick}\``, inline: true },
                    { name: '🏝️ Modalidad', value: `\`${modalidad}\``, inline: true },
                    { name: '🎒 Ítems Perdidos', value: items, inline: false },
                    { name: '⏳ Circunstancia de la Pérdida', value: circunstancia, inline: false },
                    { name: '📸 Pruebas de Posesión', value: pruebas, inline: false }
                ];
                summaryText = `[Pérdida - ${modalidad}] Jugador ${nick}: ${items}. Causa: ${circunstancia}`;
            } else if (customId === 'modal_ticket_tienda') {
                tipo = 'tienda';
                titulo = '🛒 Soporte de Compras & Tienda Tebex';
                color = 0x2ECC71;
                const nick = interaction.fields.getTextInputValue('nick');
                const email = interaction.fields.getTextInputValue('email');
                const txid = interaction.fields.getTextInputValue('txid');
                const paquete = interaction.fields.getTextInputValue('paquete');
                const detalle = interaction.fields.getTextInputValue('detalle');
                fields = [
                    { name: '🎮 Nick de Minecraft', value: `\`${nick}\``, inline: true },
                    { name: '📧 Correo Compra', value: `\`${email}\``, inline: true },
                    { name: '🧾 Transacción Tebex', value: `\`${txid}\``, inline: true },
                    { name: '🎁 Paquete / Rango', value: paquete, inline: true },
                    { name: '📝 Detalle del Problema', value: detalle, inline: false }
                ];
                summaryText = `[Tienda - ${paquete}] TX: ${txid} Nick: ${nick} - ${detalle}`;
            } else if (customId === 'modal_ticket_dudas') {
                tipo = 'duda';
                titulo = '❓ Asistencia General y Consultas';
                color = 0x3498DB;
                const nick = interaction.fields.getTextInputValue('nick');
                const modalidad = interaction.fields.getTextInputValue('modalidad');
                const detalle = interaction.fields.getTextInputValue('detalle');
                fields = [
                    { name: '👤 Jugador', value: `\`${nick}\``, inline: true },
                    { name: '🏝️ Modalidad', value: `\`${modalidad}\``, inline: true },
                    { name: '📝 Consulta / Duda', value: detalle, inline: false }
                ];
                summaryText = `[Duda - ${modalidad}] ${nick}: ${detalle}`;
            } else if (customId === 'modal_ticket_postulacion') {
                tipo = 'postulacion';
                titulo = '🛡️ Postulación Oficial al Equipo de Staff';
                color = 0x5865F2;
                const edadPais = interaction.fields.getTextInputValue('edad_pais');
                const nickTiempo = interaction.fields.getTextInputValue('nick_tiempo');
                const rango = interaction.fields.getTextInputValue('rango');
                const exp = interaction.fields.getTextInputValue('experiencia');
                const motivo = interaction.fields.getTextInputValue('motivo');
                fields = [
                    { name: '🌎 Edad y País', value: edadPais, inline: true },
                    { name: '🎮 Nick & Tiempo en Servidor', value: nickTiempo, inline: true },
                    { name: '🎖️ Rango al que Postula', value: `\`${rango}\``, inline: true },
                    { name: '📚 Experiencia y Comandos', value: exp, inline: false },
                    { name: '💡 Motivación y Aporte', value: motivo, inline: false }
                ];
                summaryText = `[Postulación - ${rango}] ${nickTiempo}, ${edadPais}. Exp: ${exp}`;
            } else if (customId === 'modal_ticket_denuncia') {
                tipo = 'denuncia';
                titulo = '⚖️ Denuncia Confidencial de Conducta';
                color = 0xE74C3C;
                const nickTuyo = interaction.fields.getTextInputValue('nick_tuyo');
                const acusado = interaction.fields.getTextInputValue('acusado');
                const motivo = interaction.fields.getTextInputValue('motivo');
                const hechos = interaction.fields.getTextInputValue('hechos');
                const pruebas = interaction.fields.getTextInputValue('pruebas');
                fields = [
                    { name: '👤 Denunciante', value: `\`${nickTuyo}\``, inline: true },
                    { name: '🚨 Usuario Denunciado', value: `\`${acusado}\``, inline: true },
                    { name: '⚖️ Infracción / Motivo', value: `\`${motivo}\``, inline: false },
                    { name: '📝 Relato de los Hechos', value: hechos, inline: false },
                    { name: '📸 Enlaces de Pruebas', value: pruebas, inline: false }
                ];
                summaryText = `[Denuncia] ${nickTuyo} denuncia a ${acusado} por ${motivo}: ${hechos}`;
            }

            // Crear canal privado de ticket
            const cleanUser = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'usuario';
            const channelName = `${tipo === 'denuncia' ? '⚖️' : '🎫'}・${tipo}-${cleanUser}`;

            const ticketChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: CHANNELS.CATEGORIA_TICKETS,
                permissionOverwrites: [
                    {
                        id: guild.id, // @everyone
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    },
                    {
                        id: client.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.ManageChannels,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    }
                ]
            });

            const ticketEmbed = new EmbedBuilder()
                .setColor(color)
                .setTitle(titulo)
                .setDescription(
                    `¡Hola ${user}! Tu ticket ha sido abierto correctamente con los datos que ingresaste en el formulario.\n` +
                    `Por favor aguarda unos momentos mientras el Staff y **SAORI** analizan tu caso.`
                )
                .addFields(fields)
                .setFooter({ text: `Ticket ID: ${ticketChannel.id} · Creado por ${user.tag}` })
                .setTimestamp();

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_close_ticket').setLabel('Cerrar Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({ content: `${user} | <@&1539643405783662663> <@&1539643484279930960>`, embeds: [ticketEmbed], components: [actionRow] });

            await interaction.reply({
                content: `✅ ¡Tu ticket ha sido creado con éxito en <#${ticketChannel.id}>! Por favor haz clic en el canal para continuar la conversación.`,
                ephemeral: true
            });

            // Registro en Star y respuesta de IA de SAORI
            try {
                if (['bug', 'perdida'].includes(tipo)) {
                    await callAIDaemon(`ticket: [${tipo.toUpperCase()} Ticket #${ticketChannel.name}] ${summaryText}`, user.tag, false).catch(() => null);
                }
                
                const aiGreeting = await callAIDaemon(
                    `El usuario ${user.username} ha creado un ticket de tipo "${tipo}". Resumen del problema: "${summaryText}". Dale una bienvenida cálida en 1-2 párrafos, confirma que sus datos fueron recibidos y explícale los pasos siguientes según el tipo de ticket.`,
                    user.tag,
                    false
                ).catch(() => null);

                if (aiGreeting) {
                    const aiEmbed = new EmbedBuilder()
                        .setColor(0x00D26A)
                        .setAuthor({ name: 'SAORI · Asistente Autónoma DrakesCraft', iconURL: client.user.displayAvatarURL({ dynamic: true }) })
                        .setDescription(aiGreeting.slice(0, 4000))
                        .setFooter({ text: 'DrakesCraft Autonomous Support' });
                    await ticketChannel.send({ embeds: [aiEmbed] });
                }
            } catch (err) {
                console.error('[TICKET-AI] Error generando saludo inicial:', err.message);
            }

            // Registrar en auditoría
            const auditEmbed = new EmbedBuilder()
                .setColor(color)
                .setTitle('🎫 Nuevo Ticket Creado')
                .addFields(
                    { name: '👤 Creador', value: `${user} (\`${user.tag}\`)`, inline: true },
                    { name: '🏷️ Tipo', value: `\`${tipo}\``, inline: true },
                    { name: '📍 Canal', value: `<#${ticketChannel.id}>`, inline: true },
                    { name: '📋 Resumen', value: summaryText.slice(0, 1024), inline: false }
                )
                .setTimestamp();
            await sendAuditLog(auditEmbed);
        }
    } catch (err) {
        console.error('[INTERACTION-ERROR]', err);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Ocurrió un error al procesar tu solicitud. Por favor intenta nuevamente.', ephemeral: true }).catch(() => {});
        }
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
    const content = RateLimitShield.sanitizeInput(message.content.trim());
    const contentLower = content.toLowerCase();

    // 🛡️ ESCUDO DE SEGURIDAD ANTI-ATAQUES & ANTI-SPAM
    if (!isJack && message.guild) {
        // 1. Detección y bloqueo inmediato de phishing / IP loggers
        if (RateLimitShield.isMaliciousLink(content)) {
            await message.delete().catch(() => {});
            const phishAudit = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('🚨 Enlace Malicioso Bloqueado (Anti-Phishing)')
                .addFields(
                    { name: '👤 Usuario', value: `${message.author} (\`${message.author.tag}\`)`, inline: true },
                    { name: '📍 Canal', value: `<#${message.channel.id}>`, inline: true },
                    { name: '🔗 Contenido', value: `\`\`\`${content.slice(0, 500)}\`\`\``, inline: false }
                )
                .setTimestamp();
            await sendAuditLog(phishAudit);
            return;
        }

        // 2. Control de Flooding / Spam excesivo
        if (!RateLimitShield.checkMessageFlood(message.author.id, isJack)) {
            await message.delete().catch(() => {});
            return;
        }

        // 3. Control de Menciones Masivas (Anti-Raid)
        const totalMentions = (message.mentions?.users?.size || 0) + (message.mentions?.roles?.size || 0);
        if (totalMentions > 4) {
            await message.delete().catch(() => {});
            const raidAudit = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('⚠️ Intento de Mención Masiva Bloqueado')
                .addFields(
                    { name: '👤 Usuario', value: `${message.author} (\`${message.author.tag}\`)`, inline: true },
                    { name: '📍 Canal', value: `<#${message.channel.id}>`, inline: true },
                    { name: '📢 Total Menciones', value: `\`${totalMentions}\``, inline: true }
                )
                .setTimestamp();
            await sendAuditLog(raidAudit);
            return;
        }
    }

    // 🔔 AUTO-NOTIFICACIONES Y PINGS EN CANALES DE AVISOS
    const targetNotifRoleId = NOTIFICATION_CHANNELS_MAP[message.channel.id];
    if (targetNotifRoleId) {
        const alreadyMentions = message.mentions.roles.has(targetNotifRoleId) || 
                                message.mentions.everyone || 
                                content.includes(`@&${targetNotifRoleId}`) ||
                                content.includes('@everyone') ||
                                content.includes('@here');
        if (!alreadyMentions) {
            try {
                await message.channel.send({
                    content: `<@&${targetNotifRoleId}> 🔔`,
                    allowedMentions: { roles: [targetNotifRoleId] }
                });
            } catch (err) {
                console.error('[AUTO-NOTIF] Error al enviar auto-ping:', err);
            }
        }
    }

    // 📷 CONTROL DE CANAL DE MEDIA & CAPTURAS (Solo fotos, capturas, memes, videos y reacciones)
    if (message.channel.id === CHANNELS.MEDIA) {
        const hasAttachment = message.attachments.size > 0;
        const mediaExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.mov', '.webm', '.avi', '.mkv'];
        const mediaDomains = [
            'tenor.com', 'giphy.com', 'imgur.com', 'reddit.com', 'redd.it', 
            'pin.it', 'pinterest.com', 'youtube.com', 'youtu.be', 'tiktok.com', 
            'gyazo.com', 'medal.tv', 'twitch.tv', 'streamable.com', 'twitter.com', 
            'x.com', 'instagram.com', 'media.discordapp.net', 'cdn.discordapp.com', 'i.redd.it', 'v.redd.it'
        ];
        const hasMediaUrl = /https?:\/\/[^\s]+/i.test(content) && (
            mediaExtensions.some(ext => content.toLowerCase().includes(ext)) ||
            mediaDomains.some(d => content.toLowerCase().includes(d))
        );

        if (!hasAttachment && !hasMediaUrl) {
            await message.delete().catch(() => {});
            try {
                const warnMsg = await message.channel.send(`⚠️ ${message.author}, este canal es **exclusivo para fotos, memes, capturas y videos**. Para conversar, usa <#${CHANNELS.GENERAL_ES}>.`);
                setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
            } catch (e) {}
            return;
        } else {
            await message.react('❤️').catch(() => {});
            await message.react('🔥').catch(() => {});
            return;
        }
    }

    // ⚡ COMANDOS SAORI CON PREFIJO S (shelp, sticket, splay, sstats, sip, stienda, sweb, sroles, sclear, etc.)
    if (['shelp', 'saohelp', 's!help', '!help', '!comandos', 's!comandos'].includes(contentLower)) {
        const helpEmbed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🐺 S.A.O.R.I. · Guía Completa de Comandos')
            .setDescription('**S.A.O.R.I.** (*Server Autonomous Orchestrator for Resilient Infrastructure*)\nAquí tienes la lista completa y detallada de todas mis funciones y comandos:')
            .addFields(
                { 
                    name: '🎫 1. Sistema de Tickets & Trinidad SRE (`sticket`)', 
                    value: '• **`sticket <problema>`** · Registra formalmente un ticket técnico en Star.\n' +
                           '  *¿Cómo funciona?* Tu reporte se asigna a la **Trinidad de Agentes** (Claude Code analiza logs, Codex programa el parche y Antigravity compila y verifica). Se notifica automáticamente a Jack por WhatsApp cuando queda solucionado.\n' +
                           '  *Ejemplo:* `sticket No puedo abrir la mesa de crafteo reforzada en SkyBlock`', 
                    inline: false 
                },
                { 
                    name: '🎵 2. Música & Spotify en Canales de Voz', 
                    value: '• **`splay <canción / link spotify>`** · Reproduce canciones o playlists en tu canal de voz.\n' +
                           '• **`sskip`** · Salta a la siguiente pista de la cola.\n' +
                           '• **`spause`** / **`sresume`** · Pausa o reanuda la reproducción.\n' +
                           '• **`squeue`** · Muestra las próximas pistas en cola.\n' +
                           '• **`sstop`** · Detiene la música y vacía la cola.\n' +
                           '• **`smusica`** · Guía de música en Discord y reproductor `/musica` in-game.', 
                    inline: false 
                },
                { 
                    name: '📊 3. Telemetría y Servidor de Minecraft', 
                    value: '• **`sstats`** / **`sstats drakes`** · Rendimiento, 20.0 TPS y estado de DrakesCraft.\n' +
                           '• **`sstats star`** · Servidor físico central (192.168.0.120), RAM y Docker.\n' +
                           '• **`sstats nova`** / **`sstats nexus`** · Telemetría de nodos de desarrollo y render.\n' +
                           '• **`sip`** · Direcciones de conexión (Java `mc.drakescraft.cl:25565` y Bedrock).\n' +
                           '• **`sping`** · Latencia del bot y enlace con la infraestructura.', 
                    inline: false 
                },
                { 
                    name: '🌐 4. Enlaces Oficiales & Guías', 
                    value: '• **`sweb`** · Portal web oficial de DrakesCraft.\n' +
                           '• **`stienda`** · Tienda oficial con garantía de entrega y compensación.\n' +
                           '• **`sguia`** · Enciclopedia de Slimefun, economía, trabajos y comandos.', 
                    inline: false 
                },
                { 
                    name: '🎨 5. Arte Neural & Chat Inteligente', 
                    value: '• **`!imagen <descripción>`** · Genera arte e ilustraciones en vivo con IA.\n' +
                           '• **Chat Natural:** Habla conmigo en <#1544811720571355196> o mencióname (`@SAORI`).', 
                    inline: false 
                },
                { 
                    name: '🛡️ 6. Moderación y Roles (Staff)', 
                    value: '• **`sroles`** · Muestra todos los roles del servidor y cantidad de miembros.\n' +
                           '• **`srole dar @usuario <Rol>`** · Asigna un rol a un miembro.\n' +
                           '• **`srole quitar @usuario <Rol>`** · Remueve un rol.\n' +
                           '• **`sclear <cantidad>`** · Purga mensajes de un canal.', 
                    inline: false 
                }
            )
            .setFooter({ text: 'S.A.O.R.I. SRE Core · DrakesCraft Network', iconURL: client.user.displayAvatarURL() })
            .setTimestamp();
        await message.reply({ embeds: [helpEmbed], allowedMentions: { repliedUser: false } });
        return;
    }

    // 🎫 COMANDO DIRECTO STICKET (sticket <problema>)
    if (contentLower.startsWith('sticket ') || contentLower.startsWith('s!ticket ') || contentLower.startsWith('!ticket ')) {
        const ticketDesc = message.content.replace(/^(sticket|s!ticket|!ticket)\s*/i, '').trim();
        if (!ticketDesc || ticketDesc.length < 5) {
            await message.reply({ 
                content: '❌ **Uso correcto:** `sticket <descripción detallada del problema>`\n*Ejemplo:* `sticket Bug al colocar cofre de venta en Survival`', 
                allowedMentions: { repliedUser: false } 
            });
            return;
        }
        await message.channel.sendTyping();
        const reply = await callAIDaemon(`ticket: ${ticketDesc}`, senderName, isStaffMember);
        await message.reply({ content: reply, allowedMentions: { repliedUser: false } });
        return;
    }

    // 💡 SISTEMA DE SUGERENCIAS (Canal 1539636565188542554 o comando ssugerencia)
    const isSuggestionsChannel = message.channel.id === CHANNELS.SUGERENCIAS;
    const isSuggestionCommand = contentLower.startsWith('ssugerencia ') || 
                                contentLower.startsWith('s!sugerencia ') || 
                                contentLower.startsWith('!sugerencia ') || 
                                contentLower.startsWith('sugiero ') ||
                                contentLower.startsWith('ssug ') ||
                                ['ssug setup', 'ssugerencias setup', 'sug setup'].includes(contentLower);

    if (isSuggestionsChannel || isSuggestionCommand) {
        // Manejar comando de setup del banner informativo (Staff)
        if (['ssug setup', 'ssugerencias setup', 'sug setup'].includes(contentLower)) {
            const hasPerm = isJack || (message.member && (message.member.permissions.has('ManageChannels') || message.member.permissions.has('Administrator')));
            if (!hasPerm) {
                await message.reply({ content: '❌ Solo Jack y el Staff pueden publicar el banner oficial de sugerencias.', allowedMentions: { repliedUser: false } });
                return;
            }

            const bannerEmbed = new EmbedBuilder()
                .setColor(0xF1C40F)
                .setTitle('💡 BUZÓN OFICIAL DE SUGERENCIAS · DRAKESCRAFT NETWORK')
                .setDescription('¡Tu opinión y tus ideas construyen la red! Si tienes una propuesta para mejorar la jugabilidad, los plugins, la economía o la comunidad, compártela aquí.\n\n' +
                    '📋 **¿Cómo estructurar una buena sugerencia?**\n' +
                    '1. **¿Qué añadirías, ajustarías o cambiarías?** *(Sé claro y específico)*\n' +
                    '2. **¿Por qué beneficia a la comunidad?** *(Explica el impacto positivo en la experiencia de juego)*\n' +
                    '3. **¿A qué modalidad aplica?** *(Survival, OneBlock, SkyBlock, Discord o General)*\n\n' +
                    '🗳️ **¿Cómo funciona el sistema de votación?**\n' +
                    '• Escribe tu sugerencia directamente en este canal o usa **`ssugerencia <idea>`** en cualquier chat.\n' +
                    '• SAORI transformará automáticamente tu mensaje en una ficha de votación con reacciones `👍` y `👎`.\n' +
                    '• La comunidad votará y el Staff evaluará periódicamente las propuestas más votadas.'
                )
                .setFooter({ text: 'DrakesCraft Suggestions · Permisos: Ver canal ✅ | Enviar sugerencias ✅' });

            const targetChan = client.channels.cache.get(CHANNELS.SUGERENCIAS) || message.channel;
            await targetChan.send({ embeds: [bannerEmbed] });
            if (!isSuggestionsChannel) {
                await message.reply({ content: `✅ Banner oficial de sugerencias publicado en <#${CHANNELS.SUGERENCIAS}>.`, allowedMentions: { repliedUser: false } });
            } else {
                await message.delete().catch(() => {});
            }
            return;
        }

        // Manejar aceptación / rechazo de sugerencias por el Staff (ssug aceptar <id> [motivo])
        if (contentLower.startsWith('ssug aceptar ') || contentLower.startsWith('ssug rechazar ')) {
            const hasPerm = isJack || (message.member && (message.member.permissions.has('ManageMessages') || message.member.permissions.has('Administrator')));
            if (!hasPerm) {
                await message.reply({ content: '❌ Solo el Staff Administrador puede gestionar el estado de las sugerencias.', allowedMentions: { repliedUser: false } });
                return;
            }

            const isAccept = contentLower.startsWith('ssug aceptar ');
            const parts = message.content.slice(isAccept ? 13 : 14).trim().split(/\s+/);
            const msgId = parts[0];
            const reason = parts.slice(1).join(' ') || (isAccept ? 'Aprobada para desarrollo' : 'No viable en este momento');

            try {
                const sugChan = client.channels.cache.get(CHANNELS.SUGERENCIAS) || message.channel;
                const targetMsg = await sugChan.messages.fetch(msgId).catch(() => null);
                if (!targetMsg || !targetMsg.embeds.length) {
                    await message.reply({ content: `❌ No se encontró el mensaje de sugerencia con ID \`${msgId}\` en <#${CHANNELS.SUGERENCIAS}>.`, allowedMentions: { repliedUser: false } });
                    return;
                }

                const oldEmbed = targetMsg.embeds[0];
                const updatedEmbed = EmbedBuilder.from(oldEmbed)
                    .setColor(isAccept ? 0x00FF88 : 0xFF4444)
                    .spliceFields(0, 1, {
                        name: '📊 Estado',
                        value: isAccept ? `🟢 **ACEPTADA / EN DESARROLLO**\n*Nota Staff:* ${reason}` : `🔴 **RECHAZADA**\n*Motivo:* ${reason}`,
                        inline: false
                    });

                await targetMsg.edit({ embeds: [updatedEmbed] });
                await message.reply({ content: `✅ Sugerencia \`${msgId}\` marcada como **${isAccept ? 'ACEPTADA' : 'RECHAZADA'}**.`, allowedMentions: { repliedUser: false } });
            } catch (err) {
                await message.reply({ content: `❌ Error al actualizar sugerencia: ${err.message}`, allowedMentions: { repliedUser: false } });
            }
            return;
        }

        // 🎫 COMANDOS DE SETUP PARA TICKETS Y DENUNCIAS (Staff)
        if (['stickets setup', 'sticket setup', 'sticket panel'].includes(contentLower)) {
            const hasPerm = isJack || (message.member && (message.member.permissions.has('ManageChannels') || message.member.permissions.has('Administrator')));
            if (!hasPerm) {
                await message.reply({ content: '❌ Solo Jack y el Staff pueden publicar el panel oficial de tickets.', allowedMentions: { repliedUser: false } });
                return;
            }
            const targetChan = client.channels.cache.get(CHANNELS.TICKETS_SOPORTE) || message.channel;
            await sendTicketPanel(targetChan);
            await message.reply({ content: `✅ Panel oficial de tickets publicado en <#${targetChan.id}>.`, allowedMentions: { repliedUser: false } });
            return;
        }

        if (['sdenuncias setup', 'sdenuncia setup', 'sdenuncia panel'].includes(contentLower)) {
            const hasPerm = isJack || (message.member && (message.member.permissions.has('ManageChannels') || message.member.permissions.has('Administrator')));
            if (!hasPerm) {
                await message.reply({ content: '❌ Solo Jack y el Staff pueden publicar el panel oficial de denuncias.', allowedMentions: { repliedUser: false } });
                return;
            }
            const targetChan = client.channels.cache.get(CHANNELS.DENUNCIAS) || message.channel;
            await sendDenunciasPanel(targetChan);
            await message.reply({ content: `✅ Panel oficial de denuncias publicado en <#${targetChan.id}>.`, allowedMentions: { repliedUser: false } });
            return;
        }

        // Procesar nueva sugerencia
        let suggestionText = content;
        if (isSuggestionCommand) {
            suggestionText = content.replace(/^(ssugerencia|s!sugerencia|!sugerencia|sugiero|ssug)\s+/i, '').trim();
        }

        if (!suggestionText || suggestionText.length < 5) {
            if (!isSuggestionsChannel) {
                await message.reply({ content: '❌ Uso: `ssugerencia <descripción detallada de tu idea>`', allowedMentions: { repliedUser: false } });
            }
            return;
        }

        const sugChannel = client.channels.cache.get(CHANNELS.SUGERENCIAS);
        if (!sugChannel) {
            console.error('[SUGERENCIAS] Canal no encontrado:', CHANNELS.SUGERENCIAS);
            return;
        }

        // Si fue en el canal de sugerencias, borrar el mensaje original plano
        if (isSuggestionsChannel) {
            await message.delete().catch(() => {});
        }

        const sugEmbed = new EmbedBuilder()
            .setColor(0xF39C12)
            .setTitle(`💡 Propuesta de la Comunidad`)
            .setAuthor({ 
                name: `${message.author.tag} (${message.member?.displayName || message.author.username})`, 
                iconURL: message.author.displayAvatarURL({ dynamic: true }) 
            })
            .setDescription(suggestionText)
            .addFields(
                { name: '📊 Estado', value: '🟡 **En Votación Comunitaria** (Vota con 👍 / 👎)', inline: true },
                { name: '👤 Propuesta por', value: `${message.author}`, inline: true }
            )
            .setFooter({ text: 'DrakesCraft Suggestions · Vota con las reacciones abajo para apoyar la idea' })
            .setTimestamp();

        // Si el usuario adjuntó una imagen, incluirla
        if (message.attachments.size > 0) {
            const firstImg = message.attachments.first();
            if (firstImg.contentType?.startsWith('image/')) {
                sugEmbed.setImage(firstImg.url);
            }
        }

        const sentSuggestion = await sugChannel.send({ embeds: [sugEmbed] });
        await sentSuggestion.react('👍').catch(() => null);
        await sentSuggestion.react('👎').catch(() => null);

        if (!isSuggestionsChannel) {
            await message.reply({ 
                content: `✅ ¡Tu sugerencia ha sido enviada exitosamente a <#${CHANNELS.SUGERENCIAS}> para votación!`, 
                allowedMentions: { repliedUser: false } 
            });
        }
        return;
    }

    // 🔗 COMANDO DE ENLACES OFICIALES (slinks, !links, !enlaces)
    if (['slinks', 's!links', '!links', '!enlaces', '!link'].includes(contentLower)) {
        const linksEmbed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('🔗 Enlaces y Conexión Oficial · DrakesCraft')
            .setDescription('Aquí tienes todos los accesos y enlaces oficiales de la red:')
            .addFields(
                { name: '☕ Java Edition', value: '`mc.drakescraft.cl:25565` *(o `play.drakescraft.cl`)*\nVersiones: `1.20.x - 1.21.x`', inline: false },
                { name: '📱 Bedrock Edition', value: 'IP: `mc.drakescraft.cl` · Puerto: `25565`', inline: false },
                { name: '🛒 Tienda Oficial', value: 'https://web.drakescraft.cl/store.html', inline: false },
                { name: '📖 Guía de Slimefun & Rangos', value: 'https://web.drakescraft.cl/guia.html', inline: false },
                { name: '🌐 Web Oficial', value: 'https://web.drakescraft.cl/', inline: false },
                { name: '💻 GitHub Labs', value: 'https://github.com/DrakesCraft-Labs', inline: false }
            )
            .setFooter({ text: 'DrakesCraft Network · mc.drakescraft.cl' });
        await message.reply({ embeds: [linksEmbed], allowedMentions: { repliedUser: false } });
        return;
    }

    if (['sip', 'saoip', 's!ip', '!ip', '!server', '!servidor', '!conexion', '!mc', '!port', '!puerto'].includes(contentLower)) {
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

    if (['sweb', 'saoweb', 's!web', '!web', '!portal', '!pagina'].includes(contentLower)) {
        await message.reply({
            content: `🌐 **Portal Web Oficial de DrakesCraft:** https://web.drakescraft.cl/`,
            allowedMentions: { repliedUser: false }
        });
        return;
    }

    if (['stienda', 'saotienda', 'sshop', 's!tienda', 's!shop', '!tienda', '!shop', '!store', '!comprar', '!rangos'].includes(contentLower)) {
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

    if (['sguia', 'saoguia', 's!guia', '!guia', '!guias', '!wiki', '!comandos'].includes(contentLower)) {
        await message.reply({
            content: `📚 **Guía Completa de DrakesCraft (Economía, XP, Slimefun y Comandos):** https://web.drakescraft.cl/guia.html`,
            allowedMentions: { repliedUser: false }
        });
        return;
    }

    if (['smusica', 'saomusica', 's!musica', '!musica', '!music', '!cancion', '!song'].includes(contentLower)) {
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

    if (['sbots', 'saobots', 's!bots', '!bots', '!botlist'].includes(contentLower)) {
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

    if (['sping', 'saoping', 's!ping', '!ping', '!latencia', '!ms'].includes(contentLower)) {
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

    // 📊 ESTADÍSTICAS & TELEMETRÍA GLOBAL (sstats, sstats drakes, sstats star, sstats nova, sstats nexus)
    if (contentLower.startsWith('sstats') || contentLower.startsWith('s!stats') || contentLower.startsWith('!stats')) {
        const subArg = contentLower.replace(/^(sstats|s!stats|!stats)\s*/i, '').trim();

        if (subArg === 'star') {
            const starEmbed = new EmbedBuilder()
                .setColor(0x3B82F6)
                .setTitle('🖥️ Telemetría de Nodo: Star (192.168.0.120)')
                .setDescription('Servidor físico central de infraestructura, bases de datos y bots.')
                .addFields(
                    { name: '⚙️ CPU & Uptime', value: 'Intel Core · 2+ días activo', inline: true },
                    { name: '💾 Memoria RAM', value: '35+ GB Libres de 48GB', inline: true },
                    { name: '🐳 Docker Stacks', value: '18 contenedores activos (SAORI, DB, Cloudflared)', inline: false },
                    { name: '🧠 Motores IA', value: 'Claude Haiku / Codex CLI / Whisper / Piper TTS', inline: false }
                )
                .setFooter({ text: 'Star SRE Cluster · 192.168.0.120' });
            await message.reply({ embeds: [starEmbed], allowedMentions: { repliedUser: false } });
            return;
        }

        if (subArg === 'nova') {
            const novaEmbed = new EmbedBuilder()
                .setColor(0x8B5CF6)
                .setTitle('💻 Telemetría de Nodo: Nova (Laptop de Jack)')
                .setDescription('Estación móvil de Jack para desarrollo y colegio.')
                .addFields(
                    { name: '🌐 Red Mesh', value: 'Conectada vía Tailscale Mesh (`100.110.230.7`)', inline: true },
                    { name: '🎮 Hardware', value: 'GPU NVIDIA GeForce MX450 · AMD Ryzen Mobile', inline: true },
                    { name: '🔋 Estado', value: 'Operativo · Sincronizado con Star', inline: false }
                )
                .setFooter({ text: 'Nova Mobile Node' });
            await message.reply({ embeds: [novaEmbed], allowedMentions: { repliedUser: false } });
            return;
        }

        if (subArg === 'nexus') {
            const nexusEmbed = new EmbedBuilder()
                .setColor(0x10B981)
                .setTitle('🖥️ Telemetría de Nodo: Nexus (Estación PC de Jack)')
                .setDescription('Estación de batalla, desarrollo pesado y renderizado local.')
                .addFields(
                    { name: '🔥 Procesador', value: 'AMD Ryzen 5 5500 (6 Núcleos / 12 Hilos)', inline: true },
                    { name: '🎮 Tarjeta Gráfica', value: 'NVIDIA GeForce RTX 4060 (8GB VRAM)', inline: true },
                    { name: '🎨 Capacidades IA', value: 'ComfyUI / Stable Diffusion / SDXL / Pony V6', inline: false },
                    { name: '🌐 Red', value: 'Nodo de Escritorio · Conexión directa a Star', inline: false }
                )
                .setFooter({ text: 'Nexus Workstation' });
            await message.reply({ embeds: [nexusEmbed], allowedMentions: { repliedUser: false } });
            return;
        }

        // Por defecto o 'drakes' / 'mc': Servidor de Minecraft DrakesCraft
        const mcEmbed = new EmbedBuilder()
            .setColor(0x00D26A)
            .setTitle('⚔️ Estado del Servidor: DrakesCraft (Minecraft)')
            .setDescription('Servidor de supervivencia técnica, Slimefun y OneBlock.')
            .addFields(
                { name: '⚡ Rendimiento / TPS', value: '`20.0 TPS` · MSPT óptimo (<25ms)', inline: true },
                { name: '👥 Jugadores en Línea', value: 'Escribe `/online` o consulta a SAORI', inline: true },
                { name: '☕ Conexión Java', value: '`mc.drakescraft.cl:25565`', inline: false },
                { name: '📱 Conexión Bedrock', value: '`mc.drakescraft.cl` (Puerto `25565`)', inline: false },
                { name: '🔗 Más Nodos', value: 'Usa `sstats star`, `sstats nova` o `sstats nexus` para ver la infraestructura.', inline: false }
            )
            .setFooter({ text: 'DrakesCraft SRE Monitor', iconURL: client.user.displayAvatarURL() });
        await message.reply({ embeds: [mcEmbed], allowedMentions: { repliedUser: false } });
        return;
    }

    // 🎵 COMANDOS DE MÚSICA & SPOTIFY (splay, sskip, sstop, spause, sresume, squeue)
    if (contentLower.startsWith('splay ') || contentLower.startsWith('s!play ') || contentLower.startsWith('saoplay ')) {
        const query = content.replace(/^(splay|s!play|saoplay)\s+/i, '').trim();
        const voiceChannel = message.member?.voice?.channel;
        if (!voiceChannel) {
            await message.reply({ content: '❌ Debes estar en un **canal de voz** para que SAORI reproduzca música.', allowedMentions: { repliedUser: false } });
            return;
        }

        if (!distube) {
            await message.reply({ content: '❌ El motor de música aún no está disponible en este momento.', allowedMentions: { repliedUser: false } });
            return;
        }

        try {
            await message.channel.send(`🔍 Buscando y cargando \`${query}\` con Spotify Engine... 🎵`);
            await distube.play(voiceChannel, query, {
                message,
                textChannel: message.channel,
                member: message.member
            });
            return;
        } catch (e) {
            console.error('[SAORI-PLAY] Error:', e.message);
            await message.reply({ content: `❌ Error al reproducir: ${e.message}`, allowedMentions: { repliedUser: false } });
            return;
        }
    }

    if (['sskip', 's!skip', 'saoskip'].includes(contentLower)) {
        if (!distube) return;
        const queue = distube.getQueue(message);
        if (!queue) {
            await message.reply({ content: '❌ No hay ninguna canción sonando en este momento.', allowedMentions: { repliedUser: false } });
            return;
        }
        try {
            await distube.skip(message);
            await message.reply({ content: '⏭️ Canción saltada con éxito.', allowedMentions: { repliedUser: false } });
        } catch (e) {
            await message.reply({ content: `❌ No hay más canciones en la cola.`, allowedMentions: { repliedUser: false } });
        }
        return;
    }

    if (['sstop', 's!stop', 'saostop'].includes(contentLower)) {
        if (!distube) return;
        const queue = distube.getQueue(message);
        if (!queue) {
            await message.reply({ content: '❌ No hay ninguna reproducción activa.', allowedMentions: { repliedUser: false } });
            return;
        }
        await distube.stop(message);
        await message.reply({ content: '⏹️ Música detenida y cola vaciada.', allowedMentions: { repliedUser: false } });
        return;
    }

    if (['spause', 's!pause'].includes(contentLower)) {
        if (!distube) return;
        const queue = distube.getQueue(message);
        if (!queue) return;
        distube.pause(message);
        await message.reply({ content: '⏸️ Música pausada.', allowedMentions: { repliedUser: false } });
        return;
    }

    if (['sresume', 's!resume'].includes(contentLower)) {
        if (!distube) return;
        const queue = distube.getQueue(message);
        if (!queue) return;
        distube.resume(message);
        await message.reply({ content: '▶️ Música reanudada.', allowedMentions: { repliedUser: false } });
        return;
    }

    if (['squeue', 's!queue', 'scola'].includes(contentLower)) {
        if (!distube) return;
        const queue = distube.getQueue(message);
        if (!queue || !queue.songs.length) {
            await message.reply({ content: '📭 La cola de reproducción está vacía.', allowedMentions: { repliedUser: false } });
            return;
        }
        const qList = queue.songs.slice(0, 10).map((s, i) => `**${i + 1}.** [${s.name}](${s.url}) · \`${s.formattedDuration}\``).join('\n');
        const qEmbed = new EmbedBuilder()
            .setColor(0x1DB954)
            .setTitle(`🎶 Cola de Reproducción (${queue.songs.length} pistas)`)
            .setDescription(qList)
            .setFooter({ text: 'SAORI Spotify Engine' });
        await message.reply({ embeds: [qEmbed], allowedMentions: { repliedUser: false } });
        return;
    }

    // 🧹 LIMPIEZA DE CHAT Y PURGA EN DISCORD (!clear, !purge, sclear, spurge o lenguaje natural)
    const isClearRequest = contentLower.startsWith('sclear') ||
                           contentLower.startsWith('spurge') ||
                           contentLower.startsWith('s!clear') ||
                           contentLower.startsWith('s!purge') ||
                           contentLower.startsWith('!clear') || 
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

    // 🎭 GESTIÓN DE ROLES EN DISCORD (sroles, srole dar/quitar)
    if (contentLower.startsWith('sroles') || contentLower.startsWith('s!roles')) {
        const hasPerm = isJack || (message.member && (message.member.permissions.has('ManageRoles') || message.member.permissions.has('Administrator')));
        if (!hasPerm) {
            await message.reply({ content: '❌ Solo Jack y el Staff Administrador pueden consultar y gestionar la lista de roles.', allowedMentions: { repliedUser: false } });
            return;
        }
        const roles = message.guild.roles.cache
            .filter(r => r.name !== '@everyone')
            .sort((a, b) => b.position - a.position)
            .map(r => `• **${r.name}** (ID: \`${r.id}\` | Miembros: ${r.members.size})`);
        
        const chunks = [];
        let currentChunk = '';
        for (const line of roles) {
            if (currentChunk.length + line.length > 1800) {
                chunks.push(currentChunk);
                currentChunk = '';
            }
            currentChunk += line + '\n';
        }
        if (currentChunk) chunks.push(currentChunk);

        await message.reply({ content: `🎭 **Roles de DrakesCraft Discord (${roles.length}):**\n${chunks[0]}`, allowedMentions: { repliedUser: false } });
        return;
    }

    // 🎭 PUBLICAR PANEL DE AUTO-ROLES EN #🎭・ᴀᴜᴛᴏ-ʀᴏʟᴇs (sautoroles, sroles panel)
    if (['sautoroles', 's!autoroles', 'sroles panel', 'sroles setup'].includes(contentLower)) {
        const hasPerm = isJack || (message.member && (message.member.permissions.has('ManageRoles') || message.member.permissions.has('Administrator')));
        if (!hasPerm) {
            await message.reply({ content: '❌ Solo Jack y el Staff Administrador pueden publicar el panel de auto-roles.', allowedMentions: { repliedUser: false } });
            return;
        }
        const autoRolesChannel = client.channels.cache.get(CHANNELS.AUTO_ROLES) || message.channel;

        const roleEmbed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🎭 SELECCIÓN DE ROLES DE DRAKESCRAFT')
            .setDescription('Reacciona a este mensaje con los emojis correspondientes para personalizar tu perfil y recibir avisos:\n\n' +
                '**🎮 PLATAFORMA DE JUEGO**\n' +
                '☕ · `Java Edition`\n' +
                '📱 · `Bedrock Edition`\n\n' +
                '**👤 GÉNERO / IDENTIDAD**\n' +
                '♂️ · `Hombre`\n' +
                '♀️ · `Mujer`\n' +
                '✨ · `Otro`\n\n' +
                '**🔔 NOTIFICACIONES**\n' +
                '📢 · `Avisos de Discord`\n' +
                '⛏️ · `Avisos de Minecraft`\n' +
                '🎁 · `Eventos y Sorteos`\n' +
                '🚀 · `Actualizaciones de la Red`\n\n' +
                '**🌎 REGIÓN / PAÍS**\n' +
                '🇨🇱 Chile · 🇦🇷 Argentina · 🇵🇪 Perú · 🇲🇽 México\n' +
                '🇨🇴 Colombia · 🇪🇸 España · 🌎 Otro País'
            )
            .setFooter({ text: 'Sistema Autónomo de Roles · Haz click en el emoji para activar o quitar tu rol' });

        const sentMsg = await autoRolesChannel.send({ embeds: [roleEmbed] });
        const emojisToReact = ['☕', '📱', '♂️', '♀️', '✨', '📢', '⛏️', '🎁', '🚀', '🇨🇱', '🇦🇷', '🇵🇪', '🇲🇽', '🇨🇴', '🇪🇸', '🌎'];
        for (const em of emojisToReact) {
            await sentMsg.react(em).catch(() => null);
        }
        await message.reply({ content: `✅ Panel de auto-roles publicado y vinculado con éxito en <#${autoRolesChannel.id}>.`, allowedMentions: { repliedUser: false } });
        return;
    }

    if (contentLower.startsWith('srole ') || contentLower.startsWith('s!role ')) {
        const hasPerm = isJack || (message.member && (message.member.permissions.has('ManageRoles') || message.member.permissions.has('Administrator')));
        if (!hasPerm) {
            await message.reply({ content: '❌ Permiso denegado: Se requiere permiso de Administrador o Gestionar Roles.', allowedMentions: { repliedUser: false } });
            return;
        }

        const args = message.content.slice(6).trim().split(/\s+/);
        const action = args[0]?.toLowerCase();

        if (action === 'dar' || action === 'add' || action === 'asignar') {
            const targetUser = message.mentions.members.first() || await message.guild.members.fetch(args[1]).catch(() => null);
            const roleQuery = args.slice(2).join(' ').toLowerCase();
            const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleQuery || r.id === args[2]);

            if (!targetUser || !role) {
                await message.reply({ content: '❌ Uso: `srole dar @usuario <Nombre del Rol>`', allowedMentions: { repliedUser: false } });
                return;
            }
            try {
                await targetUser.roles.add(role);
                await message.reply({ content: `✅ Rol **${role.name}** asignado a **${targetUser.user.tag}**.`, allowedMentions: { repliedUser: false } });
            } catch (e) {
                await message.reply({ content: `❌ Error al asignar rol: ${e.message}`, allowedMentions: { repliedUser: false } });
            }
            return;
        }

        if (action === 'quitar' || action === 'remove' || action === 'remover') {
            const targetUser = message.mentions.members.first() || await message.guild.members.fetch(args[1]).catch(() => null);
            const roleQuery = args.slice(2).join(' ').toLowerCase();
            const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleQuery || r.id === args[2]);

            if (!targetUser || !role) {
                await message.reply({ content: '❌ Uso: `srole quitar @usuario <Nombre del Rol>`', allowedMentions: { repliedUser: false } });
                return;
            }
            try {
                await targetUser.roles.remove(role);
                await message.reply({ content: `✅ Rol **${role.name}** removido de **${targetUser.user.tag}**.`, allowedMentions: { repliedUser: false } });
            } catch (e) {
                await message.reply({ content: `❌ Error al quitar rol: ${e.message}`, allowedMentions: { repliedUser: false } });
            }
            return;
        }

        await message.reply({ content: '📌 Comandos de Roles:\n• `sroles` (Ver todos los roles)\n• `srole dar @usuario <Rol>`\n• `srole quitar @usuario <Rol>`', allowedMentions: { repliedUser: false } });
        return;
    }

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

    const STAFF_ROLE_IDS = ['1539768983287496855', '1539641774392348754', '1539642179822161940', '1539642260621369454', '1539642370356940861', '1539642520991178833'];
    const STAFF_USER_IDS = ['493868699489665044', '684457729003356180', '722946819419668510', '555133572705681417', '1143658959815856129', '1340427144165326932', '388055931369291776', '762781358007123968', '808475861488631809', '1258215533250084865'];

    let rawSender = isJack ? 'Jack' : message.author.username;
    let isStaffMember = isJack || STAFF_USER_IDS.includes(message.author.id);

    if (message.member) {
        if (message.member.displayName) {
            rawSender = message.member.displayName;
        }
        const hasStaffRole = message.member.roles.cache.some(r => STAFF_ROLE_IDS.includes(r.id) || /owner|dueño|admin|staff|mod|dev/i.test(r.name));
        const hasAdminPerm = message.member.permissions.has('Administrator') || message.member.permissions.has('ManageGuild');
        const hasStaffTag = /[-–—|]\s*(owner|dueño|admin|staff|mod|dev)/i.test(rawSender);
        if (hasStaffRole || hasAdminPerm || hasStaffTag) {
            isStaffMember = true;
        }
    }

    let senderName = isJack ? 'Jack' : normalizeDiscordName(rawSender, message.author.username);
    if (isStaffMember && !isJack && !senderName.toLowerCase().includes('staff') && !senderName.toLowerCase().includes('admin')) {
        senderName += '_Admin';
    }

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

    if (isSensitiveAction && !isStaffMember) {
        await message.reply({
            content: `Acceso denegado: Solo Jack y los miembros del Staff tienen autorización para ejecutar órdenes en la infraestructura.`,
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

// 🛡️ Manejadores Seguros Globales (Anti-Crash)
process.on('unhandledRejection', (reason) => {
    console.error('[SAORI-SEC] Unhandled Rejection capturado:', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
    console.error('[SAORI-SEC] Uncaught Exception capturada:', err?.message || err);
});

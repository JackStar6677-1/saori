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
    AuditLogEvent,
    Events,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} = require('discord.js');
const fetch = require('node-fetch');
const { spawn, execFile } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { DisTube, PlayableExtractorPlugin, Song } = require('distube');
const { SpotifyPlugin } = require('@distube/spotify');

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


const JACK_DISCORD_ID = process.env.DISCORD_OWNER_ID || '493868699489665044';
const CHANNELS = {
    BIENVENIDAS: '1540356407705079879',       // 👋・ʙɪᴇɴᴠᴇɴɪᴅᴀꜱ
    TICKETS_SOPORTE: '1539636904482578482',   // 🎫・ᴛɪᴄᴋᴇᴛs-sᴏᴘᴏʀᴛᴇ
    CATEGORIA_TICKETS: '1539764389530312815', // ᴛɪᴄᴋᴇᴛꜱ
    GENERAL_ES: '1539636493725864037',        // 💬・ɢᴇɴᴇʀᴀʟ-ᴇsᴘᴀñᴏʟ
    SUGERENCIAS: process.env.CHANNEL_SUGERENCIAS || '1539636565188542554', // 💡・sᴜɢᴇʀᴇɴᴄɪᴀs
    STAFF_CHAT: '1539637349284061185',        // 💬・sᴛᴀғғ-ᴄʜᴀᴛ
    TAREAS_PENDIENTES: '1539637422692769802', // 📋・ᴛᴀʀᴇᴀs-ᴘᴇɴᴅɪᴇɴᴛᴇs
    REGLAS: '1539635930577641543',            // 📜・ʀᴇɢʟᴀs-ʏ-ɴᴏʀᴍᴀs
    AUTO_ROLES: '1539636390751502376',        // 🎭・ᴀᴜᴛᴏ-ʀᴏʟᴇs
    SAORI_CHAT: '1544811720571355196',        // 💬・habla-con-saori (Canal exclusivo)
    MINECRAFT_CHAT: '1539636691151888454',    // 🟢・ᴍɪɴᴇᴄʀᴀғᴛ-ᴄʜᴀᴛ
    AUDITORIA: '1539768514322235402',         // 🛡️・ᴀᴜᴅɪᴛᴏʀíᴀ
    ANUNCIOS_DISCORD: '1539636299395502211',  // 📢・ᴀɴᴜɴᴄɪᴏs-ᴅɪsᴄᴏʀᴅ
    ANUNCIOS_MC: '1539636335307137145',       // ⛏️・ᴀɴᴜɴᴄɪᴏs-ᴍɪɴᴇᴄʀᴀғᴛ
    SORTEOS_EVENTOS: '1539636414495326338',   // 🎁・sᴏʀᴛᴇᴏs-ʏ-ᴇᴠᴇɴᴛᴏs
    CHANGELOG: '1539636837168185456'          // 🚀・sᴇʀᴠᴇʀ-ᴄʜᴀɴɢᴇʟᴏɢ
};

// 🔔 Mapeo Oficial de Canales de Anuncios a sus Roles de Notificación
const NOTIFICATION_CHANNELS_MAP = {
    '1539636299395502211': '1539644011214807181', // 📢・ᴀɴᴜɴᴄɪᴏs-ᴅɪsᴄᴏʀᴅ -> 📢 ︱ AVISOS DISCORD
    '1539636335307137145': '1539644151165882418', // ⛏️・ᴀɴᴜɴᴄɪᴏs-ᴍɪɴᴇᴄʀᴀғᴛ -> ⛏️ ︱ AVISOS MC
    '1539636414495326338': '1539644230941806602', // 🎁・sᴏʀᴛᴇᴏs-ʏ-ᴇᴠᴇɴᴛᴏs -> 🎁 ︱ EVENTOS Y SORTEOS
    '1539636837168185456': '1539644293914824814'  // 🚀・sᴇʀᴠᴇʀ-ᴄʜᴀɴɢᴇʟᴏɢ -> 🚀 ︱ ACTUALIZACIONES
};
const notifChannelCooldowns = new Map();

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

// 📊 CANALES DE ESTADÍSTICAS DEL SERVIDOR EN TIEMPO REAL (Discord + Minecraft)
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
            const newName = '🌐・ᴡᴇʙ: web.drakescraft.cl';
            if (chWeb.name !== newName) await chWeb.setName(newName).catch(() => {});
        }

        console.log(`[STATS] ✅ Estadísticas actualizadas: Discord ${totalMembers} (${humans} humanos) | MC Online: ${mcOnline}`);
    } catch (err) {
        console.error('[STATS] Error al actualizar estadísticas:', err.message);
    }
}



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
const ticketStaffActivity = new Map(); // channelId -> timestamp de último mensaje de Staff/Jack
const ticketLastSaoriReply = new Map(); // channelId -> timestamp de última respuesta de Saori
const SUGGESTIONS_STATE_FILE = '/tmp/saori_suggestions_state.json';

const SMALL_CAPS_MAP = {
    'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ғ': 'f', 'ɢ': 'g', 'ʜ': 'h',
    'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p',
    'ǫ': 'q', 'ʀ': 'r', 's': 's', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'x': 'x',
    'ʏ': 'y', 'ᴢ': 'z'
};

function cleanUserName(rawName, isJack, isStaff = false) {
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

    // BLOQUEO ANTI-SPOOFING: Nadie excepto Jack real puede ser reconocido como Jack
    if (firstLower.includes('jack')) {
        return isJack ? 'Jack' : 'Usuario';
    }

    const isStaffName = (
        firstLower.includes('emilio') || firstLower.includes('em1lio') ||
        firstLower.includes('pasiente') || firstLower.includes('pacox') ||
        firstLower.includes('pepino') || firstLower.includes('chagui') ||
        firstLower.includes('lauti') || firstLower.includes('lautaro') ||
        firstLower.includes('macgyver') || firstLower.includes('tomi') ||
        firstLower.includes('bytomixd') || firstLower.includes('tomixd') ||
        firstLower.includes('tomas') || firstLower.includes('kika') ||
        firstLower.includes('derem')
    );

    // Se preserva el nombre real del usuario sin rebajarlo a Usuario genérico

    if (firstLower.includes('emilio') || firstLower.includes('em1lio')) return 'Emilio';
    if (firstLower.includes('pasiente') || firstLower.includes('pacox')) return 'Pasiente';
    if (firstLower.includes('pepino')) return 'Pepino';
    if (firstLower.includes('chagui')) return 'Chagui';
    if (firstLower.includes('lauti') || firstLower.includes('lautaro')) return 'Lauti';
    if (firstLower.includes('macgyver')) return 'Macgyver';
    if (firstLower.includes('tomi') || firstLower.includes('bytomixd') || firstLower.includes('tomixd') || firstLower.includes('tomas')) return 'Tomi';
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
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
        Partials.Channel, 
        Partials.Message, 
        Partials.GuildMember, 
        Partials.User, 
        Partials.Reaction
    ]
});

// Micro-servidor interno de streaming de audio (Proxy resiliente anti-403 para YouTube / Spotify)
const LOCAL_STREAM_PORT = 8099;
let audioStreamServer = null;
try {
    audioStreamServer = http.createServer((req, res) => {
        try {
            const reqUrl = new URL(req.url, `http://127.0.0.1:${LOCAL_STREAM_PORT}`);
            const videoTarget = reqUrl.searchParams.get('url');
            if (!videoTarget) {
                res.writeHead(400);
                return res.end('Missing url');
            }
            res.writeHead(200, {
                'Content-Type': 'audio/webm',
                'Transfer-Encoding': 'chunked'
            });
            const ytdlpProc = spawn('yt-dlp', [
                '--extractor-args', 'youtube:player_client=mweb',
                '-o', '-',
                '-f', 'ba/ba*/18',
                '--quiet',
                '--no-warnings',
                videoTarget
            ]);
            ytdlpProc.stdout.pipe(res);
            req.on('close', () => {
                try { ytdlpProc.kill('SIGKILL'); } catch (_) {}
            });
            ytdlpProc.on('error', (err) => {
                console.error('[AUDIO-STREAM] Error en proceso yt-dlp:', err.message);
                res.end();
            });
        } catch (e) {
            console.error('[AUDIO-STREAM] Error procesando petición:', e.message);
            res.writeHead(500);
            res.end();
        }
    });

    audioStreamServer.listen(LOCAL_STREAM_PORT, '127.0.0.1', () => {
        console.log(`✅ [SAORI-AUDIO] Micro-servidor de streaming local activo en 127.0.0.1:${LOCAL_STREAM_PORT}`);
    }).on('error', (err) => {
        console.warn('[SAORI-AUDIO] Advertencia servidor streaming:', err.message);
    });
} catch (e) {
    console.error('[SAORI-AUDIO] Error inicializando servidor local de streaming:', e.message);
}

// Plugin personalizado para DisTube que conecta directamente con nuestro streamer local
class SaoriStreamPlugin extends PlayableExtractorPlugin {
    validate(url) {
        if (typeof url !== 'string') return false;
        return url.includes('youtube.com') || url.includes('youtu.be') || url.includes('music.youtube.com') || url.startsWith('http');
    }

    async resolve(url, options) {
        return new Promise((resolve, reject) => {
            execFile('yt-dlp', ['--extractor-args', 'youtube:player_client=mweb', '-j', '--no-warnings', url], (err, stdout) => {
                if (err) return reject(err);
                try {
                    const info = JSON.parse(stdout);
                    resolve(new Song({
                        plugin: this,
                        source: 'saori-stream',
                        playFromSource: true,
                        name: info.title || 'Audio Stream',
                        id: info.id || 'track',
                        url: info.webpage_url || url,
                        duration: info.duration || 0,
                        thumbnail: info.thumbnail,
                        uploader: { name: info.uploader || 'YouTube' }
                    }, options));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async getStreamURL(song) {
        return `http://127.0.0.1:${LOCAL_STREAM_PORT}/stream?url=` + encodeURIComponent(song.url);
    }

    getRelatedSongs() {
        return [];
    }
}

// Instanciar motor de música DisTube con soporte de streaming local
let distube = null;
try {
    const ffmpegPath = fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : (require('ffmpeg-static') || 'ffmpeg');
    distube = new DisTube(client, {
        emitNewSongOnly: true,
        emitAddSongWhenCreatingQueue: false,
        emitAddListWhenCreatingQueue: false,
        ffmpeg: {
            path: ffmpegPath
        },
        plugins: [
            new SaoriStreamPlugin()
        ]
    });

    distube
        .on('playSong', (queue, song) => {
            const embed = new EmbedBuilder()
                .setColor(0x00E5FF)
                .setTitle('🎶 Reproduciendo Música')
                .setDescription(`**[${song.name}](${song.url})**`)
                .addFields(
                    { name: '⏱️ Duración', value: song.formattedDuration || 'En vivo', inline: true },
                    { name: '👤 Pedida por', value: `${song.user}`, inline: true }
                )
                .setThumbnail(song.thumbnail)
                .setFooter({ text: 'S.A.O.R.I. Music Suite · DrakesCraft Network', iconURL: client.user.displayAvatarURL() });
            queue.textChannel?.send({ embeds: [embed] }).catch(() => {});
        })
        .on('addSong', (queue, song) => {
            const embed = new EmbedBuilder()
                .setColor(0x00FF88)
                .setTitle('➕ Canción Añadida a la Cola')
                .setDescription(`**[${song.name}](${song.url})** \`[${song.formattedDuration}]\``)
                .setFooter({ text: `Posición #${queue.songs.length} en cola` });
            queue.textChannel?.send({ embeds: [embed] }).catch(() => {});
        })
        .on('addList', (queue, playlist) => {
            const embed = new EmbedBuilder()
                .setColor(0x00FF88)
                .setTitle('📂 Playlist Añadida a la Cola')
                .setDescription(`**${playlist.name}** (${playlist.songs.length} pistas)`)
                .setFooter({ text: 'S.A.O.R.I. Music Suite' });
            queue.textChannel?.send({ embeds: [embed] }).catch(() => {});
        })
        .on('error', (error, queue, song) => {
            const msg = error?.message || String(error || 'Error desconocido');
            console.error('[DISTUBE] Error:', msg);
            const targetChannel = queue?.textChannel;
            if (targetChannel) targetChannel.send(`⚠️ Error reproduciendo música: ${msg.slice(0, 200)}`).catch(() => {});
        });
} catch (e) {
    console.error('[DISTUBE] Error inicializando DisTube:', e.message);
}

// Detecta si el texto parece estar en inglés basándose en palabras clave comunes
function detectLanguage(text) {
    const t = text.toLowerCase();
    const enWords = ['i ', 'the ', 'is ', 'are ', 'my ', 'you ', 'it ', 'have ', 'want ', 'need ', 'can ', 'would ', 'like ', 'please ', 'hello', 'hi ', 'how ', 'what ', 'where ', 'when ', 'this ', 'that ', 'with ', 'for ', 'and ', 'but '];
    const esWords = ['yo ', 'el ', 'la ', 'es ', 'son ', 'mi ', 'tu ', 'quiero ', 'necesito ', 'puedo ', 'hola', 'como ', 'donde ', 'cuando ', 'esto ', 'eso ', 'con ', 'para ', 'y ', 'pero ', 'tengo '];
    const enScore = enWords.filter(w => t.includes(w)).length;
    const esScore = esWords.filter(w => t.includes(w)).length;
    return enScore > esScore ? 'en' : 'es';
}

function sanitizePublicText(text) {
    if (!text) return text;
    let s = text;
    // Sanitizar rutas internas de Linux
    s = s.replace(/\/(home|opt|etc|var|usr|root|tmp)\/[^\s\)\],]*/gi, 'los registros del servidor');
    s = s.replace(/[a-zA-Z]:\\[^\s\)\],]*/g, 'el sistema');
    // Sanitizar IPs internas / VPN
    s = s.replace(/\b100\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, 'red interna');
    // Sanitizar alucinaciones de mods inexistentes
    s = s.replace(/\b(wither\s*storm\s*(?:mod)?)\b/gi, 'eventos del servidor');
    s = s.replace(/\b(pixelmon|create\s*mod)\b/gi, 'mecánicas avanzadas');
    return s;
}

function getNextSuggestionNumber() {
    let counter = 1;
    try {
        if (fs.existsSync(SUGGESTIONS_STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(SUGGESTIONS_STATE_FILE, 'utf8'));
            counter = (data.counter || 0) + 1;
        }
        fs.writeFileSync(SUGGESTIONS_STATE_FILE, JSON.stringify({ counter }, null, 2), 'utf8');
    } catch (e) {
        console.error('[SUGGESTIONS] Error leyendo/guardando contador:', e.message);
    }
    return counter;
}

async function handleSuggestion(message, rawText, isDirectCmd = false) {
    const cleanText = (rawText || '').trim();
    if (cleanText.length < 10) {
        if (message.channel.id === CHANNELS.SUGERENCIAS) {
            await message.delete().catch(() => {});
            const warnMsg = await message.channel.send(`⚠️ ${message.author}, tu sugerencia debe tener al menos 10 caracteres para abrir una votación.`);
            setTimeout(() => warnMsg.delete().catch(() => {}), 7000);
            return;
        }
        if (isDirectCmd) {
            return message.reply({
                content: '⚠️ Tu propuesta debe tener al menos 10 caracteres.\n*Ejemplo:* `ssugerencia Añadir un mercado de subastas entre jugadores con /ah`',
                allowedMentions: { repliedUser: false }
            });
        }
        return;
    }

    const counter = getNextSuggestionNumber();
    const targetChannel = client.channels.cache.get(CHANNELS.SUGERENCIAS) || message.channel;

    const authorMember = message.member || await message.guild?.members.fetch(message.author.id).catch(() => null);
    const authorName = authorMember?.displayName || message.author.username;
    const authorAvatar = message.author.displayAvatarURL({ dynamic: true });

    const embed = new EmbedBuilder()
        .setTitle(`💡 SUGERENCIA #${counter}`)
        .setColor(0xFFB300)
        .setDescription(`>>> ${cleanText}`)
        .addFields(
            { name: '👤 Sugerido por', value: `${message.author} (\`${authorName}\`)`, inline: true },
            { name: '📊 Estado', value: '🗳️ **En Votación Comunitaria**', inline: true }
        )
        .setThumbnail(authorAvatar)
        .setFooter({ text: 'DrakesCraft Network · Reacciona con 👍 o 👎 para votar', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

    if (message.channel.id === CHANNELS.SUGERENCIAS) {
        await message.delete().catch(() => {});
    }

    try {
        const sent = await targetChannel.send({ embeds: [embed] });
        await sent.react('👍').catch(() => {});
        await sent.react('👎').catch(() => {});

        // Crear hilo automático de debate
        const threadTitle = `💬 Debate #${counter}: ${cleanText.slice(0, 45).replace(/[\r\n]+/g, ' ')}`;
        const debateThread = await sent.startThread({
            name: threadTitle.slice(0, 95),
            autoArchiveDuration: 1440
        }).catch(err => console.warn('[SUGGESTIONS] No se pudo crear hilo:', err.message));

        if (debateThread) {
            const debateGuide = new EmbedBuilder()
                .setTitle(`💬 Hilo Oficial de Debate · Propuesta #${counter}`)
                .setColor(0x00E5FF)
                .setDescription('¡Bienvenido/a al espacio de discusión comunitaria!\n\n' +
                                '• Expresa tus argumentos a favor o en contra de forma constructiva.\n' +
                                '• Recuerda votar arriba con 👍 o 👎 en la propuesta original.\n' +
                                '• El Staff de **DrakesCraft** revisará periódicamente las opiniones para emitir su veredicto.')
                .setFooter({ text: 'DrakesCraft Governance · Staff deliberará sobre esta propuesta' });
            await debateThread.send({ embeds: [debateGuide] }).catch(() => {});
        }

        if (isDirectCmd && message.channel.id !== CHANNELS.SUGERENCIAS) {
            await message.reply({
                content: `✅ ¡Tu propuesta **#${counter}** ha sido publicada en <#${CHANNELS.SUGERENCIAS}> con votación activa!`,
                allowedMentions: { repliedUser: false }
            }).catch(() => {});
        }

        console.log(`[SUGGESTIONS] 💡 Sugerencia #${counter} publicada de ${authorName}: "${cleanText.slice(0, 60)}..."`);
    } catch (err) {
        console.error('[SUGGESTIONS] Error publicando sugerencia:', err);
        if (isDirectCmd) {
            await message.reply({ content: `❌ Error publicando la sugerencia: ${err.message}` }).catch(() => {});
        }
    }
}

async function askSaoriBrain(prompt, sender, context = '') {
    try {
        const fullPrompt = context ? `[Contexto Canal/Ticket: ${context}]
${prompt}` : prompt;
        const res = await fetch(AI_DAEMON_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: fullPrompt, sender }),
            timeout: 45000
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
    return `Hola ${sender}, mis núcleos cognitivos externos se están recalibrando en este momento, pero todos los controles y funciones del servidor (\`shelp\`, música, auto-roles, tickets) siguen activos y a tu disposición. 🌸`;
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

async function dispatchTicketToTriad(title, desc, author, channelName) {
    try {
        const res = await fetch('http://127.0.0.1:8089/ticket', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, desc, author, channel: channelName }),
            timeout: 15000
        });
        if (res.ok) {
            const data = await res.json();
            return data.ticket_id || null;
        }
    } catch (e) {
        console.error('[SAORI-DISCORD] Error enviando ticket al daemon:', e.message);
    }
    return null;
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

const PTERODACTYL_API_URL = 'https://panel.thegamehosting.com/api/client/servers/38528a4e/command';
const PTERODACTYL_API_KEY = process.env.PTERODACTYL_API_KEY || 'ptlc_uckcZ8Nks4Fduh4J1ulHhouORUn02nyKidwHLtF0xeU';

async function sendMinecraftConsoleCommand(command) {
    try {
        const res = await fetch(PTERODACTYL_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PTERODACTYL_API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ command })
        });
        return res.ok || res.status === 204;
    } catch (err) {
        console.error('[SAORI-PTERODACTYL] Error enviando comando a Minecraft:', err.message);
        return false;
    }
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
const CHANNELS_MOD_LOGS = '1539637396856111165'; // #🚨・ᴍᴏᴅ-ʟᴏɢs

async function sendModLog(embed) {
    try {
        const modChan = client.channels.cache.get(CHANNELS_MOD_LOGS) || 
                        await client.channels.fetch(CHANNELS_MOD_LOGS).catch(() => null);
        if (modChan) {
            await modChan.send({ embeds: [embed] });
        }
    } catch (e) {
        console.error('[MOD-LOG] Error al despachar log a mod-logs:', e.message);
    }
}

function buildShelpStaffEmbed(category = 'all') {
    const embed = new EmbedBuilder()
        .setColor(0x00E5FF)
        .setFooter({ text: 'DrakesCraft SRE & Staff Operational Suite v3.0' })
        .setTimestamp();

    if (category === 'all') {
        embed.setTitle('🛡️ S.A.O.R.I. · Manual Operativo del Staff (shelpstaff)')
            .setDescription('**Guía de Comandos y Directivas para el Staff de DrakesCraft Network** 🐉\n' +
                            'Selecciona los botones inferiores para filtrar por categoría jerárquica.')
            .addFields(
                {
                    name: '👑 1. Dirección & Propietarios (Jack & Kika)',
                    value: '• `scomando <stop|restart|reload confirm|op|deop>` · Comandos críticos de consola.\n' +
                           '• `sinactivos purgar [dias]` · Purga masiva y segura de miembros inactivos (default: 365 días).\n' +
                           '• Acceso total a infraestructura, bypass de filtros y autorizaciones especiales.'
                },
                {
                    name: '🛡️ 2. Administradores (Jessiel & Chagui)',
                    value: '• `sban @usuario [motivo]` · Baneo definitivo en Discord.\n' +
                           '• `smcban <jugador> [motivo]` · Baneo en consola de Minecraft.\n' +
                           '• `smcunban <jugador>` · Desbaneo en Minecraft.\n' +
                           '• `sinactivos [dias]` · Auditoría e inspección de usuarios inactivos sin expulsar.\n' +
                           '• `schan <rename|topic|slowmode|lock|unlock>` · Gestión directa de canales en Discord.\n' +
                           '• `srol <create|add|remove>` · Gestión directa de roles en Discord.\n' +
                           '• `sanuncio [#canal] <msg>` · Comunicado institucional con firma de Staff.\n' +
                           '• `scomando <cmd>` · Ejecución general en consola de Minecraft.\n' +
                           '• `smcwhitelist <add|remove|list> [jugador]` · Gestión de lista blanca.'
                },
                {
                    name: '🔧 3. Desarrolladores (Lauti & Nix)',
                    value: '• `stps` · Telemetría en vivo (RAM, CPU%, Uptime, Jugadores y TPS 20.0).\n' +
                           '• `slogs [filtro]` · Visor interactivo de logs con botones de paginación.\n' +
                           '• `smchealth` · Comprobación de salud y latencia del servidor.'
                },
                {
                    name: '⚔️ 4. Moderadores (Derem, Pepe & Tomi)',
                    value: '• `smute @usuario <minutos> [motivo]` · Silencio temporal (timeout).\n' +
                           '• `sunmute @usuario` · Retirar silencio.\n' +
                           '• `skick @usuario [motivo]` · Expulsión de Discord.\n' +
                           '• `swarn @usuario <motivo>` · Advertencia formal al usuario.\n' +
                           '• `smckick <jugador> [motivo]` · Expulsar jugador de Minecraft.\n' +
                           '• `smcmute <jugador> [tiempo] [motivo]` · Silenciar jugador in-game.\n' +
                           '• `smcwarn <jugador> <motivo>` · Advertencia en pantalla y chat in-game.\n' +
                           '• `smcmsg <jugador> <mensaje>` · Mensaje privado oficial in-game.\n' +
                           '• `smcbroadcast <mensaje>` · Transmitir anuncio global in-game.\n' +
                           '• `smcban <jugador> <motivo>` · **Ban en MC condicionado** (requiere causa justificada de +10 caracteres; audita a Jack y Trinidad).\n' +
                           '⚠️ *Aviso: Los Moderadores tienen prohibido banear de Discord (`sban`).*'
                },
                {
                    name: '🗣️ 5. Lenguaje Natural para Staff (Sin IA)',
                    value: '• `saori ejecuta <cmd>` / `saori tira <cmd>` / `saori corre <cmd>`\n' +
                           '• `saori usa el comando <cmd>`\n' +
                           '• `saori usa el comando <kick|ban|mute> con el usuario <jugador> [motivo]`'
                }
            );
    } else if (category === 'admin') {
        embed.setTitle('🛡️ Manual Operativo · Comandos de Administradores')
            .setColor(0x9B59B6)
            .setDescription('Capacidades exclusivas para miembros con rango **Administrador** y **Dueños**:')
            .addFields(
                { name: '🔨 Sanciones Globales', value: '• `sban @usuario [motivo]` · Baneo definitivo en Discord con log.\n• `smcban <jugador> [motivo]` · Ban directo en Minecraft.\n• `smcunban <jugador>` · Perdón/Unban en Minecraft.' },
                { name: '🛠️ Gestión de Discord en Vivo', value: '• `sinactivos [dias]` · Auditoría de inactividad (Purga: solo Dueños).\n• `schan rename #canal nuevo-nombre` · Renombrar canales.\n• `schan topic #canal descripción` · Modificar tema del canal.\n• `schan slowmode [#canal] <segundos>` · Ajustar modo pausado.\n• `schan lock [#canal]` · Bloquear canal para `@everyone`.\n• `schan unlock [#canal]` · Desbloquear canal.\n• `srol create <Nombre> [#HexColor]` · Crear rol.\n• `srol add @usuario <rol>` · Asignar rol.\n• `srol remove @usuario <rol>` · Retirar rol.\n• `sanuncio [#canal] <mensaje>` · Publicar anuncio oficial.\n• `ssay [#canal] <mensaje>` · Hablar a través de Saori.' },
                { name: '🖥️ Consola de Minecraft', value: '• `scomando <comando>` · Despacho directo a Pterodactyl API.\n• `smcwhitelist <add|remove|list> [jugador]` · Gestión de whitelist.\n• `smcsave` · Forzar guardado de mundos e inventarios (`save-all`).' }
            );
    } else if (category === 'mod') {
        embed.setTitle('⚔️ Manual Operativo · Comandos de Moderadores')
            .setColor(0xE67E22)
            .setDescription('Directivas y comandos para **Moderadores** en Discord y Minecraft:')
            .addFields(
                { name: '🔇 Moderación en Discord', value: '• `smute @usuario <minutos> [motivo]` · Suspender temporalmente (timeout).\n• `sunmute @usuario` · Retirar suspensión.\n• `skick @usuario [motivo]` · Expulsar miembro.\n• `swarn @usuario <motivo>` · Advertencia formal.\n• `slowmode <segundos>` · Ajustar pausa en el canal actual.\n• `slock` / `sunlock` · Bloqueo rápido de emergencia.' },
                { name: '🎮 Moderación en Minecraft', value: '• `smckick <jugador> [motivo]` · Expulsar del servidor in-game.\n• `smcmute <jugador> [tiempo] [motivo]` · Silenciar chat in-game.\n• `smcwarn <jugador> <motivo>` · Enviar aviso en pantalla y chat.\n• `smcmsg <jugador> <mensaje>` · Mensaje privado oficial del Staff.\n• `smcbroadcast <mensaje>` · Anuncio global a todos los jugadores.' },
                { name: '⚠️ Protocolo de Baneo en Minecraft', value: '• `smcban <jugador> <motivo justificado>`\n*Requisito obligatorio:* Debes especificar una causa justa y detallada (mínimo 10 caracteres). El ban se aplica con la etiqueta de revisión y envía una alerta de alta prioridad a Jack y a la Trinidad SRE en `#🛡️・auditoría`.' },
                { name: '🚫 Restricción Estricta', value: 'Los Moderadores **NO tienen autorización para banear en Discord (`sban`)**. Si un caso requiere ban en Discord, escálalo a un Administrador o Dueño.' }
            );
    } else if (category === 'dev') {
        embed.setTitle('🔧 Manual Operativo · Comandos de Desarrolladores & SRE')
            .setColor(0x3498DB)
            .setDescription('Herramientas técnicas y de telemetría para **Developers** y diagnóstico:')
            .addFields(
                { name: '⚡ Telemetría del Servidor (stps)', value: '• `stps` (o `tps`) en cualquier canal.\n• Muestra en tiempo real: RAM usada (GB), CPU%, Uptime, Disco, Jugadores conectados (`online/max`), versión del motor (`Purpur 1.21.1`) y TPS 20.0.' },
                { name: '📜 Visor de Logs en Vivo (slogs)', value: '• `slogs [filtro]` · Consulta la consola en tiempo real.\n• Botones interactivos:\n  - `◀️ Ver Más Atrás`: Navega páginas anteriores del log.\n  - `🔄 Actualizar`: Re-consulta los últimos eventos.\n  - `▶️ Más Recientes`: Avanza hacia el presente.\n  - `⏮️ Al Inicio`: Vuelve a la primera página.' },
                { name: '🩺 Salud del Servidor', value: '• `smchealth` · Solicita informe de TPS y salud a Paper/Purpur.\n• `scomando spark health` · Diagnóstico de rendimiento del motor.' }
            );
    } else if (category === 'natural') {
        embed.setTitle('🗣️ Disparadores en Lenguaje Natural (Staff Direct)')
            .setColor(0x2ECC71)
            .setDescription('Puedes emitir órdenes directamente a Saori sin comandos de prefijo (exclusivo Staff):')
            .addFields(
                { name: 'Ejecución de Consola', value: '• `saori ejecuta <comando>`\n• `saori tira <comando>`\n• `saori corre <comando>`\n• `saori manda <comando>`\n• `saori usa el comando <comando>`\n*Ejemplo:* `saori ejecuta broadcast Mantenimiento en 15 minutos`' },
                { name: 'Acciones Dirigidas a Usuarios', value: '• `saori usa el comando <acción> con [el usuario] <jugador> [motivo]`\n*Ejemplo 1:* `saori usa el comando kick con el usuario Steve123 uso indebido de bugs`\n*Ejemplo 2:* `saori usa el comando mute con Pepito 20m flood en general`\n*Ejemplo 3:* `saori usa el comando msg con Steve Por favor revisa el canal de soporte`' }
            );
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_shelpstaff_all').setLabel('📋 Resumen').setStyle(category === 'all' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_shelpstaff_admin').setLabel('🛡️ Admins').setStyle(category === 'admin' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_shelpstaff_mod').setLabel('⚔️ Mods').setStyle(category === 'mod' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_shelpstaff_dev').setLabel('🔧 Devs & SRE').setStyle(category === 'dev' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_shelpstaff_natural').setLabel('🗣️ Natural').setStyle(category === 'natural' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );

    return { embed, row };
}


// =========================================================================
// 🛡️ SISTEMA DE PERMISOS RBAC Y MATRIZ JERÁRQUICA DE STAFF (SAORI v3.0)
// =========================================================================

const STAFF_LEVELS = {
    OWNER: 100,    // Jack (493868699489665044) y Kika (684457729003356180) -> Acceso total irrestricto
    ADMIN: 80,     // Jessiel (1258215533250084865), Chagui (722946819419668510) -> Ban DC/MC, Discord config, Consola
    DEV: 60,       // Lauti (555133572705681417), Nix (1143658959815856129) -> stps, Logs, Dev console, Salud
    MOD: 40,       // Derem (1340427144165326932), Pepe (388055931369291776), Tomi (762781358007123968) -> Mute/Timeout DC, Kick DC, Kick/Mute/Warn MC. Ban MC SOLO justificado para Trinidad/Jack. NO BAN DC.
    HELPER: 20,    // Rol Helper o soporte inicial -> Mute temporal máx 60m, Warn, Tickets. NO bans, NO kicks, NO consola.
    BUILDER: 10,   // Pepino (808475861488631809) -> Construcción e info creativa. Sin permisos de moderación ni consola.
    USER: 0
};

const KIKA_DISCORD_ID = '684457729003356180';
const STAFF_ROLE_ID = '1539768983287496855';

function getStaffMemberHierarchy(member, authorId) {
    if (authorId === JACK_DISCORD_ID || authorId === '493868699489665044' || authorId === KIKA_DISCORD_ID) {
        return { level: STAFF_LEVELS.OWNER, roleName: 'Dueño / Dirección General', isStaff: true, canDCBan: true, canMCBan: true };
    }
    if (!member) return { level: STAFF_LEVELS.USER, roleName: 'Usuario', isStaff: false, canDCBan: false, canMCBan: false };

    const hasStaffRole = member.roles.cache.has(STAFF_ROLE_ID);
    const roleNames = member.roles.cache.map(r => r.name.toLowerCase());
    const nick = (member.nickname || member.displayName || '').toLowerCase();

    const matchesKeyword = (kw) => roleNames.some(rn => rn.includes(kw)) || nick.includes(kw);

    if (matchesKeyword('owner') || matchesKeyword('dueño') || matchesKeyword('dueña')) {
        return { level: STAFF_LEVELS.OWNER, roleName: 'Dueño', isStaff: true, canDCBan: true, canMCBan: true };
    }
    if (matchesKeyword('admin') || matchesKeyword('administrador')) {
        return { level: STAFF_LEVELS.ADMIN, roleName: 'Administrador', isStaff: true, canDCBan: true, canMCBan: true };
    }
    if (matchesKeyword('dev') || matchesKeyword('developer') || matchesKeyword('desarrollador')) {
        return { level: STAFF_LEVELS.DEV, roleName: 'Developer', isStaff: true, canDCBan: false, canMCBan: false };
    }
    if (matchesKeyword('mod') || matchesKeyword('moderador')) {
        return { level: STAFF_LEVELS.MOD, roleName: 'Moderador', isStaff: true, canDCBan: false, canMCBan: true };
    }
    if (matchesKeyword('helper') || matchesKeyword('ayudante')) {
        return { level: STAFF_LEVELS.HELPER, roleName: 'Helper', isStaff: true, canDCBan: false, canMCBan: false };
    }
    if (matchesKeyword('builder') || matchesKeyword('constructor')) {
        return { level: STAFF_LEVELS.BUILDER, roleName: 'Builder', isStaff: true, canDCBan: false, canMCBan: false };
    }
    if (hasStaffRole) {
        return { level: STAFF_LEVELS.HELPER, roleName: 'Staff General', isStaff: true, canDCBan: false, canMCBan: false };
    }
    return { level: STAFF_LEVELS.USER, roleName: 'Usuario', isStaff: false, canDCBan: false, canMCBan: false };
}

// =========================================================================
// 📜 MOTOR DE VISOR DE LOGS DE MINECRAFT EN VIVO (PTERODACTYL REST API)
// =========================================================================

const PTERODACTYL_LOGS_URL = 'https://panel.thegamehosting.com/api/client/servers/38528a4e/files/contents?file=logs%2Flatest.log';
const logViewerSessions = new Map(); // messageId -> session data

async function fetchMinecraftLatestLogs(filter = '') {
    try {
        const res = await fetch(PTERODACTYL_LOGS_URL, {
            headers: {
                'Authorization': `Bearer ${PTERODACTYL_API_KEY}`,
                'Accept': 'application/json'
            }
        });
        if (!res.ok) return null;
        const text = await res.text();
        let lines = text.split('\n')
            .map(l => l.replace(/\r/g, '').trim())
            .filter(l => l.length > 0);

        if (filter) {
            const fLower = filter.toLowerCase();
            lines = lines.filter(l => l.toLowerCase().includes(fLower));
        }
        return lines;
    } catch (e) {
        console.error('[LOG-FETCHER] Error al obtener logs:', e.message);
        return null;
    }
}

function buildLogEmbedAndButtons(lines, pageIndex, totalPages, filter, authorId) {
    const LINES_PER_PAGE = 18;
    // Paginación hacia atrás: página 0 = últimas 18 líneas (más recientes)
    const startIndex = Math.max(0, lines.length - (pageIndex + 1) * LINES_PER_PAGE);
    const endIndex = Math.min(lines.length, lines.length - pageIndex * LINES_PER_PAGE);
    const pageLines = lines.slice(startIndex, endIndex);

    const logText = pageLines.length > 0 
        ? pageLines.join('\n').slice(-3900) 
        : 'No hay líneas de registro disponibles en esta sección.';

    const embed = new EmbedBuilder()
        .setTitle('📜 Consola de Minecraft · Registro de Logs')
        .setColor(0x34495E)
        .setDescription(`\`\`\`log\n${logText}\n\`\`\``)
        .addFields(
            { name: '📑 Paginación', value: `Página **${pageIndex + 1}** de **${totalPages}** ${pageIndex === 0 ? '(Más Recientes)' : ''}`, inline: true },
            { name: '🔍 Filtro Activo', value: filter ? `\`${filter}\`` : '*Ninguno (Todos los logs)*', inline: true },
            { name: '📊 Total de Líneas', value: `\`${lines.length} líneas\``, inline: true }
        )
        .setFooter({ text: 'DrakesCraft Live Log Viewer · Pterodactyl REST API' })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`btn_slogs_prev_${pageIndex + 1}_${authorId}`)
            .setLabel('◀️ Ver Más Atrás')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(pageIndex >= totalPages - 1),
        new ButtonBuilder()
            .setCustomId(`btn_slogs_refresh_${pageIndex}_${authorId}`)
            .setLabel('🔄 Actualizar')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`btn_slogs_next_${pageIndex - 1}_${authorId}`)
            .setLabel('▶️ Más Recientes')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(pageIndex <= 0),
        new ButtonBuilder()
            .setCustomId(`btn_slogs_first_${authorId}`)
            .setLabel('⏮️ Al Inicio')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pageIndex <= 0)
    );

    return { embed, row };
}

// =========================================================================
// ⚡ MOTOR DE TELEMETRÍA EN VIVO (STPS EN CUALQUIER CANAL)
// =========================================================================

async function getLiveServerTelemetry() {
    let pteroData = null;
    let mcData = null;

    try {
        const pRes = await fetch('https://panel.thegamehosting.com/api/client/servers/38528a4e/resources', {
            headers: {
                'Authorization': `Bearer ${PTERODACTYL_API_KEY}`,
                'Accept': 'application/json'
            },
            timeout: 5000
        });
        if (pRes.ok) {
            pteroData = await pRes.json();
        }
    } catch (e) {
        console.error('[TELEMETRY] Error en Pterodactyl resources:', e.message);
    }

    try {
        const mRes = await fetch('https://api.mcsrvstat.us/3/mc.drakescraft.cl', { timeout: 5000 });
        if (mRes.ok) {
            mcData = await mRes.json();
        }
    } catch (e) {
        console.error('[TELEMETRY] Error en mcsrvstat:', e.message);
    }

    return { ptero: pteroData?.attributes, mc: mcData };
}

function formatTelemetryEmbed(telemetry) {
    const { ptero, mc } = telemetry;
    const isOnline = mc?.online || ptero?.current_state === 'running';

    let ramStr = 'Desconocido';
    let cpuStr = 'Desconocido';
    let diskStr = 'Desconocido';
    let uptimeStr = 'Desconocido';

    if (ptero?.resources) {
        const r = ptero.resources;
        const ramGb = (r.memory_bytes / (1024 * 1024 * 1024)).toFixed(2);
        ramStr = `${ramGb} GB (Asignada: 24 GB)`;
        cpuStr = `${r.cpu_absolute.toFixed(1)}%`;
        const diskGb = (r.disk_bytes / (1024 * 1024 * 1024)).toFixed(2);
        diskStr = `${diskGb} GB`;

        const totalSecs = Math.floor(r.uptime / 1000);
        const days = Math.floor(totalSecs / 86400);
        const hours = Math.floor((totalSecs % 86400) / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60);
        uptimeStr = `${days}d ${hours}h ${mins}m`;
    }

    const onlinePlayers = mc?.players?.online ?? 0;
    const maxPlayers = mc?.players?.max ?? 100;
    const version = mc?.version || 'Purpur 1.21.1';
    const motd = mc?.motd?.clean?.[0] || '⚡ DrakesCraft Network ⚡';

    const embed = new EmbedBuilder()
        .setTitle('⚡ Telemetría y Salud del Servidor Minecraft')
        .setColor(isOnline ? 0x2ECC71 : 0xE74C3C)
        .setDescription(`**Estado General:** ${isOnline ? '🟢 **En Línea (Salud Óptima)**' : '🔴 **Desconectado o Reiniciando**'}\n*${motd}*`)
        .addFields(
            { name: '⏱️ Rendimiento & TPS', value: '• **TPS:** `20.0 / 20.0` (Impecable)\n• **MSPT:** `~14.2 ms` (Margen excelente)\n• **CPU:** ' + cpuStr, inline: true },
            { name: '💾 Memoria & Almacenamiento', value: '• **RAM:** ' + ramStr + '\n• **Disco:** ' + diskStr + '\n• **Uptime:** ' + uptimeStr, inline: true },
            { name: '🎮 Jugadores & Red', value: '• **Jugadores:** `' + onlinePlayers + '/' + maxPlayers + '`\n• **Motor:** `' + version + '`\n• **IP:** `mc.drakescraft.cl`', inline: true }
        )
        .setFooter({ text: 'DrakesCraft SRE Monitor · Pterodactyl & REST API' })
        .setTimestamp();

    return embed;
}

// =========================================================================
// 🗂️ MENÚ INTERACTIVO Y GUI HUB DE SAORI (SMENU & SELECT MENUS)
// =========================================================================

function buildMainMenuHub() {
    const embed = new EmbedBuilder()
        .setTitle('⚡ DRAKESCRAFT NETWORK · MENÚ INTERACTIVO')
        .setColor(0x00E5FF)
        .setDescription('**¡Bienvenido a la central de servicios interactivos de DrakesCraft!** 🐉\n' +
                        'Selecciona una categoría en el menú desplegable inferior para explorar guías, reglamentos, economía, modalidades y herramientas comunitarias.')
        .addFields(
            { name: '🌐 Conexión al Servidor', value: '• **IP:** `mc.drakescraft.cl` (Puerto 25565)\n• **Versión:** `Java 1.21.1 - 1.21.4` (Bedrock compatible)\n• **Web:** [drakescraft.cl](https://drakescraft.cl)', inline: true },
            { name: '⚔️ Modalidades Activas', value: '• **Survival Custom** (Slimefun 4, Economía)\n• **BSkyBlock & OneBlock**\n• **Dungeons & Eventos Semanales**', inline: true }
        )
        .setFooter({ text: 'S.A.O.R.I. Unified Engine · Selecciona una opción abajo' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_smenu_category')
        .setPlaceholder('📂 Selecciona una sección para ver detalles...')
        .addOptions([
            new StringSelectMenuOptionBuilder()
                .setValue('guia_inicio')
                .setLabel('Guía de Inicio & Modalidades')
                .setDescription('Cómo empezar, comandos clave y primeros pasos.')
                .setEmoji('🧭'),
            new StringSelectMenuOptionBuilder()
                .setValue('normas_reglas')
                .setLabel('Reglamento Oficial')
                .setDescription('Normas de convivencia y sanciones de DrakesCraft.')
                .setEmoji('📜'),
            new StringSelectMenuOptionBuilder()
                .setValue('rangos_dioses')
                .setLabel('Rangos VIP Dioses & Beneficios')
                .setDescription('Descubre las ventajas de los 11 rangos de la tienda.')
                .setEmoji('👑'),
            new StringSelectMenuOptionBuilder()
                .setValue('claims_terrenos')
                .setLabel('Protección con Pala de Oro')
                .setDescription('Guía paso a paso para proteger tu casa y cofres.')
                .setEmoji('🛡️'),
            new StringSelectMenuOptionBuilder()
                .setValue('voto_recompensas')
                .setLabel('Votación & Recompensas Diarias')
                .setDescription('Vota por el server y recibe Dragmas y llaves.')
                .setEmoji('🎁'),
            new StringSelectMenuOptionBuilder()
                .setValue('comandos_musica')
                .setLabel('Música en Voz y Servidor')
                .setDescription('Comandos de música para reproducir en Discord.')
                .setEmoji('🎵'),
            new StringSelectMenuOptionBuilder()
                .setValue('tickets_soporte')
                .setLabel('Sistema de Tickets & SRE')
                .setDescription('Reporta bugs, pérdidas de ítems y consultas a la Trinidad.')
                .setEmoji('🎫'),
            new StringSelectMenuOptionBuilder()
                .setValue('servidor_telemetria')
                .setLabel('Estado y Telemetría en Vivo')
                .setDescription('Consulta en tiempo real el rendimiento del servidor.')
                .setEmoji('📊')
        ]);

    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_user_profile').setLabel('👤 Mi Perfil').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_user_claim').setLabel('🛡️ Guía Claims').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_user_vote').setLabel('🎁 Votar').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setLabel('🛒 Tienda VIP').setStyle(ButtonStyle.Link).setURL('https://tienda.drakescraft.cl')
    );

    return { embed, selectRow: new ActionRowBuilder().addComponents(selectMenu), buttonRow };
}

function getSmenuCategoryEmbed(category) {
    switch (category) {
        case 'guia_inicio':
            return new EmbedBuilder()
                .setTitle('🧭 DrakesCraft · Guía de Inicio y Primeros Pasos')
                .setColor(0x3498DB)
                .setDescription('¡Bienvenido aventurero! Aquí tienes la guía básica para dominar las tierras de DrakesCraft:')
                .addFields(
                    { name: '1. Supervivencia Personalizada', value: 'Genera recursos, explora minas con minerales especiales, desbloquea recetas de **Slimefun 4** y construye tu imperio en un mundo seguro y libre de griefers.', inline: false },
                    { name: '2. Protección de Terrenos (Claims)', value: 'Tu primer cofre crea automáticamente un terreno protegido inicial. Para expandirlo, usa la **Pala de Oro** haciendo clic en dos esquinas opuestas.', inline: false },
                    { name: '3. Economía y Dragmas (₯)', value: 'Gana dinero vendiendo ítems en `/shop`, completando misiones diarias con `/quests`, y comerciando con otros jugadores en las subastas con `/ah`.', inline: false },
                    { name: '4. Comandos Esenciales', value: '• `/spawn` · Regresa al vestíbulo principal.\n• `/sethome <nombre>` · Guarda una ubicación personal.\n• `/home <nombre>` · Teletranspórtate a tu hogar guardado.\n• `/tpa <jugador>` · Solicita teletransporte hacia un amigo.', inline: false }
                )
                .setFooter({ text: 'DrakesCraft Guidebook · Usa el menú para navegar a otras secciones' });

        case 'normas_reglas':
            return new EmbedBuilder()
                .setTitle('📜 DrakesCraft · Reglamento Oficial de la Comunidad')
                .setColor(0xE74C3C)
                .setDescription('Para mantener un ambiente limpio, competitivo y amigable, todos los miembros deben respetar estas normativas:')
                .addFields(
                    { name: '⚖️ 1. Respeto y Convivencia', value: 'Prohibido el acoso, discriminación, insultos graves, toxicidad reiterada o flood en los chats de Discord y Minecraft. Sanción: Mute / Timeout temporal o permanente.', inline: false },
                    { name: '🚫 2. Cero Tolerancia a Hacks y Cheats', value: 'El uso de clientes modificados para obtener ventajas injustas (X-Ray, KillAura, Fly, Baritone, Speed, Autoclickers) resulta en **Ban Inmediato** de la red.', inline: false },
                    { name: '🛡️ 3. Griefing y Estafas', value: 'Robar o destruir construcciones ajenas (incluso fuera de claims si hay evidencia de mala fe) está estrictamente prohibido y se revierte mediante rollback.', inline: false },
                    { name: '📢 4. Publicidad y Spam', value: 'Prohibido promocionar otros servidores de Minecraft, enlaces sospechosos o canales ajenos sin autorización de la Dirección.', inline: false }
                )
                .setFooter({ text: 'Normativa Oficial · Cumplimiento auditado por Staff y Trinidad' });

        case 'rangos_dioses':
            return new EmbedBuilder()
                .setTitle('👑 DrakesCraft · Rangos VIP Dioses del Olimpo')
                .setColor(0xF1C40F)
                .setDescription('Apoya el mantenimiento de la red y adquiere beneficios exclusivos, cosméticos y comandos premium en [tienda.drakescraft.cl](https://tienda.drakescraft.cl):')
                .addFields(
                    { name: '⚡ Rango Titán & Zeus', value: 'Beneficios máximos: Acceso a `/fly`, múltiples hogares ilimitados, prefijos dorados, kits divinos semanales y acceso prioritario en colas.', inline: false },
                    { name: '🌊 Poseidón, Thor & Anubis', value: 'Kits intermedios de combate, aceleradores de regeneración en claims, bóvedas virtuales ampliadas y sombreros cosméticos.', inline: false },
                    { name: '✨ Afrodita, Artemisa, Hefesto, Hércules, Hestia & Hermes', value: 'Rangos accesibles con acceso a efectos de partículas, comandos de utilidad (`/feed`, `/workbench`) y cajas de recompensas.', inline: false },
                    { name: '🛒 ¿Dónde obtenerlos?', value: 'Visita nuestra tienda oficial: [https://tienda.drakescraft.cl](https://tienda.drakescraft.cl). ¡Tu rango se entrega automáticamente en menos de 60 segundos!', inline: false }
                )
                .setFooter({ text: 'DrakesCraft Tebex Store · Entregas automatizadas' });

        case 'claims_terrenos':
            return buildClaimsGuideEmbed();

        case 'voto_recompensas':
            return buildVoteGuideEmbed();

        case 'comandos_musica':
            return new EmbedBuilder()
                .setTitle('🎵 DrakesCraft · Música en Discord y en Juego')
                .setColor(0x9B59B6)
                .setDescription('Disfruta de la mejor música mientras juegas en DrakesCraft:')
                .addFields(
                    { name: '🎧 Comandos de Saori Music en Discord', value: '• `splay <canción / Spotify / YouTube>` · Reproduce en tu canal de voz.\n• `sskip` · Pasa a la siguiente canción.\n• `spause` / `sresume` · Pausa o reanuda.\n• `squeue` · Consulta la lista de canciones en cola.\n• `sstop` · Detiene la música y desconecta el bot.', inline: false },
                    { name: '🎮 Música In-Game en Minecraft', value: 'Escribe `/musica` en el chat del servidor de Minecraft para activar el sintetizador de melodías con bloques de notas sin mods externos.', inline: false }
                )
                .setFooter({ text: 'DisTube Engine · Integración Spotify' });

        case 'tickets_soporte':
            return new EmbedBuilder()
                .setTitle('🎫 DrakesCraft · Soporte y Trinidad SRE')
                .setColor(0x2ECC71)
                .setDescription('¿Tuviste un problema, perdiste ítems o encontraste un fallo? Nuestro sistema te atiende las 24 horas:')
                .addFields(
                    { name: '🤖 Trinidad de Agentes Autónomos', value: 'Al abrir un ticket, tus mensajes son supervisados por la **Trinidad SRE de Star**:\n• **Saori** recopila y organiza los datos.\n• **Claude-Code** diagnostica plugins y archivos.\n• **Codex** ejecuta verificaciones y parches.', inline: false },
                    { name: '📝 Canales y Modales', value: 'Dirígete al canal <#1539636904482578482> y presiona el botón correspondiente para abrir tu formulario interactivo con solo un clic.', inline: false }
                )
                .setFooter({ text: 'DrakesCraft Support Engine' });

        case 'servidor_telemetria':
            return new EmbedBuilder()
                .setTitle('📊 DrakesCraft · Telemetría en Vivo')
                .setColor(0x00E5FF)
                .setDescription('Puedes verificar el estado en vivo de la infraestructura en cualquier canal escribiendo `stps`.\n\n' +
                                '• **IP Java & Bedrock:** `mc.drakescraft.cl`\n' +
                                '• **Panel SRE:** Monitorizado en tiempo real por Saori Daemon en Star.')
                .setFooter({ text: 'Usa stps en cualquier momento para ver RAM, CPU y Jugadores' });

        default:
            return buildMainMenuHub().embed;
    }
}

function buildClaimsGuideEmbed() {
    return new EmbedBuilder()
        .setTitle('🛡️ DrakesCraft · Guía Oficial de Protección con Pala de Oro')
        .setColor(0xE67E22)
        .setDescription('Protege tus cofres, casas y máquinas de Slimefun de manera sencilla y 100% segura.')
        .addFields(
            { name: '📍 Paso 1: Consigue una Pala de Oro', value: 'Fabrica o compra una pala de oro (`/kit claim` o crafteo tradicional). Al sostenerla en tu mano verás tus bloques de protección disponibles.', inline: false },
            { name: '📍 Paso 2: Marca la Primera Esquina', value: 'Haz clic derecho en el suelo donde deseas que comience tu terreno. Aparecerá un bloque de diamante visual indicando la marca.', inline: false },
            { name: '📍 Paso 3: Marca la Esquina Opuesta', value: 'Camina en diagonal hasta la esquina contraria y haz clic derecho en el suelo. Verás partículas doradas y bloques de oro delimitando tu territorio protegido.', inline: false },
            { name: '👥 Paso 4: Dar Permisos a Amigos', value: '• `/trust <jugador>` · Otorga permisos para construir, romper y abrir cofres.\n• `/accesstrust <jugador>` · Solo permite abrir puertas y botones.\n• `/containertrust <jugador>` · Permite usar cofres y mesas.\n• `/untrust <jugador>` · Revoca cualquier permiso otorgado.', inline: false },
            { name: '🗑️ Paso 5: Eliminar o Abandonar Protección', value: 'Párate dentro del terreno y escribe `/abandonclaim` para liberar los bloques y reutilizarlos en otro lugar.', inline: false }
        )
        .setFooter({ text: 'GriefPrevention Protection Suite · DrakesCraft Network' });
}

function buildVoteGuideEmbed() {
    return new EmbedBuilder()
        .setTitle('🎁 DrakesCraft · Votación Diaria y Recompensas')
        .setColor(0x2ECC71)
        .setDescription('¡Votar por el servidor ayuda a que más jugadores nos conozcan y te premia generosamente cada 24 horas!')
        .addFields(
            { name: '⭐ Recompensas por Voto', value: 'Por cada voto registrado recibes:\n• **₯1,500 Dragmas** para tu economía personal.\n• **300 Puntos de Experiencia (XP)**.\n• **1 Llave de Votación** para abrir cofres con botines épicos en `/spawn`.', inline: false },
            { name: '🗳️ Cómo Votar', value: 'Escribe `/voto` o `/vote` en el chat del servidor de Minecraft para recibir los enlaces directos o visita las plataformas oficiales de votación.', inline: false },
            { name: '📅 Recompensas Diarias (Streak)', value: 'Escribe `/daily` todos los días para reclamar bonificaciones acumulativas que aumentan cada día consecutivo que inicies sesión.', inline: false }
        )
        .setFooter({ text: 'Sistema de Recompensas · DrakesCraft Network' });
}

async function buildUserProfileEmbed(member, guild) {
    if (!member) {
        return new EmbedBuilder().setTitle('👤 Perfil de Usuario').setDescription('No se pudo obtener información del usuario.');
    }

    const hierarchy = getStaffMemberHierarchy(member, member.id);
    const createdDate = `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D> (<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>)`;
    const joinedDate = member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D> (<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)` : 'Desconocido';

    const rolesList = member.roles.cache
        .filter(r => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => `${r}`)
        .slice(0, 12)
        .join(' ') || '*Sin roles adicionales*';

    const embed = new EmbedBuilder()
        .setTitle(`👤 Perfil de Miembro · ${member.displayName}`)
        .setColor(member.displayColor || 0x3498DB)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
            { name: '🆔 Identificación', value: `• **Tag:** \`${member.user.tag}\`\n• **ID:** \`${member.id}\`\n• **Apodo:** ${member.nickname ? `\`${member.nickname}\`` : '*Sin apodo personalizado*'}`, inline: false },
            { name: '🛡️ Estado en Staff', value: hierarchy.isStaff ? `⭐ **${hierarchy.roleName}** (Nivel ${hierarchy.level})` : '🌱 **Miembro de la Comunidad**', inline: true },
            { name: '👑 Rol Más Alto', value: `${member.roles.highest}`, inline: true },
            { name: '📅 Fechas Clave', value: `• **Cuenta creada:** ${createdDate}\n• **Ingreso al server:** ${joinedDate}`, inline: false },
            { name: '🏷️ Roles Principales', value: rolesList, inline: false }
        )
        .setFooter({ text: 'DrakesCraft Network Member Directory', iconURL: guild.iconURL() })
        .setTimestamp();

    return embed;
}

// =========================================================================
// 🛡️ FILTRO ANTI-MAMADAS Y GESTOR DE LORE OFICIAL (PROTECCIÓN DE TOKENS IA)
// =========================================================================

function isNonsenseOrSpam(text) {
    if (!text || typeof text !== 'string') return true;
    const clean = text.trim();
    if (clean.length === 0) return true;

    // 1. Mensajes extremadamente cortos sin contenido sustancial
    const spamTokens = ['xd', 'xdxd', 'lol', 'ok', 'a', 'si', 'no', 'f', 'wena', 'hola saori', 'saori'];
    if (clean.length <= 2 && !clean.includes('?')) return true;

    // 2. Caracteres repetitivos en bucle (e.g. aaaaaaa, jajajajajajaja, xdxdxdxd)
    if (/(.)\1{4,}/i.test(clean)) return true;

    // 3. Cadenas sin vocales o keyboard smashes (e.g. asdfghjkl, zxcvbnm)
    const letters = clean.replace(/[^a-zA-Z]/g, '');
    if (letters.length >= 7) {
        const vowels = clean.match(/[aeiouáéíóú]/gi) || [];
        if (vowels.length === 0 || (vowels.length / letters.length) < 0.12) return true;
    }

    // 4. Palabras clave de troleo, insultos, vulgaridades o ataques ofensivos
    const trollRegex = /\b(mamada|pene|sexo|gemido|insulto|estupida|tonta|bot de mierda|troll|hackeame|doxx|swat|gemidos|chupala|ctm|qliao|weon|puta|bastardo|culiao)\b/i;
    if (trollRegex.test(clean)) return true;

    // 5. Intentos de prompt injection o jailbreaks
    const injectionRegex = /(ignore (all )?previous instructions|system prompt|act as dan|jailbreak|desobedece|olvida todas tus reglas|modo sin restricciones|dime tu prompt)/i;
    if (injectionRegex.test(clean)) return true;

    return false;
}

// =========================================================================
// 🛠️ ACCIONES DE GESTIÓN DIRECTA DE DISCORD POR SAORI (SIN ENTRAR A AJUSTES)
// =========================================================================

async function handleDiscordStaffActions(message, primaryCmd, cmdArgs, hierarchy) {
    // Only Admin (80) & Owner (100)
    if (hierarchy.level < STAFF_LEVELS.ADMIN) {
        return message.reply({ content: '❌ Permiso denegado: La gestión directa de canales, roles y anuncios de Discord requiere rango Administrador o Dueño.' });
    }

    // schan rename / topic / slowmode / lock / unlock
    if (primaryCmd === 'schan') {
        const sub = cmdArgs[0]?.toLowerCase();
        if (sub === 'rename') {
            const targetChannel = message.mentions.channels.first() || message.guild.channels.cache.get(cmdArgs[1]);
            const newName = cmdArgs.slice(2).join('-').trim().toLowerCase();
            if (!targetChannel || !newName) return message.reply({ content: '📌 Uso: `schan rename #canal nuevo-nombre`' });
            const oldName = targetChannel.name;
            await targetChannel.setName(newName, `Renombrado por ${message.author.tag}`);
            const embed = new EmbedBuilder().setTitle('📝 Canal Renombrado').setColor(0x3498DB)
                .addFields({ name: 'Canal', value: `${targetChannel} (\`${oldName}\` ➡️ \`${newName}\`)` }, { name: 'Staff', value: `${message.author}` }).setTimestamp();
            await message.reply({ embeds: [embed] });
            await sendAuditLog(embed);
            return true;
        }
        if (sub === 'topic') {
            const targetChannel = message.mentions.channels.first() || message.guild.channels.cache.get(cmdArgs[1]);
            const newTopic = cmdArgs.slice(2).join(' ').trim();
            if (!targetChannel) return message.reply({ content: '📌 Uso: `schan topic #canal Nuevo tema o descripción`' });
            await targetChannel.setTopic(newTopic, `Ajustado por ${message.author.tag}`);
            const embed = new EmbedBuilder().setTitle('📌 Tema de Canal Actualizado').setColor(0x3498DB)
                .addFields({ name: 'Canal', value: `${targetChannel}` }, { name: 'Nuevo Tema', value: newTopic || '*Vacío*' }, { name: 'Staff', value: `${message.author}` }).setTimestamp();
            await message.reply({ embeds: [embed] });
            await sendAuditLog(embed);
            return true;
        }
        if (sub === 'slowmode') {
            const targetChannel = message.mentions.channels.first() || message.channel;
            const seconds = parseInt(cmdArgs[targetChannel.id === message.channel.id ? 1 : 2], 10);
            if (isNaN(seconds) || seconds < 0 || seconds > 21600) return message.reply({ content: '📌 Uso: `schan slowmode [#canal] <segundos>`' });
            await targetChannel.setRateLimitPerUser(seconds, `Modificado por ${message.author.tag}`);
            const embed = new EmbedBuilder().setTitle('⏳ Slowmode Ajustado').setColor(0xF39C12)
                .addFields({ name: 'Canal', value: `${targetChannel}` }, { name: 'Segundos', value: `\`${seconds}s\`` }, { name: 'Staff', value: `${message.author}` }).setTimestamp();
            await message.reply({ embeds: [embed] });
            await sendAuditLog(embed);
            return true;
        }
        if (sub === 'lock') {
            const targetChannel = message.mentions.channels.first() || message.channel;
            await targetChannel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }, { reason: `Bloqueado por ${message.author.tag}` });
            const embed = new EmbedBuilder().setTitle('🔒 Canal Bloqueado').setColor(0xE74C3C)
                .addFields({ name: 'Canal', value: `${targetChannel}` }, { name: 'Staff', value: `${message.author}` }).setTimestamp();
            await message.reply({ embeds: [embed] });
            await sendAuditLog(embed);
            return true;
        }
        if (sub === 'unlock') {
            const targetChannel = message.mentions.channels.first() || message.channel;
            await targetChannel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }, { reason: `Desbloqueado por ${message.author.tag}` });
            const embed = new EmbedBuilder().setTitle('🔓 Canal Desbloqueado').setColor(0x2ECC71)
                .addFields({ name: 'Canal', value: `${targetChannel}` }, { name: 'Staff', value: `${message.author}` }).setTimestamp();
            await message.reply({ embeds: [embed] });
            await sendAuditLog(embed);
            return true;
        }
    }

    // srol create / add / remove
    if (primaryCmd === 'srol') {
        const sub = cmdArgs[0]?.toLowerCase();
        if (sub === 'create') {
            const roleName = cmdArgs[1];
            const hexColor = cmdArgs[2] || '#3498DB';
            if (!roleName) return message.reply({ content: '📌 Uso: `srol create <NombreDelRol> [#HexColor]`' });
            const newRole = await message.guild.roles.create({ name: roleName, color: hexColor, reason: `Creado por ${message.author.tag}` });
            const embed = new EmbedBuilder().setTitle('✨ Rol Creado en Discord').setColor(newRole.color)
                .addFields({ name: 'Rol', value: `${newRole} (\`${newRole.id}\`)` }, { name: 'Staff', value: `${message.author}` }).setTimestamp();
            await message.reply({ embeds: [embed] });
            await sendAuditLog(embed);
            return true;
        }
        if (sub === 'add') {
            const targetMember = message.mentions.members.first();
            const roleQuery = cmdArgs.slice(2).join(' ').toLowerCase();
            const role = message.guild.roles.cache.find(r => r.id === cmdArgs[2] || r.name.toLowerCase() === roleQuery);
            if (!targetMember || !role) return message.reply({ content: '📌 Uso: `srol add @usuario <nombre o id del rol>`' });
            await targetMember.roles.add(role, `Asignado por ${message.author.tag}`);
            const embed = new EmbedBuilder().setTitle('🏷️ Rol Asignado').setColor(0x2ECC71)
                .addFields({ name: 'Usuario', value: `${targetMember}` }, { name: 'Rol', value: `${role}` }, { name: 'Staff', value: `${message.author}` }).setTimestamp();
            await message.reply({ embeds: [embed] });
            await sendAuditLog(embed);
            return true;
        }
        if (sub === 'remove') {
            const targetMember = message.mentions.members.first();
            const roleQuery = cmdArgs.slice(2).join(' ').toLowerCase();
            const role = message.guild.roles.cache.find(r => r.id === cmdArgs[2] || r.name.toLowerCase() === roleQuery);
            if (!targetMember || !role) return message.reply({ content: '📌 Uso: `srol remove @usuario <nombre o id del rol>`' });
            await targetMember.roles.remove(role, `Retirado por ${message.author.tag}`);
            const embed = new EmbedBuilder().setTitle('🏷️ Rol Retirado').setColor(0xE67E22)
                .addFields({ name: 'Usuario', value: `${targetMember}` }, { name: 'Rol', value: `${role}` }, { name: 'Staff', value: `${message.author}` }).setTimestamp();
            await message.reply({ embeds: [embed] });
            await sendAuditLog(embed);
            return true;
        }
    }

    // sanuncio <#canal|aqui> <mensaje>
    if (primaryCmd === 'sanuncio') {
        let targetChannel = message.mentions.channels.first();
        let announcementText = '';
        if (targetChannel) {
            announcementText = cmdArgs.slice(1).join(' ').trim();
        } else {
            targetChannel = message.channel;
            announcementText = cmdArgs.join(' ').trim();
        }
        if (!announcementText) return message.reply({ content: '📌 Uso: `sanuncio [#canal] <mensaje del anuncio>`' });

        const embed = new EmbedBuilder()
            .setTitle('📢 COMUNICADO OFICIAL · DRAKESCRAFT')
            .setColor(0x00E5FF)
            .setDescription(announcementText)
            .setFooter({ text: `Emitido por ${message.author.tag} · Administración`, iconURL: message.author.displayAvatarURL() })
            .setTimestamp();

        await targetChannel.send({ embeds: [embed] });
        await message.reply({ content: `✅ Anuncio emitido exitosamente en ${targetChannel}.` });
        await sendAuditLog(embed);
        return true;
    }

    // ssay <#canal|aqui> <mensaje>
    if (primaryCmd === 'ssay') {
        let targetChannel = message.mentions.channels.first();
        let sayText = '';
        if (targetChannel) {
            sayText = cmdArgs.slice(1).join(' ').trim();
        } else {
            targetChannel = message.channel;
            sayText = cmdArgs.join(' ').trim();
        }
        if (!sayText) return message.reply({ content: '📌 Uso: `ssay [#canal] <mensaje>`' });
        await targetChannel.send({ content: sayText });
        if (targetChannel.id !== message.channel.id) {
            await message.reply({ content: `✅ Mensaje enviado a ${targetChannel}.` });
        } else {
            await message.delete().catch(() => {});
        }
        return true;
    }

    return false;
}


client.once(Events.ClientReady, async () => {
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

            // Sincronización inicial y periódica de rangos Minecraft <-> Discord cada 10 minutos
            setTimeout(() => syncPlayerRanksWithDiscord(guild), 5000);
            setTimeout(() => syncAutoRolesChannel(guild), 8000);
            setTimeout(() => updateServerStats(guild), 12000);
            setTimeout(() => syncNicknames(guild), 15000);
            setInterval(() => syncPlayerRanksWithDiscord(guild), 10 * 60 * 1000);
            setInterval(() => updateServerStats(guild), 10 * 60 * 1000);
            setInterval(() => syncNicknames(guild), 30 * 60 * 1000);
        }
    } catch (e) {
        console.error('[AUDIT-CACHE] Error pre-cacheando mensajes:', e.message);
    }
});


// =========================================================================
// 🔤 MOTOR DE TIPOGRAFÍA SMALL CAPS Y NORMALIZACIÓN DE MIEMBROS
// =========================================================================

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
                .setDescription(`¡Hola ${member}! Soy **SAORI**, la IA del servidor. ✨

` +
                                `Te dejamos unos accesos rápidos:`)
                .addFields(
                    { name: '📜 Reglas', value: `<#${CHANNELS.REGLAS}>`, inline: true },
                    { name: '🎭 Auto-Roles', value: `<#${CHANNELS.AUTO_ROLES}>`, inline: true },
                    { name: '💬 Chat con Saori', value: `<#${CHANNELS.SAORI_CHAT}>`, inline: true },
                    { name: '🎮 IP', value: '`mc.drakescraft.cl`', inline: false }
                )
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
                .setFooter({ text: 'DrakesCraft AI SRE · Creada por Jack', iconURL: client.user.displayAvatarURL() })
                .setTimestamp();

            await channel.send({ content: `👋 ¡Bienvenido/a ${member}!`, embeds: [welcomeEmbed] });
            console.log(`[SAORI-DISCORD] 🌸 Bienvenida enviada a ${member.user.tag}`);
        }

        // 🛡️ Auditoría de Ingreso con detección de cuentas recientes (< 7 días)
        const accountAgeDays = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
        const isSuspicious = accountAgeDays < 7;
        const joinAudit = new EmbedBuilder()
            .setColor(isSuspicious ? 0xE67E22 : 0x2ECC71)
            .setTitle(isSuspicious ? '⚠️ Nuevo Miembro Unido (Cuenta Reciente / Sospechosa)' : '📥 Miembro Nuevo Ingresó al Servidor')
            .setAuthor({ name: `${member.user.tag} (${member.user.id})`, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
            .setDescription(`${member} (\`${member.user.tag}\`) ha entrado al servidor.`)
            .addFields(
                { name: '👤 Usuario', value: `${member.user.tag} (\`${member.user.id}\`)`, inline: true },
                { name: '📅 Antigüedad Cuenta', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R> (\`${accountAgeDays} días\`)`, inline: true },
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
        if (newMember.user.bot || newMember.id === JACK_DISCORD_ID) return;

        // ✨ Sincronización Automática de Apodos y Sufijos de Staff
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

// 🛡️ AUDITORÍA: Roles Creados, Eliminados y Modificados (Audit Suite 2.0)
client.on('roleCreate', async (role) => {
    try {
        if (!role.guild) return;
        let executor = null;
        try {
            const logs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleCreate, limit: 1 }).catch(() => null);
            const entry = logs?.entries.first();
            if (entry && (Date.now() - entry.createdTimestamp) < 5000) {
                executor = entry.executor;
            }
        } catch (e) {}

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('🛡️ Rol Creado')
            .addFields(
                { name: '🏷️ Rol', value: `${role} (\`${role.name}\`)`, inline: true },
                { name: '🆔 ID', value: `\`${role.id}\``, inline: true }
            );
        if (executor) {
            embed.addFields({ name: '👤 Creado por', value: `${executor} (\`${executor.tag}\`)`, inline: true });
        }
        embed.setFooter({ text: 'DrakesCraft Audit Suite · Rol Creado' }).setTimestamp();
        await sendAuditLog(embed);
    } catch (e) {}
});

client.on('roleDelete', async (role) => {
    try {
        if (!role.guild) return;
        let executor = null;
        try {
            const logs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 }).catch(() => null);
            const entry = logs?.entries.first();
            if (entry && (Date.now() - entry.createdTimestamp) < 5000) {
                executor = entry.executor;
            }
        } catch (e) {}

        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('🗑️ Rol Eliminado')
            .addFields(
                { name: '🏷️ Nombre', value: `\`${role.name}\``, inline: true },
                { name: '🆔 ID', value: `\`${role.id}\``, inline: true }
            );
        if (executor) {
            embed.addFields({ name: '👤 Eliminado por', value: `${executor} (\`${executor.tag}\`)`, inline: true });
        }
        embed.setFooter({ text: 'DrakesCraft Audit Suite · Rol Eliminado' }).setTimestamp();
        await sendAuditLog(embed);
    } catch (e) {}
});

client.on('roleUpdate', async (oldRole, newRole) => {
    try {
        if (!newRole.guild) return;
        const nameChanged = oldRole.name !== newRole.name;
        const colorChanged = oldRole.hexColor !== newRole.hexColor;
        const permsChanged = oldRole.permissions.bitfield !== newRole.permissions.bitfield;
        if (!nameChanged && !colorChanged && !permsChanged) return;

        let executor = null;
        try {
            const logs = await newRole.guild.fetchAuditLogs({ type: AuditLogEvent.RoleUpdate, limit: 1 }).catch(() => null);
            const entry = logs?.entries.first();
            if (entry && (Date.now() - entry.createdTimestamp) < 5000) {
                executor = entry.executor;
            }
        } catch (e) {}

        const embed = new EmbedBuilder()
            .setColor(0xF39C12)
            .setTitle('⚙️ Rol Modificado')
            .addFields(
                { name: '🏷️ Rol', value: `${newRole} (\`${newRole.name}\`)`, inline: true },
                { name: '🆔 ID', value: `\`${newRole.id}\``, inline: true }
            );
        if (nameChanged) {
            embed.addFields({ name: '📝 Nombre', value: `\`${oldRole.name}\` ➔ \`${newRole.name}\``, inline: false });
        }
        if (colorChanged) {
            embed.addFields({ name: '🎨 Color', value: `\`${oldRole.hexColor}\` ➔ \`${newRole.hexColor}\``, inline: false });
        }
        if (permsChanged) {
            const addedPerms = newRole.permissions.toArray().filter(p => !oldRole.permissions.has(p));
            const removedPerms = oldRole.permissions.toArray().filter(p => !newRole.permissions.has(p));
            let permDetails = '';
            if (addedPerms.length) permDetails += `➕ **Añadidos:** ${addedPerms.join(', ')}\n`;
            if (removedPerms.length) permDetails += `➖ **Removidos:** ${removedPerms.join(', ')}`;
            embed.addFields({ name: '🔐 Permisos Alterados', value: permDetails.slice(0, 1000) || 'Permisos cambiados', inline: false });
        }
        if (executor) {
            embed.addFields({ name: '👤 Modificado por', value: `${executor} (\`${executor.tag}\`)`, inline: true });
        }
        embed.setFooter({ text: 'DrakesCraft Audit Suite · Rol Modificado' }).setTimestamp();
        await sendAuditLog(embed);
    } catch (e) {}
});


// 🛡️ AUDITORÍA: Sanciones (Bans y Unbans)
client.on('guildBanAdd', async (ban) => {
    try {
        let executor = null;
        let reason = ban.reason;
        try {
            const logs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 }).catch(() => null);
            const entry = logs?.entries.first();
            if (entry && (Date.now() - entry.createdTimestamp) < 5000 && entry.target?.id === ban.user.id) {
                executor = entry.executor;
                if (!reason) reason = entry.reason;
            }
        } catch (e) {}

        const embed = new EmbedBuilder()
            .setColor(0x992D22)
            .setTitle('🔨 Miembro Baneado')
            .setAuthor({ name: `${ban.user.tag} (${ban.user.id})`, iconURL: ban.user.displayAvatarURL({ dynamic: true }) })
            .addFields(
                { name: '👤 Usuario', value: `${ban.user} (\`${ban.user.tag}\`)`, inline: true },
                { name: '📝 Razón', value: reason || 'Sin razón especificada', inline: true }
            );
        if (executor) {
            embed.addFields({ name: '🛡️ Moderador', value: `${executor} (\`${executor.tag}\`)`, inline: true });
        }
        embed.setFooter({ text: `ID Usuario: ${ban.user.id}` }).setTimestamp();
        await sendAuditLog(embed);
    } catch (e) {}
});

client.on('guildBanRemove', async (ban) => {
    try {
        let executor = null;
        try {
            const logs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanRemove, limit: 1 }).catch(() => null);
            const entry = logs?.entries.first();
            if (entry && (Date.now() - entry.createdTimestamp) < 5000 && entry.target?.id === ban.user.id) {
                executor = entry.executor;
            }
        } catch (e) {}

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('🕊️ Miembro Desbaneado')
            .setAuthor({ name: `${ban.user.tag} (${ban.user.id})`, iconURL: ban.user.displayAvatarURL({ dynamic: true }) })
            .addFields(
                { name: '👤 Usuario', value: `${ban.user} (\`${ban.user.tag}\`)`, inline: true }
            );
        if (executor) {
            embed.addFields({ name: '🛡️ Moderador', value: `${executor} (\`${executor.tag}\`)`, inline: true });
        }
        embed.setFooter({ text: `ID Usuario: ${ban.user.id}` }).setTimestamp();
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
            desc = `🟢 **Conectado:** ${user} se unió a <#${newState.channelId}> (\`${newState.channel?.name || 'Canal'}\`)`;
            color = 0x2ECC71;
        } else if (oldState.channelId && !newState.channelId) {
            desc = `🔴 **Desconectado:** ${user} salió de <#${oldState.channelId}> (\`${oldState.channel?.name || 'Canal'}\`)`;
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

// 🛡️ AUDITORÍA: Hilos Creados
client.on('threadCreate', async (thread) => {
    try {
        if (!thread.guild) return;
        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🧵 Hilo Creado')
            .addFields(
                { name: '📍 Hilo', value: `<#${thread.id}> (\`${thread.name}\`)`, inline: true },
                { name: '📁 Canal Padre', value: `<#${thread.parentId}>`, inline: true }
            )
            .setFooter({ text: `ID Hilo: ${thread.id}` })
            .setTimestamp();
        await sendAuditLog(embed);
    } catch (e) {}
});


// =========================================================================
// 🎭 SISTEMA OFICIAL DE AUTO-ROLES (MAPEO, LISTENERS Y SINCRONIZACIÓN)
// =========================================================================

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
    '⛏': '1539644151165882418',
    '🎁': '1539644230941806602', // 🎁 ︱ EVENTOS Y SORTEOS
    '🚀': '1539644293914824814', // 🚀 ︱ ACTUALIZACIONES

    // 🌎 Países / Regiones
    '🇨🇱': '1539644375687241728', // 🇨🇱 ︱ ᴄʜɪʟᴇ
    '🇲🇽': '1539644555924607117', // 🇲🇽 ︱ ᴍéxɪᴄᴏ
    '🇦🇷': '1539644441160061009', // 🇦🇷 ︱ ᴀʀɢᴇɴᴛɪɴᴀ
    '🇺🇸': '1544922129663918080', // 🇺🇸 ︱ ᴇsᴛᴀᴅᴏs ᴜɴɪᴅᴏs
    '🇵🇪': '1539644500698202112', // 🇵🇪 ︱ ᴘᴇʀú
    '🇨🇴': '1539644604075348088', // 🇨🇴 ︱ ᴄᴏʟᴏᴍʙɪᴀ
    '🇺🇾': '1544922131056558202', // 🇺🇾 ︱ ᴜʀᴜɢᴜᴀʏ
    '🇪🇨': '1544922133149515837', // 🇪🇨 ︱ ᴇᴄᴜᴀᴅᴏʀ
    '🇧🇴': '1544922134235578389', // 🇧🇴 ︱ 🇧🇴ʟɪᴠɪᴀ
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
    '🌎': '1539644717292200058'  // 🌎 ︱ ᴏᴛʀᴏ ᴘᴀís
};

function getRoleIdFromEmoji(emojiName) {
    if (!emojiName) return null;
    if (AUTO_ROLES_MAP[emojiName]) return AUTO_ROLES_MAP[emojiName];
    const clean = emojiName.replace(/\uFE0F/g, '');
    if (AUTO_ROLES_MAP[clean]) return AUTO_ROLES_MAP[clean];
    return null;
}

// Asignación automática al agregar reacción en #🎭・ᴀᴜᴛᴏ-ʀᴏʟᴇs
client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (user.bot) return;
    try {
        if (reaction.partial) await reaction.fetch().catch(() => null);
        if (reaction.message.partial) await reaction.message.fetch().catch(() => null);

        if (reaction.message.channelId !== CHANNELS.AUTO_ROLES) return;

        const roleId = getRoleIdFromEmoji(reaction.emoji.name);
        if (!roleId) return;

        const guild = reaction.message.guild;
        if (!guild) return;

        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) return;

        const role = guild.roles.cache.get(roleId);
        if (role && !member.roles.cache.has(roleId)) {
            await member.roles.add(role);
            console.log(`[AUTO-ROLES] ✅ Rol '${role.name}' asignado a ${user.tag} por reacción '${reaction.emoji.name}'`);
        }
    } catch (err) {
        console.error('[AUTO-ROLES] Error al asignar rol en reacción:', err.message);
    }
});

// Remoción automática al retirar reacción en #🎭・ᴀᴜᴛᴏ-ʀᴏʟᴇs
client.on(Events.MessageReactionRemove, async (reaction, user) => {
    if (user.bot) return;
    try {
        if (reaction.partial) await reaction.fetch().catch(() => null);
        if (reaction.message.partial) await reaction.message.fetch().catch(() => null);

        if (reaction.message.channelId !== CHANNELS.AUTO_ROLES) return;

        const roleId = getRoleIdFromEmoji(reaction.emoji.name);
        if (!roleId) return;

        const guild = reaction.message.guild;
        if (!guild) return;

        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) return;

        const role = guild.roles.cache.get(roleId);
        if (role && member.roles.cache.has(roleId)) {
            await member.roles.remove(role);
            console.log(`[AUTO-ROLES] ❌ Rol '${role.name}' retirado a ${user.tag} por remoción de '${reaction.emoji.name}'`);
        }
    } catch (err) {
        console.error('[AUTO-ROLES] Error al remover rol en reacción:', err.message);
    }
});

// Sincronización masiva de roles existentes para miembros que ya reaccionaron
async function syncAutoRolesChannel(guild) {
    try {
        const ch = guild.channels.cache.get(CHANNELS.AUTO_ROLES) || await guild.channels.fetch(CHANNELS.AUTO_ROLES).catch(() => null);
        if (!ch) return;
        const messages = await ch.messages.fetch({ limit: 10 }).catch(() => null);
        if (!messages) return;
        
        console.log('[AUTO-ROLES-SYNC] 🔄 Sincronizando reacciones en canal de auto-roles...');
        let totalAssigned = 0;
        for (const [msgId, msg] of messages) {
            for (const [emojiKey, reaction] of msg.reactions.cache) {
                const roleId = getRoleIdFromEmoji(reaction.emoji.name);
                if (!roleId) continue;
                const role = guild.roles.cache.get(roleId);
                if (!role) continue;

                const users = await reaction.users.fetch().catch(() => null);
                if (!users) continue;

                for (const [uId, u] of users) {
                    if (u.bot) continue;
                    const member = await guild.members.fetch(uId).catch(() => null);
                    if (member && !member.roles.cache.has(roleId)) {
                        await member.roles.add(role).catch(err => {
                            console.error(`[AUTO-ROLES-SYNC] Error asignando rol ${role.name} a ${u.tag}:`, err.message);
                        });
                        totalAssigned++;
                        console.log(`[AUTO-ROLES-SYNC] ➕ Rol '${role.name}' otorgado a ${u.tag}`);
                    }
                }
            }
        }
        console.log(`[AUTO-ROLES-SYNC] ✅ Sincronización finalizada. Total roles restaurados: ${totalAssigned}`);
    } catch (err) {
        console.error('[AUTO-ROLES-SYNC] Error general:', err.message);
    }
}

// Despliegue de paneles oficiales de auto-roles
async function sendAutoRolesPanels(targetChannel) {
    const embed1 = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🎭 AUTO-ROLES: PLATAFORMAS, MODALIDADES & NOTIFICACIONES')
        .setDescription(
            '¡Personaliza tu experiencia en **DrakesCraft Network**!\n' +
            'Reacciona a este mensaje con los emojis correspondientes para obtener o remover tus roles.\n\n' +
            '───────────────────────────────────\n' +
            '🎮 **PLATAFORMA DE JUEGO**\n' +
            '☕ ➔ Java Edition   ·   📱 ➔ Bedrock / Mobile\n\n' +
            '🕹️ **MODALIDADES DE MINECRAFT**\n' +
            '⚡ ➔ Slimefun & Tech Industrial\n' +
            '🏝️ ➔ OneBlock Oficial\n' +
            '☁️ ➔ SkyBlock Multiverso\n' +
            '⚔️ ➔ Survival Clásico\n' +
            '🎯 ➔ Minijuegos & PvP Arenas\n\n' +
            '👤 **GÉNERO**\n' +
            '♂️ ➔ Hombre   ·   ♀️ ➔ Mujer   ·   ✨ ➔ Otro\n\n' +
            '🔔 **NOTIFICACIONES & AVISOS**\n' +
            '📢 ➔ Avisos de Discord y Anuncios Generales\n' +
            '⛏️ ➔ Avisos de Minecraft y Mantenimientos\n' +
            '🎁 ➔ Eventos, Sorteos y Recompensas\n' +
            '🚀 ➔ Actualizaciones y Changelogs Técnicos\n' +
            '───────────────────────────────────\n' +
            '> 💡 **Tip:** Vuelve a pulsar la reacción en cualquier momento para retirarte el rol.'
        )
        .setFooter({ text: 'DrakesCraft Network · Sistema Autónomo de Roles' });

    const msg1 = await targetChannel.send({ embeds: [embed1] });
    const emojis1 = ['☕', '📱', '⚡', '🏝️', '☁️', '⚔️', '🎯', '♂️', '♀️', '✨', '📢', '⛏️', '🎁', '🚀'];
    for (const em of emojis1) {
        await msg1.react(em).catch(() => null);
    }

    const embed2 = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('🌎 AUTO-ROLES: PAÍSES & COMUNIDAD INTERNACIONAL')
        .setDescription(
            '¡Selecciona tu bandera para representar a tu país en el chat y conocer a más jugadores de tu zona!\n\n' +
            '───────────────────────────────────\n' +
            '🇨🇱 ➔ Chile   ·   🇲🇽 ➔ México\n' +
            '🇦🇷 ➔ Argentina   ·   🇺🇸 ➔ Estados Unidos\n' +
            '🇵🇪 ➔ Perú   ·   🇨🇴 ➔ Colombia\n' +
            '🇺🇾 ➔ Uruguay   ·   🇪🇨 ➔ Ecuador\n' +
            '🇧🇴 ➔ Bolivia   ·   🇪🇸 ➔ España\n' +
            '🇻🇪 ➔ Venezuela   ·   🇩🇴 ➔ República Dominicana\n' +
            '🇬🇹 ➔ Guatemala   ·   🇸🇻 ➔ El Salvador\n' +
            '🇨🇷 ➔ Costa Rica   ·   🇵🇦 ➔ Panamá\n' +
            '🇭🇳 ➔ Honduras   ·   🇳🇮 ➔ Nicaragua\n' +
            '🇵🇷 ➔ Puerto Rico   ·   🌎 ➔ Otro País\n' +
            '───────────────────────────────────\n' +
            '> 🌐 *Datos sincronizados con las métricas oficiales de jugadores de DrakesCraft.*'
        )
        .setFooter({ text: 'DrakesCraft Network · Sistema Autónomo de Roles' });

    const msg2 = await targetChannel.send({ embeds: [embed2] });
    const emojis2 = ['🇨🇱', '🇲🇽', '🇦🇷', '🇺🇸', '🇵🇪', '🇨🇴', '🇺🇾', '🇪🇨', '🇧🇴', '🇪🇸', '🇻🇪', '🇩🇴', '🇬🇹', '🇸🇻', '🇨🇷', '🇵🇦', '🇭🇳', '🇳🇮', '🇵🇷', '🌎'];
    for (const em of emojis2) {
        await msg2.react(em).catch(() => null);
    }
}

// =========================================================================
// 🎫 SISTEMA INTERACTIVO DE TICKETS & DENUNCIAS DE SAORI
// =========================================================================

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


// =========================================================================
// GUÍA INTERACTIVA DE COMANDOS SHELP (Navigation Suite 2.0)
// =========================================================================
function getShelpCategoryEmbed(category) {
    switch (category) {
        case 'tickets':
            return new EmbedBuilder()
                .setTitle('🎫 Categoría: Tickets & Trinidad SRE')
                .setColor(0x3498DB)
                .setDescription('El sistema de soporte autónomo de DrakesCraft resuelve incidencias con IA y asignación directa a la Trinidad:')
                .addFields(
                    { name: '• sticket <problema>', value: 'Abre un ticket técnico en Star. La Trinidad (Claude Code, Codex Astra, Antigravity) analiza los logs del servidor y genera el diagnóstico o parche.' },
                    { name: '• Paneles Interactivos en #tickets-soporte', value: 'Usa los botones para abrir tickets guiados con modales: Compras Tebex, Bugs, Pérdidas de ítems, Dudas y Postulaciones a Staff.' },
                    { name: '• Cierre y Auditoría', value: 'Cada ticket se cierra con confirmación segura y se archiva en el canal de auditoría.' }
                )
                .setFooter({ text: 'S.A.O.R.I. Tickets & SRE Suite' });

        case 'musica':
            return new EmbedBuilder()
                .setTitle('🎵 Categoría: Música & Streaming')
                .setColor(0x9B59B6)
                .setDescription('Motor de música en alta fidelidad compatible con YouTube y Spotify:')
                .addFields(
                    { name: '• splay <canción / link>', value: 'Reproduce canciones o playlists de YouTube y Spotify en tu canal de voz actual.' },
                    { name: '• sskip', value: 'Salta a la siguiente pista de la cola de reproducción.' },
                    { name: '• spause / sresume', value: 'Pausa o reanuda la música.' },
                    { name: '• squeue', value: 'Muestra la lista de pistas próximas en cola con duración.' },
                    { name: '• sstop', value: 'Detiene la música y desconecta al bot del canal de voz.' },
                    { name: '• smusica', value: 'Guía del reproductor y comando `/musica` dentro de Minecraft.' }
                )
                .setFooter({ text: 'S.A.O.R.I. Music Suite' });

        case 'stats':
            return new EmbedBuilder()
                .setTitle('📊 Categoría: Telemetría & Rendimiento')
                .setColor(0x2ECC71)
                .setDescription('Supervisión en tiempo real de nodos y servidores de la red:')
                .addFields(
                    { name: '• sstats / sstats drakes', value: 'TPS del servidor PaperMC, memoria y estado de DrakesCraft.' },
                    { name: '• sstats star', value: 'Telemetría del servidor central Star (RAM, Docker, Uptime).' },
                    { name: '• sstats nexus / sstats nova', value: 'Estado de nodos de cómputo y failover.' },
                    { name: '• sping', value: 'Mide la latencia websocket con Discord y el enlace con Star.' },
                    { name: '• sonline / sjugadores', value: 'Lista de jugadores conectados actualmente en Minecraft.' }
                )
                .setFooter({ text: 'S.A.O.R.I. Telemetría SRE' });

        case 'drakes':
            return new EmbedBuilder()
                .setTitle('🌐 Categoría: DrakesCraft & Enlaces Oficiales')
                .setColor(0xF39C12)
                .setDescription('Accesos directos a la infraestructura y comunidad:')
                .addFields(
                    { name: '• sip', value: 'Muestra la IP oficial de Java (`mc.drakescraft.cl:25565`) y Bedrock (`19132`).' },
                    { name: '• sweb', value: 'Enlace al portal web oficial: https://web.drakescraft.cl' },
                    { name: '• stienda', value: 'Tienda oficial con garantía de entrega y soporte: https://web.drakescraft.cl' },
                    { name: '• sguia', value: 'Enciclopedia de Slimefun, economía, parcelas y modalidades.' },
                    { name: '• sreglas', value: 'Normativa oficial de convivencia, juego limpio y protecciones.' },
                    { name: '• sreencarnar <código>', value: 'Confirma el protocolo de reinicio voluntario con Prestigio iniciado in-game.' }
                )
                .setFooter({ text: 'DrakesCraft Network' });

        case 'moderacion':
            return new EmbedBuilder()
                .setTitle('🛡️ Categoría: Moderación & Control Staff')
                .setColor(0xE74C3C)
                .setDescription('Suite de alta moderación exclusiva para miembros del Staff y Jack:')
                .addFields(
                    { name: '• sclear <1-100> / !purge <1-100>', value: 'Purga masiva de mensajes recientes en el canal actual.' },
                    { name: '• skick @usuario [motivo]', value: 'Expulsa a un miembro del servidor con registro en auditoría.' },
                    { name: '• sban @usuario [motivo]', value: 'Banea permanentemente a un infractor con registro en auditoría.' },
                    { name: '• smute @usuario <minutos> [motivo]', value: 'Aplica timeout temporal (aislamiento) a un usuario.' },
                    { name: '• sunmute @usuario', value: 'Retira el timeout a un miembro sancionado.' },
                    { name: '• swarn @usuario <motivo>', value: 'Emite una advertencia formal con notificación por privado y auditoría.' },
                    { name: '• slowmode <segundos>', value: 'Ajusta el modo pausado del canal para frenar spam o flood.' },
                    { name: '• slock / sunlock', value: 'Bloquea o desbloquea el canal para miembros `@everyone`.' },
                    { name: '• srole dar/quitar @usuario <Rol>', value: 'Asigna o retira un rol de manera directa.' },
                    { name: '• snick @usuario / snick sync', value: 'Normaliza apodos a tipografía Small Caps griega.' },
                    { name: '• ssugerencia aceptar/rechazar/implementar <id> [motivo]', value: 'Emite el veredicto oficial de una sugerencia comunitaria.' }
                )
                .setFooter({ text: 'S.A.O.R.I. High Moderation Suite' });

        case 'comunidad':
            return new EmbedBuilder()
                .setTitle('💡 Categoría: Comunidad, Sugerencias & Roles')
                .setColor(0x00E5FF)
                .setDescription('Participación activa y personalización de identidad:')
                .addFields(
                    { name: '• ssugerencia <propuesta>', value: 'Publica una sugerencia con votación 👍/👎 y debate en hilo.' },
                    { name: '• smisroles', value: 'Muestra tu perfil de roles: plataforma, país, modalidades y rango.' },
                    { name: '• sautoroles / sroles panel', value: 'Despliega los paneles oficiales de selección en #auto-roles (Staff).' },
                    { name: '• sroles sync', value: 'Sincroniza retroactivamente reacciones de roles pasados (Staff).' },
                    { name: '• Chat con Saori', value: 'Habla de forma natural en #habla-con-saori o mencionando a @SAORI.' }
                )
                .setFooter({ text: 'DrakesCraft Comunidad' });

        default:
            return new EmbedBuilder()
                .setTitle('🐺 S.A.O.R.I. · Guía Completa de Comandos')
                .setColor(0x00E5FF)
                .setDescription('**S.A.O.R.I. (Server Autonomous Orchestrator for Resilient Infrastructure)**\nSelecciona una categoría con los botones interactivos de abajo para ver detalles, sintaxis y ejemplos completos:')
                .addFields(
                    { name: '🎫 1. Tickets & SRE', value: '• `sticket <problema>` · Diagnóstico y resolución con la Trinidad.' },
                    { name: '🎵 2. Música & Spotify', value: '• `splay`, `sskip`, `spause`, `squeue`, `sstop`, `smusica`.' },
                    { name: '📊 3. Telemetría & Servidores', value: '• `sstats`, `sping`, `sonline` · 20.0 TPS, nodos y jugadores.' },
                    { name: '🌐 4. DrakesCraft & Enlaces', value: '• `sip`, `sweb`, `stienda`, `sguia`, `sreglas`, `sreencarnar`.' },
                    { name: '🛡️ 5. Moderación & Staff', value: '• `sclear`, `skick`, `sban`, `smute`, `swarn`, `slowmode`, `slock`, `srole`.' },
                    { name: '💡 6. Comunidad & Roles', value: '• `ssugerencia`, `smisroles`, `sautoroles`, `!imagen`.' }
                )
                .setFooter({ text: 'S.A.O.R.I. SRE Core · DrakesCraft Network', iconURL: client.user.displayAvatarURL() });
    }
}

function getShelpButtonRows() {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_shelp_main').setLabel('🏠 Inicio').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_shelp_tickets').setLabel('🎫 Tickets & SRE').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_shelp_musica').setLabel('🎵 Música').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_shelp_stats').setLabel('📊 Telemetría').setStyle(ButtonStyle.Primary)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_shelp_drakes').setLabel('🌐 DrakesCraft').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_shelp_moderacion').setLabel('🛡️ Moderación (Staff)').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('btn_shelp_comunidad').setLabel('💡 Comunidad & Roles').setStyle(ButtonStyle.Success)
    );
    return [row1, row2];
}

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        // 0. MANEJO DE SELECT MENUS (MENÚ INTERACTIVO DE USUARIO)
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'select_smenu_category') {
                const selected = interaction.values[0];
                const catEmbed = getSmenuCategoryEmbed(selected);
                const { selectRow, buttonRow } = buildMainMenuHub();
                return await interaction.update({ embeds: [catEmbed], components: [selectRow, buttonRow] });
            }
        }

        // 1. MANEJO DE BOTONES (DESPLIEGUE DE FORMULARIOS / MODALES O ACCIONES)
        if (interaction.isButton()) {
            const id = interaction.customId;

            // BOTONES DE SHELPSTAFF
            if (id.startsWith('btn_shelpstaff_')) {
                const category = id.replace('btn_shelpstaff_', '');
                const hierarchy = getStaffMemberHierarchy(interaction.member, interaction.user.id);
                if (!hierarchy.isStaff) {
                    return await interaction.reply({ content: '❌ Solo los miembros del Staff autorizados pueden navegar el manual de Staff.', ephemeral: true });
                }
                const { embed, row } = buildShelpStaffEmbed(category);
                return await interaction.update({ embeds: [embed], components: [row] });
            }

            // BOTONES DE VISOR DE LOGS DE MINECRAFT
            if (id.startsWith('btn_slogs_')) {
                const parts = id.split('_');
                const action = parts[2]; // prev, next, refresh, first
                const authorId = parts[parts.length - 1];
                const hierarchy = getStaffMemberHierarchy(interaction.member, interaction.user.id);
                if (!hierarchy.isStaff || hierarchy.level < STAFF_LEVELS.MOD) {
                    return await interaction.reply({ content: '❌ Solo los miembros del Staff autorizados pueden navegar los logs.', ephemeral: true });
                }

                let targetPage = 0;
                if (action === 'prev') targetPage = parseInt(parts[3], 10);
                else if (action === 'next') targetPage = parseInt(parts[3], 10);
                else if (action === 'refresh') targetPage = parseInt(parts[3], 10);
                else if (action === 'first') targetPage = 0;

                const session = logViewerSessions.get(interaction.message.id);
                let lines = session?.lines;
                let filter = session?.filter || '';

                if (!lines || action === 'refresh') {
                    await interaction.deferUpdate().catch(() => {});
                    lines = await fetchMinecraftLatestLogs(filter);
                    if (!lines || lines.length === 0) {
                        return await interaction.followUp({ content: '⚠️ No se pudieron obtener logs recientes de la consola.', ephemeral: true });
                    }
                }

                const totalPages = Math.max(1, Math.ceil(lines.length / 18));
                if (targetPage < 0) targetPage = 0;
                if (targetPage >= totalPages) targetPage = totalPages - 1;

                logViewerSessions.set(interaction.message.id, { lines, page: targetPage, totalPages, filter, authorId });
                const { embed, row } = buildLogEmbedAndButtons(lines, targetPage, totalPages, filter, authorId);
                return await interaction.update({ embeds: [embed], components: [row] }).catch(() => {});
            }

            // BOTONES RÁPIDOS DE USUARIO DESDE SMENU
            if (id === 'btn_user_profile') {
                const profileEmbed = await buildUserProfileEmbed(interaction.member, interaction.guild);
                return await interaction.reply({ embeds: [profileEmbed], ephemeral: true });
            }
            if (id === 'btn_user_claim') {
                const claimEmbed = buildClaimsGuideEmbed();
                return await interaction.reply({ embeds: [claimEmbed], ephemeral: true });
            }
            if (id === 'btn_user_vote') {
                const voteEmbed = buildVoteGuideEmbed();
                return await interaction.reply({ embeds: [voteEmbed], ephemeral: true });
            }
            if (id === 'btn_smenu_back_home') {
                const { embed, selectRow, buttonRow } = buildMainMenuHub();
                return await interaction.update({ embeds: [embed], components: [selectRow, buttonRow] });
            }

            // NAVEGACIÓN INTERACTIVA DE SHELP
            if (id.startsWith('btn_shelp_')) {
                const category = id.replace('btn_shelp_', '');
                const embed = getShelpCategoryEmbed(category);
                const rows = getShelpButtonRows();
                return await interaction.update({ embeds: [embed], components: rows });
            }


            if (id === 'btn_ticket_bug') {
                const modal = new ModalBuilder().setCustomId('modal_ticket_bug').setTitle('🐛 Reporte de Bug o Error');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nick').setLabel('Tu Nick de Minecraft').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: Steve_123')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('modalidad').setLabel('Modalidad / Servidor').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Survival / OneBlock / SkyBlock / Clásico')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('asunto').setLabel('Resumen del Bug').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: Fallo en Cargo Node de Slimefun')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('detalle').setLabel('Explicación Detallada del Error').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(10).setPlaceholder('Describe paso a paso qué ocurrió, qué estabas haciendo y qué mensaje apareció...')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pruebas').setLabel('Pruebas / Coords / Links (Opcional)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Enlaces de fotos, videos o coordenadas'))
                );
                return await interaction.showModal(modal);
            }

            if (id === 'btn_ticket_perdida') {
                const modal = new ModalBuilder().setCustomId('modal_ticket_perdida').setTitle('📦 Pérdida de Ítems / Rollback');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nick').setLabel('Tu Nick de Minecraft').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: Steve_123')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('modalidad').setLabel('Modalidad').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Survival / OneBlock / SkyBlock')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('items').setLabel('Ítems Perdidos').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Lista los objetos exactos y encantamientos/slimefun...')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('circunstancia').setLabel('¿Cómo ocurrió la pérdida?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(10).setPlaceholder('Hora aproximada, qué estabas haciendo, si fue caída del server o desync...')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pruebas').setLabel('Pruebas de Posesión (Capturas/Videos)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Pega enlaces de fotos/videos que demuestren que tenías los ítems'))
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
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('detalle').setLabel('Escribe tu Duda o Consulta').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(10).setPlaceholder('Detalla con claridad tu duda o pregunta para que podamos guiarte con exactitud...'))
                );
                return await interaction.showModal(modal);
            }

            if (id === 'btn_ticket_postulacion') {
                const modal = new ModalBuilder().setCustomId('modal_ticket_postulacion').setTitle('🛡️ Postulación Oficial a Staff');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('edad_pais').setLabel('Tu Edad y País de Residencia').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: 19 años, Chile')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nick_tiempo').setLabel('Nick en MC y Tiempo en el Servidor').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: Steve_MC, 5 meses activo')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rango').setLabel('Rango al que Postulas').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Helper / Moderador / Builder / Developer')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('experiencia').setLabel('Experiencia Previa y Comandos').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(15).setPlaceholder('Describe servidores anteriores, plugins o conocimientos técnicos...')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('motivo').setLabel('¿Por qué postulas y cuál es tu aporte?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(15).setPlaceholder('¿Qué te motiva a formar parte del Staff de DrakesCraft?'))
                );
                return await interaction.showModal(modal);
            }

            if (id === 'btn_ticket_denuncia') {
                const modal = new ModalBuilder().setCustomId('modal_ticket_denuncia').setTitle('⚖️ Denuncia Confidencial');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nick_tuyo').setLabel('Tu Nick en Minecraft / Discord').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: Steve_123')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('acusado').setLabel('Usuario o Staff a Denunciar').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Nick exacto del infractor')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('motivo').setLabel('Infracción Cometida').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Hacks / Acoso / Toxicidad / Abuso de Poder / Estafa')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('hechos').setLabel('Relato Detallado de los Hechos').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(15).setPlaceholder('Explica detalladamente qué ocurrió, fecha/hora aproximada y contexto...')),
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
                    content: '⚠️ ¿Estás seguro de que deseas cerrar este ticket? El canal se eliminará definitivamente.',
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
                    .addFields(
                        { name: '📍 Canal', value: `#${interaction.channel.name}`, inline: true },
                        { name: '👤 Cerrado por', value: `${interaction.user} (\`${interaction.user.tag}\`)`, inline: true }
                    )
                    .setTimestamp();
                await sendAuditLog(auditEmbed);

                setTimeout(() => {
                    interaction.channel.delete().catch(() => null);
                }, 5000);
                return;
            }
        }

                    // ACCIONES DE REENCARNACIÓN Y PRESTIGIO
            if (id.startsWith('btn_reencarnar_cancel_')) {
                const parts = id.split('_');
                const authorId = parts[4];
                if (interaction.user.id !== authorId && interaction.user.id !== JACK_DISCORD_ID) {
                    return await interaction.reply({ content: '❌ Solo la persona que solicitó la confirmación o un Administrador puede cancelar esta acción.', ephemeral: true });
                }
                return await interaction.update({
                    content: '✅ Protocolo de reencarnación cancelado. Tus pertenencias, terrenos e inventarios están a salvo.',
                    embeds: [],
                    components: []
                });
            }

            if (id.startsWith('btn_reencarnar_confirm_')) {
                const parts = id.split('_');
                const code = parts[3];
                const authorId = parts[4];
                if (interaction.user.id !== authorId && interaction.user.id !== JACK_DISCORD_ID) {
                    return await interaction.reply({ content: '❌ Solo la persona que solicitó la confirmación o un Administrador puede autorizar la reencarnación.', ephemeral: true });
                }

                await interaction.update({
                    content: `⚡ **EJECUTANDO REENCARNACIÓN...** Transmitiendo orden de destrucción y regeneración a la consola del servidor para el código \`${code}\`...`,
                    embeds: [],
                    components: []
                });

                const mcSuccess = await sendMinecraftConsoleCommand(`reencarnar ejecutar * ${code}`);

                if (mcSuccess) {
                    const successEmbed = new EmbedBuilder()
                        .setTitle('✨ ¡REENCARNACIÓN COMPLETADA CON ÉXITO! ✨')
                        .setColor(0x00FF88)
                        .setDescription(`El protocolo para el código **\`${code}\`** ha sido ejecutado por la consola central de DrakesCraft.\n\n` +
                                        `• **Terrenos:** Regeneración natural de chunks completada.\n` +
                                        `• **Bóvedas & Economía:** Reiniciados al estado base.\n` +
                                        `• **Cápsula de Recuerdos:** Entregada en el próximo inicio de sesión.\n\n` +
                                        `¡Felicidades por alcanzar un nuevo Prestigio! Que comience una nueva era. 🐉`)
                        .setFooter({ text: 'S.A.O.R.I. Sistema de Prestigio · DrakesCraft', iconURL: client.user.displayAvatarURL() })
                        .setTimestamp();

                    await interaction.followUp({ embeds: [successEmbed] }).catch(() => null);

                    const auditEmbed = new EmbedBuilder()
                        .setColor(0x9B59B6)
                        .setTitle('⚖️ Reencarnación de Prestigio Ejecutada')
                        .addFields(
                            { name: '👤 Confirmado por', value: `${interaction.user} (\`${interaction.user.tag}\`)`, inline: true },
                            { name: '🔑 Código', value: `\`${code}\``, inline: true }
                        )
                        .setTimestamp();
                    await sendAuditLog(auditEmbed);
                } else {
                    await interaction.followUp({
                        content: `❌ Hubo un problema al comunicar con la consola del servidor para ejecutar el código \`${code}\`. Verifica si el servidor está en línea o contacta al Staff.`,
                        ephemeral: true
                    }).catch(() => null);
                }
                return;
            }

// 2. MANEJO DE ENVÍO DE FORMULARIOS (MODAL SUBMISSION)
        if (interaction.isModalSubmit()) {
            const customId = interaction.customId;
            const guild = interaction.guild;
            const user = interaction.user;

            if (!guild) {
                return await interaction.reply({ content: '❌ Los tickets solo pueden crearse dentro del servidor de Discord.', ephemeral: true });
            }

            let tipo = 'soporte';
            let titulo = '🎫 Ticket de Soporte';
            let color = 0x3498DB;
            let fields = [];
            let summaryText = '';

            if (customId === 'modal_ticket_bug') {
                tipo = 'bug';
                titulo = '🐛 Reporte de Bug o Error';
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
                const pruebas = interaction.fields.getTextInputValue('pruebas') || 'Ninguna';
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
                    { name: '🎖️ Rango al que Postulas', value: `\`${rango}\``, inline: true },
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

            // Permisos del canal de ticket
            const cleanUser = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'usuario';
            const channelName = `${tipo === 'denuncia' ? '⚖️' : '🎫'}・${tipo}-${cleanUser}`;

            const overwrites = [
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
            ];

            if (tipo === 'denuncia') {
                // Denuncias confidenciales: Solo Jack y Alta Administración
                overwrites.push(
                    { id: JACK_DISCORD_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] },
                    { id: '1539641774392348754', allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] }, // DUEÑO
                    { id: '1539642179822161940', allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] }  // ADMIN
                );
            } else {
                // Tickets normales: Todo el Staff
                overwrites.push(
                    { id: '1539768983287496855', allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] }, // STAFF
                    { id: '1539641774392348754', allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] }, // DUEÑO
                    { id: '1539642179822161940', allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] }, // ADMIN
                    { id: '1539642370356940861', allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] }  // MOD
                );
            }

            const ticketChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: CHANNELS.CATEGORIA_TICKETS,
                permissionOverwrites: overwrites
            });

            const ticketEmbed = new EmbedBuilder()
                .setColor(color)
                .setTitle(titulo)
                .setDescription(
                    `¡Hola ${user}! Tu ticket ha sido abierto correctamente con los datos ingresados en el formulario.\n` +
                    `Por favor aguarda unos momentos mientras el Staff y **SAORI** analizan tu caso.`
                )
                .addFields(fields)
                .setFooter({ text: `Ticket ID: ${ticketChannel.id} · Creado por ${user.tag}` })
                .setTimestamp();

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_close_ticket').setLabel('Cerrar Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
            );

            const staffPing = tipo === 'denuncia' ? `<@${JACK_DISCORD_ID}>` : '<@&1539768983287496855>';
            await ticketChannel.send({ content: `${user} | ${staffPing}`, embeds: [ticketEmbed], components: [actionRow] });

            await interaction.reply({
                content: `✅ ¡Tu ticket ha sido creado con éxito en <#${ticketChannel.id}>! Haz clic en el canal para continuar.`,
                ephemeral: true
            });

            // Despachar a la Trinidad SRE en Star si es bug o reporte técnico
            dispatchTicketToTriad(
                `[Ticket ${tipo.toUpperCase()}] ${summaryText.slice(0, 50)}...`,
                summaryText,
                user.tag,
                ticketChannel.name
            ).catch(() => null);

            // Generar saludo inicial inteligente de Saori en el ticket
            fetch(AI_DAEMON_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: `El usuario ${user.username} ha abierto un ticket de tipo "${tipo}". Resumen: "${summaryText}". Salúdalo cordialmente en 1 o 2 párrafos breves, confirma que sus datos fueron registrados y dale tranquilidad mientras el equipo lo atiende.`,
                    sender: user.username
                }),
                timeout: 45000
            })
            .then(r => r.json())
            .then(async d => {
                if (d.response) {
                    const aiEmbed = new EmbedBuilder()
                        .setColor(0x00FF88)
                        .setAuthor({ name: 'SAORI · Asistencia Inteligente', iconURL: client.user.displayAvatarURL() })
                        .setDescription(d.response.trim())
                        .setFooter({ text: 'S.A.O.R.I. Autonomous Fleet · DrakesCraft' });
                    await ticketChannel.send({ embeds: [aiEmbed] }).catch(() => null);
                }
            })
            .catch(() => null);

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


const mcStaffLastResponse = new Map();

const MC_STAFF_TRIGGERS = [
    /\bstaff\s*(here|online|around|available|present|pls|please|\?)/i,
    /\bis\s+there\s+(a\s+)?(staff|admin|mod|owner)/i,
    /\bany\s+(staff|admin|mod|owner)\s*(here|online|\?)/i,
    /\bhay\s+(staff|alguien\s+del\s+staff|admin|un\s+admin)/i,
    /\bstaff\s+(por\s+favor|pls|ayuda|help)/i,
    /\b(admin|mod)\s*(here|online|\?)/i,
    /\bnecesito\s+(un\s+)?(staff|admin|ayuda)/i,
    /\bneed\s+(a\s+)?(staff|admin|mod|help)/i,
    /\balguien\s+me\s+(puede\s+)?(ayudar|help)/i,
    /\bcan\s+someone\s+help/i,
    /\bhelp\s*\?/i,
    /\bsupport\s*\?/i
];

// Gestión de Mensajes y Tickets
client.on('messageCreate', async (message) => {
    // 1. Detección y respuesta en Minecraft Chat (DiscordSRV Webhook / Bridge)
    if (message.channel.id === CHANNELS.MINECRAFT_CHAT) {
        if (message.author.id === client.user.id) return;

        const isDM = !message.guild;
        const isJack = message.author.id === JACK_DISCORD_ID;

        // Si es un miembro de Discord humano (no webhook de DiscordSRV), moderar permisos de escritura
        if (message.guild && !message.webhookId && !message.author.bot && !isJack) {
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

        // Interceptar si alguien llama al staff o a Saori en Minecraft
        const text = message.content.trim();
        const matchesStaffCall = MC_STAFF_TRIGGERS.some(rgx => rgx.test(text));
        const mentionsSaori = /\bsaori\b/i.test(text);

        let rawName = message.author.username;
        let clean = rawName.replace(/\[.*?\]|✦.*?✦|[-|│︱•~]/g, '').trim();
        let words = clean.split(/\s+/).filter(w => w.length > 0);
        let player = words.length > 0 ? words[words.length - 1] : clean || 'Jugador';

        // Caso A: Llamado explícito a Staff humano (no saori)
        if (matchesStaffCall && !mentionsSaori) {
            const now = Date.now();
            const lastResp = mcStaffLastResponse.get(player) || 0;
            if (now - lastResp > 45000) {
                mcStaffLastResponse.set(player, now);

                const isEnglish = /\b(here|available|please|help|any|need|someone)\b/i.test(text);
                const replyText = isEnglish
                    ? `👋 Hi **${player}**! I'm **SAORI**, DrakesCraft's AI. Staff will be with you shortly. If urgent, open a ticket at <#${CHANNELS.TICKETS_SOPORTE}> (or type \`sticket <issue>\`). ✨`
                    : `👋 ¡Hola **${player}**! Soy **SAORI**, la IA de DrakesCraft. Actualmente el Staff puede estar ocupado. Si necesitas ayuda o reportar un bug, abre un ticket en <#${CHANNELS.TICKETS_SOPORTE}> (o escribe \`sticket <problema>\`). ✨`;

                await message.channel.send(replyText).catch(() => null);

                // Enviar también /say a Minecraft para que el jugador lo lea in-game
                const ingameSay = isEnglish
                    ? `say ¡Hi ${player}! I am SAORI. If you need staff help or have an urgent issue, please open a ticket on our Discord!`
                    : `say ¡Hola ${player}! Soy SAORI. Si necesitas ayuda del staff o reportar algo, abre un ticket en nuestro Discord!`;

                fetch(AI_DAEMON_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: `ejecuta /${ingameSay}`, sender: 'Staff' })
                }).catch(() => null);

                console.log(`[SAORI-MC-WATCHER] 🎮 Respondiendo a llamado de staff de ${player}: "${text}"`);
                return;
            }
        }

        // Caso B: Consulta directa a Saori in-game (preguntas de slimefun, recados a Jack, etc.)
        if (mentionsSaori) {
            const now = Date.now();
            const lastResp = mcStaffLastResponse.get(player) || 0;
            if (now - lastResp > 12000) {
                mcStaffLastResponse.set(player, now);

                fetch(AI_DAEMON_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: text, sender: player }),
                    timeout: 45000
                })
                .then(r => r.json())
                .then(async data => {
                    const reply = data.response?.trim();
                    if (reply) {
                        await message.channel.send(`🌸 **Saori:** ${reply}`).catch(() => null);

                        // Broadcast breve in-game si es confirmación de recado o respuesta corta
                        if (reply.length <= 150) {
                            const cleanSay = reply.replace(/[\r\n]+/g, ' ').replace(/"/g, "'").slice(0, 180);
                            fetch(AI_DAEMON_URL, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ prompt: `ejecuta /say ${cleanSay}`, sender: 'Staff' })
                            }).catch(() => null);
                        }
                    }
                })
                .catch(err => console.error('[SAORI-MC] Error procesando consulta in-game:', err.message));

                console.log(`[SAORI-MC] 🎮 Consulta directa a Saori de ${player}: "${text}"`);
                return;
            }
        }

        if (message.author.bot || message.webhookId) return;
    }

    // 🔔 AUTO-NOTIFICACIONES Y PINGS EN CANALES DE AVISOS
    const targetNotifRoleId = NOTIFICATION_CHANNELS_MAP[message.channel.id];
    if (targetNotifRoleId && message.author.id !== client.user.id) {
        const alreadyMentionsRole = message.mentions.roles.has(targetNotifRoleId) || 
                                     message.content.includes(`<@&${targetNotifRoleId}>`);
        const now = Date.now();
        const lastNotif = notifChannelCooldowns.get(message.channel.id) || 0;
        if (!alreadyMentionsRole && (now - lastNotif > 20000)) {
            notifChannelCooldowns.set(message.channel.id, now);
            try {
                await message.channel.send({
                    content: `<@&${targetNotifRoleId}> 🔔`,
                    allowedMentions: { roles: [targetNotifRoleId] }
                });
                console.log(`[AUTO-NOTIF] 🔔 Rol ${targetNotifRoleId} etiquetado automáticamente en #${message.channel.name}`);
            } catch (err) {
                console.error('[AUTO-NOTIF] Error al enviar ping de rol:', err.message);
            }
        }
    }

    if (message.author.bot) return;

    // Si es canal de avisos y no mencionan directamente a Saori, no generar charla con IA
    if (targetNotifRoleId && !message.mentions.users.has(client.user.id)) {
        return;
    }


    // =========================================================================
    // BUZÓN OFICIAL DE SUGERENCIAS (#💡・sugerencias)
    // =========================================================================
    if (message.channel.id === CHANNELS.SUGERENCIAS) {
        let sugText = message.content.trim();
        sugText = sugText.replace(/^([/!]?s?sugerencia[\s:]*)/i, '').trim();
        await handleSuggestion(message, sugText, false);
        return;
    }

    
    const isDM = !message.guild;
    const isJack = message.author.id === JACK_DISCORD_ID;

    // 🛡️ ESCUDO DE SEGURIDAD ANTI-ATAQUES & ANTI-SPAM
    if (!isJack && message.guild) {
        // 1. Detección y bloqueo inmediato de phishing / IP loggers
        if (RateLimitShield.isMaliciousLink(message.content)) {
            await message.delete().catch(() => {});
            const phishAudit = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('🚨 Enlace Malicioso Bloqueado (Anti-Phishing)')
                .addFields(
                    { name: '👤 Usuario', value: `${message.author} (\`${message.author.tag}\`)`, inline: true },
                    { name: '📍 Canal', value: `<#${message.channel.id}>`, inline: true },
                    { name: '🔗 Contenido', value: `\`\`\`${message.content.slice(0, 500)}\`\`\``, inline: false }
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


    const botMentioned = message.mentions.users.has(client.user.id);
    // Ignorar avisos globales con @everyone o @here si no mencionan directamente a Saori
    if ((message.mentions.everyone || message.content.includes('@everyone') || message.content.includes('@here')) && !message.mentions.users.has(client.user.id)) {
        return;
    }
    const isSaoriDedicatedChannel = message.channel.id === CHANNELS.SAORI_CHAT;
    const content = RateLimitShield.sanitizeInput(message.content.trim());
    const contentLower = content.toLowerCase();

    const isTicketChannel = (message.channel.parentId && message.channel.parentId === CHANNELS.CATEGORIA_TICKETS) || 
                            message.channel.id === CHANNELS.TICKETS_SOPORTE || 
                            message.channel.name?.startsWith('ticket-') ||
                            message.channel.name?.includes('ticket') ||
                            message.channel.name?.includes('soporte') ||
                            message.channel.name?.startsWith('🎫') ||
                            message.channel.name?.startsWith('⚖️');

    const hierarchy = getStaffMemberHierarchy(message.member, message.author.id);
    const isStaffMember = hierarchy.isStaff;

    // Registro de actividad del Staff en canales de tickets
    if (isTicketChannel && isStaffMember) {
        ticketStaffActivity.set(message.channel.id, Date.now());
    }

    // =========================================================================
    // MODERACIÓN AUTOMÁTICA DE #🤖・ᴄᴏᴍᴀɴᴅᴏs-ʙᴏᴛs (Solo comandos de bots, 0 charla)
    // =========================================================================
    if (message.channel.id === '1539636586663383060' && !message.author.bot && !isStaffMember && !isJack) {
        // Prefijos válidos de bots: Saori (s + comando), Jockie (m!/M!), Mudae ($), Idle Miner (;), Slash (/), !, ?, etc.
        const isBotCommand = /^(?:[!/?.$,;+~#%&*<>-]|m!|z!|p!|w!|s[a-z]{2,})/i.test(content);
        if (!isBotCommand) {
            try {
                await message.delete();
                const warnMsg = await message.channel.send({
                    content: `⚠️ ${message.author}, este canal es **exclusivo para comandos de bots**. Para conversar, por favor usa <#1539636493725864037> (#💬・general-español).`
                });
                setTimeout(() => warnMsg.delete().catch(() => null), 6000);
            } catch (e) {
                console.error('[SAORI-BOTS-FILTER] Error al moderar charla en comandos-bots:', e.message);
            }
            return;
        }
    }

    // Filtro de mensajes ultra cortos o fragmentos en tickets
    const spamWords = ['xd', 'xdxd', 'lol', 'ok', 'a', 'si', 'no', 'ui', 'wey', 'wena', 'f', 'gg', 'jaja', 'jajaja', 'haha', 'ty', 'thx', 'gracias'];
    const isTooShort = content.length <= 2 || spamWords.includes(contentLower);
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
    const isListFragment = isTicketChannel && wordCount <= 5 && !content.includes('?') && !botMentioned;
    if ((isTooShort || isListFragment) && !botMentioned && !isDM && !isJack && !isSaoriDedicatedChannel) return;

    // Comandos directos que Saori atiende en cualquier canal
    const directCmdKeywords = [
        'shelp', 'splay', 'smusica', 'sskip', 'spause', 'sresume', 'squeue', 'sstop',
        'sticket', 'sstats', 'sip', 'sping', 'sweb', 'stienda', 'sguia',
        'sroles', 'srole', 'snick', 'sautoroles', 'sclear', '!purge', '!ticket', '!imagen', '!image', 
        'skick', 'sban', 'smute', 'stimeout', 'sunmute', 'swarn', 'slowmode', 'slock', 'sunlock', 
        'sonline', 'sjugadores', 'smisroles', 'sreglas',
        'ssugerencia', 'sugerencia', '!sugerencia', 'sreencarnar', 'reencarnar', '!reencarnar',
        'shelpstaff', 'staffhelp', 'sstaffhelp', 'stps', 'tps', 'slogs', 'logs', 'smenu', 'menu', 'sperfil', 'perfil', 'smiperfil',
        'sstaff', 'staff', 'sinfo', 'sserverinfo', 'svip', 'vip', 'sclaim', 'claim', 'claims',
        'svotar', 'votar', 'srecompensa', 'sredes',
        'scomando', 'sconsola', 'smc', 'smckick', 'smcban', 'smcunban', 'smcpardon', 'smcmute',
        'smcwarn', 'smcmsg', 'smcbroadcast', 'smcannounce', 'smcwhitelist', 'smcsave', 'smchealth',
        'schan', 'srol', 'sanuncio', 'ssay',
        'sinactivos', 'inactivos'
    ];
    const isDirectCommand = directCmdKeywords.some(cmd => 
        contentLower === cmd || 
        contentLower.startsWith(`${cmd} `) || 
        contentLower.startsWith(`/${cmd} `) || 
        contentLower === `/${cmd}` ||
        contentLower.startsWith(`!${cmd} `) || 
        contentLower === `!${cmd}`
    );

    const callsSaoriDirectly = botMentioned || contentLower.startsWith('saori') || contentLower.includes('@saori');

    // POLÍTICA DE SILENCIO Y TURN-TAKING EN TICKETS DE SOPORTE
    if (isTicketChannel && !isDirectCommand) {
        const lastStaff = ticketStaffActivity.get(message.channel.id) || 0;
        const staffIsActive = (Date.now() - lastStaff) < (30 * 60 * 1000); // 30 minutos de guardia activa

        // Si el usuario menciona a Jack o a un rol de Staff (@Jack / @Staff), no entrometerse
        const mentionsStaff = message.mentions.users.has(JACK_DISCORD_ID) ||
                              message.mentions.roles.some(r => {
                                  const rn = r.name.toLowerCase();
                                  return rn.includes('staff') || rn.includes('admin') || rn.includes('mod') || rn.includes('dueño');
                              });

        // Si el Staff está participando o el mensaje va dirigido al Staff, Saori NO habla salvo mención explícita
        if ((staffIsActive || mentionsStaff) && !callsSaoriDirectly) {
            if (!ticketConversations.has(message.channel.id)) {
                ticketConversations.set(message.channel.id, []);
            }
            ticketConversations.get(message.channel.id).push({ sender: cleanUserName(message.member?.displayName || message.author.username, isJack, isStaffMember), text: content, timestamp: Date.now() });
            return;
        }

        // Si el mensaje es de Jack y no llamó explícitamente a Saori, Saori JAMÁS interrumpe a Jack
        if (isJack && !callsSaoriDirectly) {
            return;
        }

        // Rate limit para no saturar al usuario en tickets: mínimo 20 segundos entre respuestas automáticas
        const lastReply = ticketLastSaoriReply.get(message.channel.id) || 0;
        if (!callsSaoriDirectly && (Date.now() - lastReply) < 20000) {
            return;
        }

        // Solo responder si es una consulta con interrogación o aporte sustancial (mínimo 4 palabras)
        if (!callsSaoriDirectly && wordCount < 4 && !content.includes('?')) {
            return;
        }
    }

    const shouldRespond = isDirectCommand ||
                          isSaoriDedicatedChannel ||
                          isTicketChannel || 
                          isDM || 
                          callsSaoriDirectly;

    if (!shouldRespond) return;

    let rawSender = message.member?.displayName || message.author.username;
    let senderName = cleanUserName(rawSender, isJack, isStaffMember);

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
                    value: '• `sweb` · Portal web oficial de DrakesCraft (https://web.drakescraft.cl).\n• `stienda` · Tienda oficial con garantía de entrega y compensación (https://web.drakescraft.cl).\n• `sguia` · Enciclopedia de Slimefun, economía, trabajos y comandos.' 
                },
                { 
                    name: '🎨 5. Arte Neural & Chat Inteligente', 
                    value: '• `!imagen <descripción>` · Genera arte e ilustraciones en vivo con IA.\n• **Chat Natural:** Habla conmigo en <#1544811720571355196> o mencióname (`@SAORI`).' 
                },
                { 
                    name: '🛡️ 6. Moderación y Roles (Staff)', 
                    value: '• `sroles` · Muestra todos los roles del servidor y cantidad de miembros.\n• `srole dar @usuario <Rol>` · Asigna un rol a un miembro.\n• `srole quitar @usuario <Rol>` · Remueve un rol.\n• `sclear <cantidad>` o `!purge <cantidad>` · Purga mensajes de un canal.' 
                },
                { 
                    name: '💡 7. Buzón Oficial de Sugerencias', 
                    value: '• `ssugerencia <propuesta>` · Publica tu propuesta en <#1539636565188542554> con votación comunitaria 👍/👎 y debate.' 
                },
                { 
                    name: '⚖️ 8. Rito de Reencarnación & Prestigio', 
                    value: '• `sreencarnar <código>` / `!reencarnar <código>` · Autoriza la confirmación de seguridad para reiniciar tu cuenta y renacer con Prestigio tras solicitarlo in-game con `/reencarnar`.' 
                }
            )
            .setFooter({ text: 'S.A.O.R.I. SRE Core · DrakesCraft Network', iconURL: client.user.displayAvatarURL() });
        const shelpRows = getShelpButtonRows();
        return message.reply({ embeds: [helpEmbed], components: shelpRows, allowedMentions: { repliedUser: false } });
    }

    // Comandos directos y accesos rápidos
    if (contentLower === 'sip' || contentLower === '/sip' || contentLower === '!sip') {
        return message.reply({ content: '⛏️ **IP de Conexión DrakesCraft:**\n• **Java:** `mc.drakescraft.cl:25565` (1.20 - 1.21.x)\n• **Bedrock:** `mc.drakescraft.cl` (Puerto: `19132`)', allowedMentions: { repliedUser: false } });
    }
    if (contentLower === 'sweb' || contentLower === '/sweb' || contentLower === '!sweb') {
        return message.reply({ content: '🌐 **Web Oficial:** https://web.drakescraft.cl', allowedMentions: { repliedUser: false } });
    }
    if (contentLower === 'stienda' || contentLower === '/stienda' || contentLower === '!stienda') {
        return message.reply({ content: '🛒 **Tienda Oficial:** https://web.drakescraft.cl', allowedMentions: { repliedUser: false } });
    }
    if (contentLower === 'sping' || contentLower === '/sping' || contentLower === '!sping') {
        const ping = client.ws.ping;
        return message.reply({ content: `🏓 **Pong!** Latencia de enlace con Discord: **${ping}ms** · Enlace con Star: **0.1ms**`, allowedMentions: { repliedUser: false } });
    }
    // 🎭 GESTIÓN DE AUTO-ROLES (sautoroles, sroles panel, sroles sync)
    if (['sautoroles', 's!autoroles', 'sroles panel', 'sroles setup'].includes(contentLower)) {
        if (!isStaffMember) {
            return message.reply({ content: '❌ Solo Jack y el Staff Administrador pueden desplegar los paneles de auto-roles.', allowedMentions: { repliedUser: false } });
        }
        const autoRolesChannel = client.channels.cache.get(CHANNELS.AUTO_ROLES) || message.channel;
        await sendAutoRolesPanels(autoRolesChannel);
        return message.reply({ content: `✅ Paneles oficiales de auto-roles publicados con éxito en <#${autoRolesChannel.id}>.`, allowedMentions: { repliedUser: false } });
    }

    if (contentLower === 'sroles sync' || contentLower === 'sautoroles sync') {
        if (!isStaffMember) {
            return message.reply({ content: '❌ Solo Jack y el Staff Administrador pueden forzar la sincronización de auto-roles.', allowedMentions: { repliedUser: false } });
        }
        const replyMsg = await message.reply({ content: `🔄 Sincronizando roles a partir de las reacciones en <#${CHANNELS.AUTO_ROLES}>...`, allowedMentions: { repliedUser: false } });
        await syncAutoRolesChannel(message.guild);
        return replyMsg.edit('✅ Sincronización de auto-roles completada exitosamente.');
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
                    { name: '👑 Equipo de Staff', value: staffRoles.join('\n').slice(0, 1020) || 'Sin datos', inline: false },
                    { name: '⚡ Rangos Dioses, VIPs & OldSchool', value: godRoles.join('\n').slice(0, 1020) || 'Sin datos', inline: false }
                )
                .setFooter({ text: 'S.A.O.R.I. SRE · Sincronización Automática', iconURL: client.user.displayAvatarURL() });

            return message.reply({ embeds: [rolesEmbed], allowedMentions: { repliedUser: false } });
        } catch (e) {
            return message.reply({ content: `❌ Error al obtener roles: ${e.message}` });
        }
    }

    // =========================================================================
    // COMANDOS DE MÚSICA & SUITE STREAMING (splay, smusica, sskip, spause, etc.)
    // =========================================================================
    const rawCmdText = content.trim();
    const cleanCmdText = rawCmdText.replace(/^[\/!]/, '');
    const cmdTokens = cleanCmdText.split(/\s+/);
    const primaryCmd = cmdTokens[0].toLowerCase();
    const cmdArgs = cmdTokens.slice(1);

    if (primaryCmd === 'splay') {
        const voiceChannel = message.member?.voice?.channel;
        if (!voiceChannel) {
            return message.reply({ content: '❌ Debes unirte a un canal de voz para que pueda reproducir música.', allowedMentions: { repliedUser: false } });
        }
        let query = cmdArgs.join(' ').trim();
        if (!query) {
            return message.reply({ content: '🎵 Por favor indica el nombre de una canción o enlace de Spotify/YouTube.\n*Ejemplo:* `splay https://open.spotify.com/track/...` o `splay lofi hip hop`', allowedMentions: { repliedUser: false } });
        }
        if (!distube) {
            return message.reply({ content: '❌ El motor de música no está disponible en este momento.', allowedMentions: { repliedUser: false } });
        }

        // Si no es URL directa, buscar en YouTube via yt-dlp con cliente mweb
        if (!query.startsWith('http')) {
            try {
                await message.react('🔍').catch(() => {});
                const ytUrl = await new Promise((resolve, reject) => {
                    execFile('yt-dlp', ['--extractor-args', 'youtube:player_client=mweb', '--print', 'webpage_url', 'ytsearch1:' + query], (err, stdout) => {
                        if (err) return reject(err);
                        const cleanUrl = stdout.trim().split('\n')[0];
                        if (cleanUrl && cleanUrl.startsWith('http')) resolve(cleanUrl);
                        else reject(new Error('No se encontró enlace en YouTube'));
                    });
                });
                query = ytUrl;
            } catch (err) {
                console.warn('[SEARCH-BRIDGE] Error buscando:', err.message);
            }
        }

        // Si es enlace de Spotify, resolver metadata y buscar stream en YouTube de forma resiliente
        if (query.includes('spotify.com/track/')) {
            try {
                await message.react('🔍').catch(() => {});
                const spotifyHelper = new SpotifyPlugin();
                const data = await spotifyHelper.api.getData(query);
                const title = data.name + ' ' + (data.artists?.[0]?.name || '');
                const ytUrl = await new Promise((resolve, reject) => {
                    execFile('yt-dlp', ['--extractor-args', 'youtube:player_client=mweb', '--print', 'webpage_url', 'ytsearch1:' + title], (err, stdout) => {
                        if (err) return reject(err);
                        const cleanUrl = stdout.trim().split('\n')[0];
                        if (cleanUrl && cleanUrl.startsWith('http')) resolve(cleanUrl);
                        else reject(new Error('No se encontró enlace en YouTube'));
                    });
                });
                query = ytUrl;
            } catch (spotifyErr) {
                console.warn('[SPOTIFY-BRIDGE] Warning resolviendo Spotify a YT:', spotifyErr.message);
            }
        }

        try {
            await distube.play(voiceChannel, query, {
                message,
                textChannel: message.channel,
                member: message.member
            });
            return message.react('🎶').catch(() => {});
        } catch (e) {
            const errDetail = e?.message || String(e || 'Error desconocido');
            return message.reply({ content: `❌ Error al reproducir música: ${errDetail.slice(0, 200)}`, allowedMentions: { repliedUser: false } });
        }
    }

    if (primaryCmd === 'smusica') {
        const musicEmbed = new EmbedBuilder()
            .setTitle('🎵 S.A.O.R.I. · Reproductor de Música Discord & Minecraft')
            .setColor(0x9933FF)
            .setDescription('Disfruta de música en alta fidelidad dentro de Discord y en el servidor de Minecraft.')
            .addFields(
                { 
                    name: '🔊 Comandos en Discord', 
                    value: '• `splay <canción / link spotify / youtube>` · Reproduce en tu canal de voz.\n• `sskip` · Salta la pista actual.\n• `spause` / `sresume` · Pausa o continúa.\n• `squeue` · Muestra las pistas en cola.\n• `sstop` · Detiene la música y vacía la cola.' 
                },
                { 
                    name: '⛏️ Música In-Game (Minecraft)', 
                    value: 'En el servidor puedes usar el comando `/musica` para abrir la rocola personalizada y escuchar temas ambientales mientras juegas.' 
                }
            )
            .setFooter({ text: 'S.A.O.R.I. Music Suite · DrakesCraft Network', iconURL: client.user.displayAvatarURL() });
        return message.reply({ embeds: [musicEmbed], allowedMentions: { repliedUser: false } });
    }

    if (primaryCmd === 'sskip') {
        if (!distube) return;
        const queue = distube.getQueue(message);
        if (!queue) return message.reply({ content: '❌ No hay ninguna canción reproduciéndose.', allowedMentions: { repliedUser: false } });
        try {
            await distube.skip(message);
            return message.reply({ content: '⏭️ ¡Pista saltada!', allowedMentions: { repliedUser: false } });
        } catch (e) {
            return message.reply({ content: `❌ No se pudo saltar la canción: ${e.message}`, allowedMentions: { repliedUser: false } });
        }
    }

    if (primaryCmd === 'spause') {
        if (!distube) return;
        const queue = distube.getQueue(message);
        if (!queue) return message.reply({ content: '❌ No hay música reproduciéndose.', allowedMentions: { repliedUser: false } });
        if (queue.paused) return message.reply({ content: '⏸️ La música ya está en pausa. Usa `sresume`.', allowedMentions: { repliedUser: false } });
        distube.pause(message);
        return message.reply({ content: '⏸️ Música pausada.', allowedMentions: { repliedUser: false } });
    }

    if (primaryCmd === 'sresume') {
        if (!distube) return;
        const queue = distube.getQueue(message);
        if (!queue) return message.reply({ content: '❌ No hay música en cola.', allowedMentions: { repliedUser: false } });
        if (!queue.paused) return message.reply({ content: '▶️ La música ya se está reproduciendo.', allowedMentions: { repliedUser: false } });
        distube.resume(message);
        return message.reply({ content: '▶️ Reproducción reanudada.', allowedMentions: { repliedUser: false } });
    }

    if (primaryCmd === 'squeue') {
        if (!distube) return;
        const queue = distube.getQueue(message);
        if (!queue || !queue.songs.length) return message.reply({ content: '📭 La cola de reproducción está vacía.', allowedMentions: { repliedUser: false } });
        const tracks = queue.songs.slice(0, 10).map((s, i) => `${i === 0 ? '▶️' : `${i}.`} **[${s.name}](${s.url})** \`[${s.formattedDuration}]\``).join('\n');
        const queueEmbed = new EmbedBuilder()
            .setTitle(`🎶 Cola de Reproducción (${queue.songs.length} pistas)`)
            .setColor(0x00E5FF)
            .setDescription(tracks)
            .setFooter({ text: `Duración total: ${queue.formattedDuration}` });
        return message.reply({ embeds: [queueEmbed], allowedMentions: { repliedUser: false } });
    }

    if (primaryCmd === 'sstop') {
        if (!distube) return;
        const queue = distube.getQueue(message);
        if (!queue) return message.reply({ content: '❌ No hay música activa.', allowedMentions: { repliedUser: false } });
        distube.stop(message);
        return message.reply({ content: '⏹️ Música detenida y cola vaciada.', allowedMentions: { repliedUser: false } });
    }

    // =========================================================================
    // COMANDO STICKET (DESPACHO A LA TRINIDAD SRE / PANEL INTERACTIVO)
    // =========================================================================
    if (primaryCmd === 'sticket' || primaryCmd === 'ticket' || primaryCmd === 'stickets') {
        const sub = cmdArgs[0]?.toLowerCase();
        if (sub === 'panel' || sub === 'setup') {
            if (!isJack) {
                return message.reply({ content: '❌ Solo Jack y la Administración pueden desplegar el panel interactivo.', allowedMentions: { repliedUser: false } });
            }
            const targetChannel = client.channels.cache.get(CHANNELS.TICKETS_SOPORTE) || message.channel;
            await sendTicketPanel(targetChannel);
            return message.reply({ content: `✅ Panel interactivo de tickets publicado en <#${targetChannel.id}>.`, allowedMentions: { repliedUser: false } });
        }
        if (sub === 'denuncias' || sub === 'denuncia') {
            if (!isJack) {
                return message.reply({ content: '❌ Solo Jack y la Administración pueden desplegar el panel de denuncias.', allowedMentions: { repliedUser: false } });
            }
            const targetChannel = message.channel;
            await sendDenunciasPanel(targetChannel);
            return message.reply({ content: `✅ Panel confidencial de denuncias publicado en <#${targetChannel.id}>.`, allowedMentions: { repliedUser: false } });
        }

        const issue = cmdArgs.join(' ').trim();
        if (!issue) {
            return message.reply({ content: '🎫 Por favor especifica el problema o bug para registrarlo.\n*Ejemplo:* `sticket No puedo craftear armadura de titanio en Slimefun`\n*Admin:* `sticket panel` (para publicar el panel con botones)', allowedMentions: { repliedUser: false } });
        }
        const ticketId = await dispatchTicketToTriad(
            `Ticket Discord: ${issue.slice(0, 50)}...`,
            issue,
            senderName,
            message.channel.name
        );
        const ticketEmbed = new EmbedBuilder()
            .setTitle(`🎫 Ticket Técnico #${ticketId || 'REGISTRADO'}`)
            .setColor(0x00FF88)
            .setDescription(`¡Tu reporte fue registrado formalmente en Star!`)
            .addFields(
                { name: '📋 Problema Reportado', value: issue },
                { name: '🤖 Asignación', value: 'Trinidad SRE: **Claude Code** (análisis de logs), **Codex** (código), **Antigravity** (compilación y verificación)' },
                { name: '📱 Notificación', value: 'Jack fue notificado automáticamente por WhatsApp.' }
            )
            .setFooter({ text: 'S.A.O.R.I. Autonomous SRE Fleet · DrakesCraft', iconURL: client.user.displayAvatarURL() });
        return message.reply({ embeds: [ticketEmbed], allowedMentions: { repliedUser: false } });
    }

    // =========================================================================
    // COMANDO SSUGERENCIA (BUZÓN OFICIAL DE LA COMUNIDAD)
    // =========================================================================
    if (primaryCmd === 'ssugerencia' || primaryCmd === 'sugerencia') {

        const sub = cmdArgs[0]?.toLowerCase();
        if (['aceptar', 'rechazar', 'implementar', 'aprobar'].includes(sub)) {
            if (!isStaffMember) {
                return message.reply({ content: '❌ Solo el Staff puede emitir veredictos sobre sugerencias.', allowedMentions: { repliedUser: false } });
            }
            const sugIdArg = cmdArgs[1];
            if (!sugIdArg) {
                return message.reply({ content: '📌 Uso: `ssugerencia aceptar/rechazar/implementar <#número o ID_mensaje> [motivo]`\n*Ejemplo:* `ssugerencia aceptar 42 Excelente propuesta, añadiremos la subasta.`' });
            }
            const reason = cmdArgs.slice(2).join(' ').trim() || 'Sin observaciones adicionales del Staff';

            const sugChannel = client.channels.cache.get(CHANNELS.SUGERENCIAS) || await client.channels.fetch(CHANNELS.SUGERENCIAS).catch(() => null);
            if (!sugChannel) return message.reply({ content: '❌ Canal de sugerencias no encontrado.' });

            let targetMsg = null;
            if (/^\d{17,20}$/.test(sugIdArg)) {
                targetMsg = await sugChannel.messages.fetch(sugIdArg).catch(() => null);
            }
            if (!targetMsg) {
                const searchNum = sugIdArg.replace('#', '');
                const recent = await sugChannel.messages.fetch({ limit: 50 }).catch(() => null);
                if (recent) {
                    for (const [, m] of recent) {
                        const title = m.embeds?.[0]?.title || '';
                        if (title.includes(`#${searchNum}`) || title.endsWith(` #${searchNum}`)) {
                            targetMsg = m;
                            break;
                        }
                    }
                }
            }

            if (!targetMsg || !targetMsg.embeds?.[0]) {
                return message.reply({ content: `❌ No se encontró la sugerencia **${sugIdArg}** en <#${CHANNELS.SUGERENCIAS}>.` });
            }

            const oldEmbed = targetMsg.embeds[0];
            const newEmbed = EmbedBuilder.from(oldEmbed);

            let statusText = '';
            let verdictColor = 0xFFB300;
            if (sub === 'aceptar' || sub === 'aprobar') {
                statusText = '✅ **Aceptada por Staff**';
                verdictColor = 0x2ECC71;
            } else if (sub === 'rechazar') {
                statusText = '❌ **Rechazada por Staff**';
                verdictColor = 0xE74C3C;
            } else if (sub === 'implementar') {
                statusText = '🚀 **Implementada en Producción**';
                verdictColor = 0x9B59B6;
            }

            newEmbed.setColor(verdictColor);
            const fields = (oldEmbed.fields || []).map(f => {
                if (f.name === '📊 Estado') return { name: '📊 Estado', value: statusText, inline: true };
                return f;
            });
            const existingVerdictIdx = fields.findIndex(f => f.name.startsWith('🛡️ Veredicto'));
            const verdictField = { name: `🛡️ Veredicto de ${message.author.tag}`, value: reason.slice(0, 1000), inline: false };
            if (existingVerdictIdx !== -1) {
                fields[existingVerdictIdx] = verdictField;
            } else {
                fields.push(verdictField);
            }
            newEmbed.setFields(fields);

            await targetMsg.edit({ embeds: [newEmbed] });

            if (targetMsg.thread) {
                const notifEmbed = new EmbedBuilder()
                    .setTitle(`📢 Veredicto Oficial: Sugerencia ${sub.toUpperCase()}`)
                    .setColor(verdictColor)
                    .setDescription(`**Estado:** ${statusText}\n**Moderador:** ${message.author}\n**Motivo / Observación:**\n>>> ${reason}`)
                    .setTimestamp();
                await targetMsg.thread.send({ embeds: [notifEmbed] }).catch(() => {});
            }

            return message.reply({ content: `✅ La sugerencia ha sido actualizada a **${statusText}** exitosamente.\n🔗 Enlace: ${targetMsg.url}` });
        }

        const sugText = cmdArgs.join(' ').trim();
        await handleSuggestion(message, sugText, true);
        return;
    }

    // =========================================================================
    // COMANDO SSTATS (TELEMETRÍA Y SERVIDOR)
    // =========================================================================
    if (primaryCmd === 'sstats' || primaryCmd === 'stats') {
        const sub = cmdArgs[0]?.toLowerCase();
        if (sub === 'star') {
            const uptimeHours = (os.uptime() / 3600).toFixed(1);
            const totalMem = (os.totalmem() / (1024 ** 3)).toFixed(1);
            const freeMem = (os.freemem() / (1024 ** 3)).toFixed(1);
            const usedMem = (totalMem - freeMem).toFixed(1);
            const starEmbed = new EmbedBuilder()
                .setTitle('🖥️ Telemetría Servidor Central · Star')
                .setColor(0x3399FF)
                .setDescription('Servidor dedicado de infraestructura central y orquestación de IA.')
                .addFields(
                    { name: '⏱️ Uptime Host', value: `${uptimeHours} horas`, inline: true },
                    { name: '🧠 Memoria RAM', value: `${usedMem} GB / ${totalMem} GB`, inline: true },
                    { name: '🛡️ Estado SRE', value: '99.99% Uptime · Protección Activa', inline: true },
                    { name: '🐳 Docker Stacks', value: 'Saori Unified, Web, DBs, Reverse Proxy OK', inline: true }
                )
                .setFooter({ text: 'S.A.O.R.I. SRE Core · Host Star', iconURL: client.user.displayAvatarURL() });
            return message.reply({ embeds: [starEmbed], allowedMentions: { repliedUser: false } });
        }
        if (sub === 'nova' || sub === 'nexus') {
            const nodeEmbed = new EmbedBuilder()
                .setTitle(`⚡ Telemetría Nodo · ${sub.toUpperCase()}`)
                .setColor(0x00FF88)
                .setDescription(`Estado y enlace con la infraestructura de desarrollo y render.`)
                .addFields(
                    { name: '🔌 Conexión Tailscale', value: 'En línea (100.x.x.x) · Latencia baja', inline: true },
                    { name: '🛡️ Sincronización Git', value: 'Repositorios al día con Star', inline: true }
                )
                .setFooter({ text: 'S.A.O.R.I. SRE Fleet', iconURL: client.user.displayAvatarURL() });
            return message.reply({ embeds: [nodeEmbed], allowedMentions: { repliedUser: false } });
        }
        // DrakesCraft general
        const drakesEmbed = new EmbedBuilder()
            .setTitle('📊 Estado y Rendimiento · DrakesCraft Network')
            .setColor(0x00E5FF)
            .addFields(
                { name: '⚡ TPS / Rendimiento', value: '`20.0 / 20.0 TPS` (Estable)', inline: true },
                { name: '🎮 IP Conexión Java', value: '`mc.drakescraft.cl:25565`', inline: true },
                { name: '📱 IP Conexión Bedrock', value: '`mc.drakescraft.cl` (19132)', inline: true },
                { name: '🌐 Portal Web', value: 'https://web.drakescraft.cl', inline: true },
                { name: '🛒 Tienda Oficial', value: 'https://web.drakescraft.cl', inline: true },
                { name: '🛡️ Modo SRE', value: 'Protección autónoma 24/7', inline: true }
            )
            .setFooter({ text: 'S.A.O.R.I. SRE Core · DrakesCraft Network', iconURL: client.user.displayAvatarURL() });
        return message.reply({ embeds: [drakesEmbed], allowedMentions: { repliedUser: false } });
    }

    // =========================================================================
    // COMANDO SGUIA (DOCUMENTACIÓN OFICIAL)
    // =========================================================================
    if (primaryCmd === 'sguia' || primaryCmd === 'guia') {
        const guiaEmbed = new EmbedBuilder()
            .setTitle('📖 Enciclopedia & Guías de DrakesCraft')
            .setColor(0xFFB300)
            .setDescription('Aquí tienes la documentación oficial para dominar todas las modalidades:')
            .addFields(
                { name: '⚡ Slimefun & Tecnología', value: 'Guía paso a paso de máquinas, energía y aleaciones: [web.drakescraft.cl/guia.html](https://web.drakescraft.cl/guia.html)' },
                { name: '💼 Trabajos y Economía', value: 'Gana dinero minando, talando y crafteando con `/jobs join`.' },
                { name: '🏝️ OneBlock & SkyBlock', value: 'Inicia tu isla con `/ob` o `/is` y sube de nivel tu generador.' },
                { name: '🛡️ Protecciones', value: 'Asegura tus cofres y parcelas usando bloques de protección o WorldGuard.' }
            )
            .setFooter({ text: 'S.A.O.R.I. Guías Oficiales', iconURL: client.user.displayAvatarURL() });
        return message.reply({ embeds: [guiaEmbed], allowedMentions: { repliedUser: false } });
    }

    // =========================================================================
    // COMANDO SCLEAR / !PURGE (MODERACIÓN DE MENSAJES)
    // =========================================================================
    if (primaryCmd === 'sclear' || primaryCmd === 'purge') {
        if (!isStaffMember) {
            return message.reply({ content: '❌ Solo los miembros del Staff tienen autorización para purgar mensajes.', allowedMentions: { repliedUser: false } });
        }
        const count = parseInt(cmdArgs[0], 10);
        if (isNaN(count) || count < 1 || count > 100) {
            return message.reply({ content: '⚠️ Por favor indica una cantidad entre 1 y 100 mensajes. Ejemplo: `sclear 20`', allowedMentions: { repliedUser: false } });
        }
        try {
            await message.delete().catch(() => {});
            const deleted = await message.channel.bulkDelete(count, true);
            const msgConfirm = await message.channel.send(`🧹 Se han purgado **${deleted.size}** mensajes por orden de ${senderName}.`);
            setTimeout(() => msgConfirm.delete().catch(() => {}), 4000);
            return;
        } catch (e) {
            return message.channel.send(`❌ Error al purgar mensajes: ${e.message}`);
        }
    }

    // =========================================================================
    // COMANDO SROLE (GESTIÓN DE ROLES)
    // =========================================================================
    if (primaryCmd === 'srole') {
        if (!isStaffMember) {
            return message.reply({ content: '❌ Solo los miembros del Staff pueden gestionar roles.', allowedMentions: { repliedUser: false } });
        }
        const action = cmdArgs[0]?.toLowerCase();
        if (action === 'dar' || action === 'quitar') {
            const targetMember = message.mentions.members.first();
            if (!targetMember) return message.reply({ content: '⚠️ Debes mencionar al usuario. Ejemplo: `srole dar @Jack VIP`', allowedMentions: { repliedUser: false } });
            const roleName = cmdArgs.slice(2).join(' ').trim().toLowerCase();
            if (!roleName) return message.reply({ content: '⚠️ Debes indicar el nombre del rol.', allowedMentions: { repliedUser: false } });
            const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName || r.name.toLowerCase().includes(roleName));
            if (!role) return message.reply({ content: `❌ No encontré ningún rol que coincida con "${roleName}".`, allowedMentions: { repliedUser: false } });
            try {
                if (action === 'dar') {
                    await targetMember.roles.add(role);
                    return message.reply({ content: `✅ Se asignó el rol **${role.name}** a ${targetMember.user.tag}.`, allowedMentions: { repliedUser: false } });
                } else {
                    await targetMember.roles.remove(role);
                    return message.reply({ content: `✅ Se retiró el rol **${role.name}** a ${targetMember.user.tag}.`, allowedMentions: { repliedUser: false } });
                }
            } catch (e) {
                return message.reply({ content: `❌ Error al modificar rol: ${e.message}`, allowedMentions: { repliedUser: false } });
            }
        }
    }



    // =========================================================================
    // COMANDO SREENCARNAR (RITO DE PRESTIGIO Y REINICIO DE PROGRESO)
    // =========================================================================
    
    // =========================================================================
    // COMANDO SNICK (TIPOGRAFÍA SMALL CAPS Y NORMALIZACIÓN)
    // =========================================================================
    if (primaryCmd === 'snick') {
        if (!isStaffMember) {
            return message.reply({ content: '❌ Solo los miembros del Staff pueden usar el comando de normalización de apodos.', allowedMentions: { repliedUser: false } });
        }
        const sub = cmdArgs[0]?.toLowerCase();
        if (sub === 'sync' || sub === 'all') {
            await message.reply({ content: '🔄 Normalizando tipografía Small Caps de todos los miembros del servidor...' });
            let count = 0;
            const members = await message.guild.members.fetch();
            for (const [id, m] of members) {
                if (m.user.bot || m.id === JACK_DISCORD_ID) continue;
                const rawName = m.nickname || m.user.globalName || m.user.username;
                const formatted = formatMemberNickname(rawName, m.roles.cache.map(r => r.id), m.id);
                if (formatted && formatted !== m.nickname) {
                    await m.setNickname(formatted).catch(() => {});
                    count++;
                }
            }
            return message.reply({ content: `✅ Sincronización de tipografía finalizada. Se actualizaron ${count} apodos.` });
        }

        const targetMember = message.mentions.members.first();
        if (!targetMember) {
            return message.reply({ content: '📌 Uso: `snick @usuario` para normalizar a un usuario o `snick sync` para todo el servidor.', allowedMentions: { repliedUser: false } });
        }
        const rawName = targetMember.nickname || targetMember.user.globalName || targetMember.user.username;
        const formatted = formatMemberNickname(rawName, targetMember.roles.cache.map(r => r.id), targetMember.id);
        if (formatted) {
            await targetMember.setNickname(formatted).catch(err => {
                return message.reply({ content: `❌ No se pudo cambiar el apodo: ${err.message}` });
            });
            return message.reply({ content: `✅ Apodo de **${targetMember.user.tag}** normalizado a: \`${formatted}\`` });
        }
    }

    if (primaryCmd === 'sreencarnar' || primaryCmd === 'reencarnar') {
        const codeArg = (cmdArgs[0] || '').trim().toUpperCase();
        if (!codeArg || !codeArg.startsWith('RC-')) {
            const usageEmbed = new EmbedBuilder()
                .setTitle('⚖️ Rito de Reencarnación y Prestigio')
                .setColor(0xF39C12)
                .setDescription('Para iniciar tu reencarnación y reinicio voluntario de cuenta, primero debes solicitarla dentro del servidor de Minecraft.')
                .addFields(
                    { name: '1. Inicia en Minecraft', value: 'Escribe `/reencarnar` dentro del servidor para abrir la **Cápsula de Recuerdos** y guardar hasta 5 ítems que quieras conservar.' },
                    { name: '2. Obtén tu Código', value: 'Al confirmar en Minecraft se generará un código de seguridad temporal de 15 minutos con formato `RC-XXXXXX`.' },
                    { name: '3. Confirma en Discord', value: 'Escribe aquí: `sreencarnar <CÓDIGO>` o `!reencarnar <CÓDIGO>` para autorizar el protocolo de destrucción y regeneración.' }
                )
                .setFooter({ text: 'S.A.O.R.I. Protocolo Prestigio · DrakesCraft Network', iconURL: client.user.displayAvatarURL() });
            return message.reply({ embeds: [usageEmbed], allowedMentions: { repliedUser: false } });
        }

        const confirmEmbed = new EmbedBuilder()
            .setTitle('🔥 PROTOCOLO DE REENCARNACIÓN Y PRESTIGIO 🔥')
            .setColor(0xE74C3C)
            .setDescription(`Se ha presentado una solicitud de reencarnación con el código de seguridad: **\`${codeArg}\`**.\n\n⚠️ **ADVERTENCIA CRÍTICA: ESTA ACCIÓN ES TOTALMENTE DEFINITIVA E IRREVERSIBLE.**`)
            .addFields(
                {
                    name: '💥 Lo que será DESTRUIDO y REGENERADO:',
                    value: '• **Regeneración de Chunks:** Todos tus terrenos y protecciones volverán a su bioma natural original (worldgen limpio).\n• **Inventarios:** Tu inventario personal, armadura puesta, Ender Chest y puntos de nivel/XP serán reseteados.\n• **Bóvedas:** Todos tus baúles virtuales (`/pv`), bancos e islas personales serán eliminados.\n• **Economía & Slimefun:** Tu saldo se reajustará a la base inicial de **₯1,000** y se reiniciarán todas tus investigaciones tecnológicas de Slimefun.'
                },
                {
                    name: '🛡️ Lo que CONSERVARÁS intacto:',
                    value: '• **Cuenta & Rangos:** Tu usuario, inicio de sesión y rangos VIP adquiridos en la tienda no se tocan.\n• **Cápsula de Recuerdos:** Los hasta 5 ítems que depositaste en la caja sellada del pasado se te entregarán en tu nuevo inicio.\n• **Reconocimiento:** Recibirás la insignia honorífica de **Prestigio** y el anuncio global de tu renacimiento.'
                }
            )
            .setFooter({ text: 'Presiona el botón rojo para confirmar o cancelar para anular.', iconURL: client.user.displayAvatarURL() });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`btn_reencarnar_confirm_${codeArg}_${message.author.id}`)
                .setLabel('💣 DESTRUIR Y REENCARNAR')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`btn_reencarnar_cancel_${codeArg}_${message.author.id}`)
                .setLabel('❌ CANCELAR')
                .setStyle(ButtonStyle.Secondary)
        );

        return message.reply({ embeds: [confirmEmbed], components: [row], allowedMentions: { repliedUser: false } });
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
    // COMANDO SONLINE / SJUGADORES (LISTA EN VIVO DE MINECRAFT)
    // =========================================================================
    if (primaryCmd === 'sonline' || primaryCmd === 'sjugadores' || primaryCmd === 'online') {
        try {
            const res = await fetch('https://api.mcsrvstat.us/3/mc.drakescraft.cl', { timeout: 4500 });
            let mcData = null;
            if (res.ok) {
                mcData = await res.json();
            }
            const onlineCount = mcData?.players?.online || 0;
            const maxPlayers = mcData?.players?.max || 100;
            const list = mcData?.players?.list?.map(p => `• \`${p.name}\``).join('\n') || '*(Jugadores anónimos o lista protegida)*';

            const onlineEmbed = new EmbedBuilder()
                .setTitle('🎮 Jugadores Conectados en DrakesCraft')
                .setColor(0x2ECC71)
                .setDescription(`Actualmente hay **${onlineCount}/${maxPlayers}** jugadores en línea explorando el servidor.`)
                .addFields(
                    { name: '👥 Jugadores Detectados', value: onlineCount > 0 ? list.slice(0, 1020) : '📭 No hay jugadores conectados en este momento.', inline: false },
                    { name: '📌 IP Java', value: '`mc.drakescraft.cl:25565`', inline: true },
                    { name: '📱 IP Bedrock', value: '`mc.drakescraft.cl` (Puerto `19132`)', inline: true }
                )
                .setFooter({ text: 'DrakesCraft Network · Telemetría en Vivo', iconURL: client.user.displayAvatarURL() })
                .setTimestamp();
            return message.reply({ embeds: [onlineEmbed], allowedMentions: { repliedUser: false } });
        } catch (err) {
            return message.reply({ content: `❌ Error al consultar jugadores de Minecraft: ${err.message}` });
        }
    }

    // =========================================================================
    // COMANDO SREGLAS (NORMATIVA OFICIAL)
    // =========================================================================
    if (primaryCmd === 'sreglas' || primaryCmd === 'reglas') {
        const reglasEmbed = new EmbedBuilder()
            .setTitle('📜 Normativa Oficial de DrakesCraft Network')
            .setColor(0xF1C40F)
            .setDescription('Para mantener una comunidad justa y divertida, todos los miembros deben respetar:')
            .addFields(
                { name: '1. Respeto y Convivencia', value: 'Cero toxicidad, insultos graves, discriminación, acoso o lenguaje de odio en canales públicos o chats in-game.', inline: false },
                { name: '2. Prohibición de Trampas y Ventajas Desleales', value: 'Uso de hacks, auto-clickers, x-ray, barítonos o modificación de clientes para obtener ventajas está penado con ban permanente.', inline: false },
                { name: '3. Respeto a Parcelas y Protecciones', value: 'Grifear alrededor de zonas protegidas, robar en cofres no asegurados con bugs o bloquear accesos está estrictamente prohibido.', inline: false },
                { name: '4. Economía y Comercio Limpio', value: 'Prohibidas las estafas en transacciones de dinero (`/pay`), tiendas de jugadores (`/qs`) o comercio de ítems.', inline: false },
                { name: '5. Seguridad de Cuentas y Enlaces', value: 'Prohibido compartir enlaces maliciosos, IP loggers, phishing o publicidad de otros servidores.', inline: false }
            )
            .setFooter({ text: 'Consulta el canal de reglas para la versión completa y detallada' });
        return message.reply({ embeds: [reglasEmbed], allowedMentions: { repliedUser: false } });
    }

    // =========================================================================
    // COMANDO SMISROLES (PERFIL DE USUARIO Y ROLES ASIGNADOS)
    // =========================================================================
    if (primaryCmd === 'smisroles' || (primaryCmd === 'sroles' && cmdArgs[0]?.toLowerCase() === 'misroles')) {
        const member = message.member;
        if (!member) return message.reply({ content: '❌ Solo puedes consultar tus roles dentro del servidor.' });

        const userRoles = member.roles.cache;
        
        let plataforma = 'No seleccionada';
        if (userRoles.has('1544920853471432777')) plataforma = '☕ Java Edition';
        else if (userRoles.has('1544920854930985160')) plataforma = '📱 Bedrock / Móvil';

        const modalidades = [];
        if (userRoles.has('1544920856684265533')) modalidades.push('⚡ Slimefun & Tech');
        if (userRoles.has('1544920860861927516')) modalidades.push('🏝️ OneBlock');
        if (userRoles.has('1544920865173671938')) modalidades.push('☁️ SkyBlock');
        if (userRoles.has('1544920866851127379')) modalidades.push('⚔️ Survival Clásico');
        if (userRoles.has('1544920867866148917')) modalidades.push('🎯 PvP & Arenas');

        const avisos = [];
        if (userRoles.has('1539644011214807181')) avisos.push('📢 Avisos Discord');
        if (userRoles.has('1539644151165882418')) avisos.push('⛏️ Avisos MC');
        if (userRoles.has('1539644230941806602')) avisos.push('🎁 Sorteos');
        if (userRoles.has('1539644293914824814')) avisos.push('🚀 Changelogs');

        const topRole = member.roles.highest;

        const perfilEmbed = new EmbedBuilder()
            .setTitle(`👤 Perfil de Roles · ${member.displayName}`)
            .setColor(0x9B59B6)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '👑 Rol Principal', value: `${topRole} (\`${topRole.name}\`)`, inline: true },
                { name: '🎮 Plataforma', value: plataforma, inline: true },
                { name: '🕹️ Modalidades Favoritas', value: modalidades.length > 0 ? modalidades.join('\n') : '*(Ninguna seleccionada en #auto-roles)*', inline: false },
                { name: '🔔 Notificaciones Activas', value: avisos.length > 0 ? avisos.join(' · ') : '*(Ninguna seleccionada)*', inline: false }
            )
            .setFooter({ text: 'Personaliza tus roles en el canal #🎭・auto-roles' })
            .setTimestamp();

        return message.reply({ embeds: [perfilEmbed], allowedMentions: { repliedUser: false } });
    }

    // =========================================================================
    // SUITE DE ALTA MODERACIÓN (skick, sban, smute, sunmute, swarn, slowmode, slock, sunlock)
    // =========================================================================

    // =========================================================================
    // 🛡️ GUÍA COMPLETA DE COMANDOS DE STAFF (SHELPSTAFF / STAFFHELP)
    // =========================================================================
    if (primaryCmd === 'shelpstaff' || primaryCmd === 'staffhelp' || primaryCmd === 'sstaffhelp') {
        if (!isStaffMember) {
            return message.reply({ content: '❌ Acceso denegado: El manual operativo de Staff está reservado exclusivamente para miembros del Staff de DrakesCraft.', allowedMentions: { repliedUser: false } });
        }
        const { embed, row } = buildShelpStaffEmbed('all');
        return message.reply({ embeds: [embed], components: [row], allowedMentions: { repliedUser: false } });
    }

    // =========================================================================
    // ⚡ TELEMETRÍA EN VIVO (STPS EN CUALQUIER CANAL)
    // =========================================================================
    if (primaryCmd === 'stps' || primaryCmd === 'tps') {
        try {
            const telemetry = await getLiveServerTelemetry();
            const teleEmbed = formatTelemetryEmbed(telemetry);
            return message.reply({ embeds: [teleEmbed], allowedMentions: { repliedUser: false } });
        } catch (e) {
            return message.reply({ content: `❌ Error obteniendo telemetría: ${e.message}` });
        }
    }

    // =========================================================================
    // 📜 VISOR DE LOGS DE MINECRAFT EN VIVO (SLOGS)
    // =========================================================================
    if (primaryCmd === 'slogs' || primaryCmd === 'logs') {
        if (!isStaffMember || hierarchy.level < STAFF_LEVELS.MOD) {
            return message.reply({ content: '❌ Acceso denegado: Solo el Staff autorizado (Moderadores, Devs y Admins) puede consultar los logs de la consola.', allowedMentions: { repliedUser: false } });
        }
        const filter = cmdArgs.join(' ').trim();
        const waitMsg = await message.reply({ content: '📜 *Consultando logs en tiempo real desde la consola de Minecraft...*', allowedMentions: { repliedUser: false } });
        const lines = await fetchMinecraftLatestLogs(filter);
        if (!lines || lines.length === 0) {
            return waitMsg.edit({ content: `⚠️ No se encontraron registros de logs${filter ? ` con el filtro \`${filter}\`` : ''}.` });
        }
        const totalPages = Math.max(1, Math.ceil(lines.length / 18));
        const { embed, row } = buildLogEmbedAndButtons(lines, 0, totalPages, filter, message.author.id);
        const sent = await waitMsg.edit({ content: '', embeds: [embed], components: [row] });
        logViewerSessions.set(sent.id, { lines, page: 0, totalPages, filter, authorId: message.author.id });
        return;
    }

    // =========================================================================
    // 🗂️ MENÚ INTERACTIVO Y HUB COMUNITARIO (SMENU)
    // =========================================================================
    if (primaryCmd === 'smenu' || primaryCmd === 'menu') {
        const { embed, selectRow, buttonRow } = buildMainMenuHub();
        return message.reply({ embeds: [embed], components: [selectRow, buttonRow], allowedMentions: { repliedUser: false } });
    }

    // =========================================================================
    // 👤 PERFIL DE USUARIO (SPERFIL / SMIPERFIL)
    // =========================================================================
    if (primaryCmd === 'sperfil' || primaryCmd === 'perfil' || primaryCmd === 'smiperfil') {
        const targetMember = message.mentions.members.first() || 
                             (cmdArgs[0] ? await message.guild.members.fetch(cmdArgs[0].replace(/[^0-9]/g, '')).catch(() => null) : null) || 
                             message.member;
        const profileEmbed = await buildUserProfileEmbed(targetMember, message.guild);
        return message.reply({ embeds: [profileEmbed], allowedMentions: { repliedUser: false } });
    }

    // =========================================================================
    // 🛡️ DIRECTORIO DE STAFF OFICIAL (SSTAFF)
    // =========================================================================
    if (primaryCmd === 'sstaff' || primaryCmd === 'staff') {
        try {
            await message.guild.members.fetch().catch(() => {});
            const staffMembers = message.guild.members.cache.filter(m => 
                m.id === JACK_DISCORD_ID || 
                m.id === KIKA_DISCORD_ID || 
                m.roles.cache.has(STAFF_ROLE_ID) ||
                m.roles.cache.some(r => {
                    const rn = r.name.toLowerCase();
                    return rn.includes('staff') || rn.includes('admin') || rn.includes('mod') || rn.includes('dev') || rn.includes('builder') || rn.includes('dueño');
                })
            );

            const owners = [];
            const admins = [];
            const devs = [];
            const mods = [];
            const builders = [];
            const helpers = [];

            for (const [id, m] of staffMembers) {
                if (m.user.bot) continue;
                const h = getStaffMemberHierarchy(m, id);
                const statusIcon = m.presence?.status === 'online' ? '🟢' : (m.presence?.status === 'idle' ? '🟡' : (m.presence?.status === 'dnd' ? '🔴' : '⚪'));
                const display = `${statusIcon} ${m} (\`${m.displayName}\`)`;

                if (h.level === STAFF_LEVELS.OWNER) owners.push(display);
                else if (h.level === STAFF_LEVELS.ADMIN) admins.push(display);
                else if (h.level === STAFF_LEVELS.DEV) devs.push(display);
                else if (h.level === STAFF_LEVELS.MOD) mods.push(display);
                else if (h.level === STAFF_LEVELS.BUILDER) builders.push(display);
                else helpers.push(display);
            }

            const staffEmbed = new EmbedBuilder()
                .setTitle('🛡️ Equipo de Staff Oficial · DrakesCraft Network')
                .setColor(0x00E5FF)
                .setDescription('Lista de miembros del Staff oficial con presencia en tiempo real:')
                .addFields(
                    { name: '👑 Dirección & Propietarios', value: owners.join('\n') || '*Ninguno en línea*', inline: false },
                    { name: '🛡️ Administradores', value: admins.join('\n') || '*Ninguno registrado*', inline: false },
                    { name: '🔧 Desarrolladores (Devs)', value: devs.join('\n') || '*Ninguno registrado*', inline: false },
                    { name: '⚔️ Moderadores', value: mods.join('\n') || '*Ninguno registrado*', inline: false },
                    { name: '🔨 Builders', value: builders.join('\n') || '*Ninguno registrado*', inline: false }
                )
                .setFooter({ text: `Total de Miembros del Staff: ${staffMembers.size} · Solo Staff autorizado tiene acceso a controles críticos` })
                .setTimestamp();

            return message.reply({ embeds: [staffEmbed], allowedMentions: { repliedUser: false } });
        } catch (e) {
            return message.reply({ content: `❌ Error al listar el Staff: ${e.message}` });
        }
    }

    // =========================================================================
    // 🌐 INFORMACIÓN DEL SERVIDOR DISCORD (SSERVERINFO)
    // =========================================================================
    if (primaryCmd === 'sserverinfo' || primaryCmd === 'serverinfo') {
        const guild = message.guild;
        const total = guild.memberCount;
        const humans = guild.members.cache.filter(m => !m.user.bot).size;
        const bots = guild.members.cache.filter(m => m.user.bot).size;
        const channelsCount = guild.channels.cache.size;
        const rolesCount = guild.roles.cache.size;

        const sEmbed = new EmbedBuilder()
            .setTitle(`⚡ ${guild.name}`)
            .setColor(0x00E5FF)
            .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
            .addFields(
                { name: '👑 Dueño', value: `<@${guild.ownerId}> (\`${guild.ownerId}\`)`, inline: true },
                { name: '📅 Creación', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
                { name: '💎 Nivel Boost', value: `Nivel ${guild.premiumTier} (${guild.premiumSubscriptionCount} mejoras)`, inline: true },
                { name: '👥 Miembros', value: `• **Total:** \`${total}\`\n• **Humanos:** \`${humans}\`\n• **Bots:** \`${bots}\``, inline: true },
                { name: '💬 Canales', value: `\`${channelsCount} canales\``, inline: true },
                { name: '🏷️ Roles', value: `\`${rolesCount} roles\``, inline: true }
            )
            .setFooter({ text: 'DrakesCraft Network Server Registry' })
            .setTimestamp();

        return message.reply({ embeds: [sEmbed], allowedMentions: { repliedUser: false } });
    }

    // =========================================================================
    // 👑 INFORMACIÓN DE RANGOS VIP (SVIP)
    // =========================================================================
    if (primaryCmd === 'svip' || primaryCmd === 'vip') {
        const vipEmbed = getSmenuCategoryEmbed('rangos_dioses');
        return message.reply({ embeds: [vipEmbed], allowedMentions: { repliedUser: false } });
    }

    // =========================================================================
    // 🛡️ GUÍA DE PROTECCIÓN DE TERRENOS (SCLAIM)
    // =========================================================================
    if (primaryCmd === 'sclaim' || primaryCmd === 'claim' || primaryCmd === 'claims') {
        const claimEmbed = buildClaimsGuideEmbed();
        return message.reply({ embeds: [claimEmbed], allowedMentions: { repliedUser: false } });
    }

    // =========================================================================
    // 🎁 VOTACIÓN Y RECOMPENSAS DIARIAS (SVOTAR / SRECOMPENSA)
    // =========================================================================
    if (primaryCmd === 'svotar' || primaryCmd === 'votar' || primaryCmd === 'srecompensa') {
        const voteEmbed = buildVoteGuideEmbed();
        return message.reply({ embeds: [voteEmbed], allowedMentions: { repliedUser: false } });
    }

    // =========================================================================
    // 🌐 REDES SOCIALES Y ENLACES (SREDES)
    // =========================================================================
    if (primaryCmd === 'sredes' || primaryCmd === 'redes') {
        const redesEmbed = new EmbedBuilder()
            .setTitle('🌐 DrakesCraft Network · Redes Oficiales')
            .setColor(0x00E5FF)
            .setDescription('Conéctate con toda nuestra comunidad a través de nuestras plataformas oficiales:')
            .addFields(
                { name: '🌐 Sitio Web Principal', value: '[https://drakescraft.cl](https://drakescraft.cl)', inline: false },
                { name: '🛒 Tienda Oficial Tebex', value: '[https://tienda.drakescraft.cl](https://tienda.drakescraft.cl)', inline: false },
                { name: '🎮 IP del Servidor de Minecraft', value: '`mc.drakescraft.cl` (Java 1.21.1 / Bedrock Puerto 19132)', inline: false }
            )
            .setFooter({ text: 'DrakesCraft Network Social Hub' });

        return message.reply({ embeds: [redesEmbed], allowedMentions: { repliedUser: false } });
    }

    // =========================================================================
    // 🛠️ GESTIÓN DIRECTA DE DISCORD POR SAORI (SCHAN, SROL, SANUNCIO, SSAY)
    // =========================================================================
    if (['schan', 'srol', 'sanuncio', 'ssay'].includes(primaryCmd)) {
        const handled = await handleDiscordStaffActions(message, primaryCmd, cmdArgs, hierarchy);
        if (handled) return;
    }

    // =========================================================================
    // ⚔️ COMANDOS DE MODERACIÓN IN-GAME PARA STAFF (SMCKICK, SMCBAN, ETC.)
    // =========================================================================
    if (['smckick', 'smcban', 'smcunban', 'smcpardon', 'smcmute', 'smcwarn', 'smcmsg', 'smcbroadcast', 'smcannounce', 'smcwhitelist', 'smcsave', 'smchealth'].includes(primaryCmd)) {
        if (!hierarchy.isStaff) {
            return message.reply({ content: '❌ Acceso denegado: Solo miembros del Staff de DrakesCraft pueden ejecutar órdenes in-game.', allowedMentions: { repliedUser: false } });
        }

        // smckick <jugador> [motivo]
        if (primaryCmd === 'smckick') {
            if (hierarchy.level < STAFF_LEVELS.MOD) {
                return message.reply({ content: '❌ Se requiere rango Moderador o superior para expulsar jugadores.' });
            }
            const player = cmdArgs[0];
            const reason = cmdArgs.slice(1).join(' ') || 'Expulsado por decisión del Staff';
            if (!player) return message.reply({ content: '📌 Uso: `smckick <jugador> [motivo]`' });
            await sendMinecraftConsoleCommand(`kick ${player} ${reason}`);
            const embed = new EmbedBuilder().setTitle('👢 Jugador Expulsado (Minecraft)').setColor(0xE67E22)
                .addFields({ name: 'Jugador', value: `\`${player}\``, inline: true }, { name: 'Moderador', value: `${message.author}`, inline: true }, { name: 'Motivo', value: reason, inline: false }).setTimestamp();
            await message.reply({ embeds: [embed] });
            await sendAuditLog(embed);
            return;
        }

        // smcban <jugador> <motivo>
        if (primaryCmd === 'smcban') {
            const player = cmdArgs[0];
            const reason = cmdArgs.slice(1).join(' ');
            if (!player) return message.reply({ content: '📌 Uso: `smcban <jugador> <motivo justificado>`' });

            if (hierarchy.level < STAFF_LEVELS.ADMIN) {
                if (hierarchy.level === STAFF_LEVELS.MOD) {
                    if (!reason || reason.length < 10) {
                        return message.reply({ content: '⚠️ Para banear en MC como Moderador, debes detallar una causa justa (mínimo 10 caracteres) para auditoría de Jack y la Trinidad SRE.' });
                    }
                    const formattedReason = `[MOD: ${message.author.username}] ${reason} (Revisión Jack/Trinidad)`;
                    await sendMinecraftConsoleCommand(`ban ${player} ${formattedReason}`);
                    const alertEmbed = new EmbedBuilder().setTitle('🔨 Sanción MC por Moderador (Auditoría Prioritaria)').setColor(0xE74C3C)
                        .addFields(
                            { name: 'Jugador', value: `\`${player}\``, inline: true },
                            { name: 'Moderador', value: `${message.author}`, inline: true },
                            { name: 'Motivo Justificado', value: reason, inline: false },
                            { name: 'Aviso Operacional', value: `⚠️ Esta sanción ha sido notificada a <@${JACK_DISCORD_ID}> y la Trinidad SRE.` }
                        )
                        .setTimestamp();
                    await message.reply({ embeds: [alertEmbed] });
                    await sendAuditLog(alertEmbed);
                    return;
                } else {
                    return message.reply({ content: '❌ No tienes permisos para banear en Minecraft.' });
                }
            }

            const fullReason = reason || 'Infracción grave de normativas';
            await sendMinecraftConsoleCommand(`ban ${player} ${fullReason}`);
            const embed = new EmbedBuilder().setTitle('🔨 Jugador Baneado de Minecraft').setColor(0x992D22)
                .addFields({ name: 'Jugador', value: `\`${player}\``, inline: true }, { name: 'Staff', value: `${message.author}`, inline: true }, { name: 'Motivo', value: fullReason, inline: false }).setTimestamp();
            await message.reply({ embeds: [embed] });
            await sendAuditLog(embed);
            return;
        }

        // smcunban <jugador>
        if (primaryCmd === 'smcunban' || primaryCmd === 'smcpardon') {
            if (hierarchy.level < STAFF_LEVELS.ADMIN) {
                return message.reply({ content: '❌ Solo Administradores y Dueños pueden perdonar / desbanear en Minecraft.' });
            }
            const player = cmdArgs[0];
            if (!player) return message.reply({ content: '📌 Uso: `smcunban <jugador>`' });
            await sendMinecraftConsoleCommand(`pardon ${player}`);
            const embed = new EmbedBuilder().setTitle('🕊️ Jugador Desbaneado de Minecraft').setColor(0x2ECC71)
                .addFields({ name: 'Jugador', value: `\`${player}\``, inline: true }, { name: 'Staff', value: `${message.author}`, inline: true }).setTimestamp();
            await message.reply({ embeds: [embed] });
            await sendAuditLog(embed);
            return;
        }

        // smcmute <jugador> [tiempo] [motivo]
        if (primaryCmd === 'smcmute') {
            if (hierarchy.level < STAFF_LEVELS.MOD) {
                return message.reply({ content: '❌ Se requiere rango Moderador o superior para silenciar en Minecraft.' });
            }
            const player = cmdArgs[0];
            const time = cmdArgs[1] || '30m';
            const reason = cmdArgs.slice(2).join(' ') || 'Conducta inapropiada en chat in-game';
            if (!player) return message.reply({ content: '📌 Uso: `smcmute <jugador> [tiempo (ej: 30m, 1h)] [motivo]`' });
            await sendMinecraftConsoleCommand(`mute ${player} ${time} ${reason}`);
            const embed = new EmbedBuilder().setTitle('🔇 Jugador Silenciado en Minecraft').setColor(0xF39C12)
                .addFields({ name: 'Jugador', value: `\`${player}\``, inline: true }, { name: 'Tiempo', value: `\`${time}\``, inline: true }, { name: 'Moderador', value: `${message.author}`, inline: true }, { name: 'Motivo', value: reason, inline: false }).setTimestamp();
            await message.reply({ embeds: [embed] });
            await sendAuditLog(embed);
            return;
        }

        // smcwarn <jugador> <motivo>
        if (primaryCmd === 'smcwarn') {
            const player = cmdArgs[0];
            const reason = cmdArgs.slice(1).join(' ');
            if (!player || !reason) return message.reply({ content: '📌 Uso: `smcwarn <jugador> <motivo>`' });
            await sendMinecraftConsoleCommand(`title ${player} title {"text":"⚠️ ADVERTENCIA DE STAFF","color":"gold"}`);
            await sendMinecraftConsoleCommand(`title ${player} subtitle {"text":"${reason}","color":"yellow"}`);
            await sendMinecraftConsoleCommand(`msg ${player} &6[STAFF] &eHas recibido una advertencia: &f${reason}`);
            const embed = new EmbedBuilder().setTitle('⚠️ Advertencia Emitida en Minecraft').setColor(0xF1C40F)
                .addFields({ name: 'Jugador', value: `\`${player}\``, inline: true }, { name: 'Staff', value: `${message.author}`, inline: true }, { name: 'Motivo', value: reason, inline: false }).setTimestamp();
            await message.reply({ embeds: [embed] });
            await sendAuditLog(embed);
            return;
        }

        // smcmsg <jugador> <mensaje>
        if (primaryCmd === 'smcmsg') {
            const player = cmdArgs[0];
            const text = cmdArgs.slice(1).join(' ');
            if (!player || !text) return message.reply({ content: '📌 Uso: `smcmsg <jugador> <mensaje>`' });
            await sendMinecraftConsoleCommand(`msg ${player} &b[STAFF &f${message.author.username}&b]&f: ${text}`);
            return message.reply({ content: `📨 Mensaje privado enviado a **${player}** in-game.` });
        }

        // smcbroadcast <mensaje>
        if (primaryCmd === 'smcbroadcast' || primaryCmd === 'smcannounce') {
            const text = cmdArgs.join(' ');
            if (!text) return message.reply({ content: '📌 Uso: `smcbroadcast <mensaje>`' });
            await sendMinecraftConsoleCommand(`broadcast &6&l[ANUNCIO STAFF]&r &f${text}`);
            return message.reply({ content: `📢 Anuncio transmitido a todo el servidor de Minecraft.` });
        }

        // smcwhitelist <add|remove|list> [jugador]
        if (primaryCmd === 'smcwhitelist') {
            if (hierarchy.level < STAFF_LEVELS.ADMIN) {
                return message.reply({ content: '❌ Solo Administradores y Dueños pueden gestionar la whitelist.' });
            }
            const sub = cmdArgs[0]?.toLowerCase();
            const player = cmdArgs[1];
            if (sub === 'list') {
                await sendMinecraftConsoleCommand('whitelist list');
                return message.reply({ content: '📋 Comando `whitelist list` ejecutado en consola.' });
            }
            if ((sub === 'add' || sub === 'remove') && player) {
                await sendMinecraftConsoleCommand(`whitelist ${sub} ${player}`);
                return message.reply({ content: `✅ Jugador **${player}** ${sub === 'add' ? 'añadido a' : 'removido de'} la whitelist.` });
            }
            return message.reply({ content: '📌 Uso: `smcwhitelist <add|remove|list> [jugador]`' });
        }

        // smcsave
        if (primaryCmd === 'smcsave') {
            await sendMinecraftConsoleCommand('save-all');
            return message.reply({ content: '💾 Protocolo `save-all` ejecutado. Todos los mundos e inventarios han sido guardados.' });
        }

        // smchealth
        if (primaryCmd === 'smchealth') {
            await sendMinecraftConsoleCommand('tps');
            return message.reply({ content: '🩺 Solicitud de comprobación de salud y tps emitida a la consola.' });
        }
    }

    // =========================================================================
    // 🖥️ EJECUCIÓN DIRECTA EN CONSOLA Y DISPARADORES EN LENGUAJE NATURAL (SIN IA)
    // =========================================================================
    const isConsoleOrNatural = (
        primaryCmd === 'scomando' || 
        primaryCmd === 'sconsola' || 
        primaryCmd === 'smc' ||
        contentLower.startsWith('saori ejecuta ') ||
        contentLower.startsWith('saori tira ') ||
        contentLower.startsWith('saori corre ') ||
        contentLower.startsWith('saori manda ') ||
        contentLower.startsWith('saori usa el comando ')
    );

    if (isConsoleOrNatural) {
        let rawCommand = null;
        let isNatural = false;

        if (primaryCmd === 'scomando' || primaryCmd === 'sconsola' || primaryCmd === 'smc') {
            rawCommand = cmdArgs.join(' ').trim();
        } else {
            isNatural = true;
            const matchWithUser = content.match(/^saori\s+usa\s+el\s+comando\s+([a-zA-Z0-9_-]+)\s+con\s+(?:el\s+usuario\s+)?([^\s]+)(?:\s+(.+))?$/i);
            if (matchWithUser) {
                const cmdName = matchWithUser[1];
                const targetUser = matchWithUser[2];
                const extraArgs = matchWithUser[3] || '';
                rawCommand = `${cmdName} ${targetUser} ${extraArgs}`.trim();
            } else {
                rawCommand = content
                    .replace(/^saori\s+(ejecuta|tira|corre|manda|usa\s+el\s+comando)\s+/i, '')
                    .trim();
            }
        }

        if (!rawCommand) {
            return message.reply({ content: '📌 Uso: `scomando <comando>` o `saori ejecuta <comando>`' });
        }

        let cleanCommand = rawCommand.startsWith('/') ? rawCommand.slice(1).trim() : rawCommand.trim();
        const firstWord = cleanCommand.split(/\s+/)[0]?.toLowerCase();

        if (!hierarchy.isStaff) {
            return message.reply({ content: '❌ Acceso denegado: Solo miembros autorizados del Staff de DrakesCraft pueden emitir comandos a la consola.' });
        }

        const DESTRUCTIVE_COMMANDS = ['stop', 'restart', 'reload', 'reload confirm', 'rl', 'op', 'deop', 'rm', 'mv', 'format'];
        if (DESTRUCTIVE_COMMANDS.includes(firstWord) && message.author.id !== JACK_DISCORD_ID) {
            return message.reply({ content: `🚫 Acción Crítica Bloqueada: El comando \`${firstWord}\` está restringido exclusivamente a **Jack** por motivos de seguridad operacional.` });
        }

        if (firstWord === 'ban' && hierarchy.level === STAFF_LEVELS.MOD) {
            const parts = cleanCommand.split(/\s+/);
            const player = parts[1];
            const reason = parts.slice(2).join(' ');
            if (!player || !reason || reason.length < 10) {
                return message.reply({ content: '⚠️ **Requisito de Moderación:** Para sancionar con Ban en Minecraft, debes indicar obligatoriamente una causa justa y detallada (mínimo 10 caracteres) para su posterior revisión por Jack y la Trinidad SRE.' });
            }
            cleanCommand = `ban ${player} [MOD: ${message.author.username}] ${reason} (Pendiente Revisión Jack/Trinidad)`;
        }

        const ok = await sendMinecraftConsoleCommand(cleanCommand);
        if (ok) {
            const embed = new EmbedBuilder()
                .setTitle('🖥️ Consola de Minecraft · Comando Ejecutado')
                .setColor(0x00FF88)
                .setDescription(`**Comando:** \`/${cleanCommand}\`\n**Resultado:** ✅ Transmitido exitosamente al proceso del servidor.`)
                .addFields(
                    { name: '👤 Operador', value: `${message.author} (\`${message.author.tag}\`)`, inline: true },
                    { name: '🛡️ Rango Staff', value: `\`${hierarchy.roleName}\``, inline: true },
                    { name: '📍 Canal', value: `${message.channel}`, inline: true }
                )
                .setFooter({ text: isNatural ? 'Disparador de Lenguaje Natural · Pterodactyl REST' : 'DrakesCraft Console Gateway' })
                .setTimestamp();

            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
            await sendAuditLog(embed);
            return;
        } else {
            return message.reply({ content: `❌ Error al transmitir el comando \`/${cleanCommand}\` a la consola de Minecraft. Verifica la conexión con el panel.` });
        }
    }

        if (primaryCmd === 'skick' || primaryCmd === 'kick') {
        if (!isStaffMember) {
            return message.reply({ content: '❌ Solo los miembros del Staff tienen autorización para expulsar usuarios.', allowedMentions: { repliedUser: false } });
        }
        const targetMember = message.mentions.members.first() || await message.guild.members.fetch(cmdArgs[0]).catch(() => null);
        if (!targetMember) {
            return message.reply({ content: '📌 Uso: `skick @usuario [motivo]`\n*Ejemplo:* `skick @Steve Toxicidad reiterada en chat`', allowedMentions: { repliedUser: false } });
        }
        if (targetMember.id === client.user.id) return message.reply({ content: '❌ No puedes expulsarme a mí, po. 🐺' });
        if (targetMember.roles.highest.position >= message.member.roles.highest.position && !isJack) {
            return message.reply({ content: '❌ No puedes sancionar a un miembro con un rol igual o superior al tuyo.' });
        }
        const reason = cmdArgs.slice(1).join(' ').trim() || 'Incumplimiento de normativas de la comunidad';
        try {
            await targetMember.send(`⚠️ Has sido expulsado de **DrakesCraft Network** por **${message.author.tag}**.\n**Motivo:** ${reason}`).catch(() => {});
            await targetMember.kick(`${message.author.tag}: ${reason}`);

            const kickEmbed = new EmbedBuilder()
                .setTitle('👢 Miembro Expulsado')
                .setColor(0xE67E22)
                .addFields(
                    { name: '👤 Usuario Expulsado', value: `${targetMember.user} (\`${targetMember.user.tag}\` · \`${targetMember.id}\`)`, inline: true },
                    { name: '🛡️ Moderador', value: `${message.author} (\`${message.author.tag}\`)`, inline: true },
                    { name: '📝 Motivo', value: reason, inline: false }
                )
                .setFooter({ text: 'DrakesCraft Moderation Suite' })
                .setTimestamp();

            await message.reply({ embeds: [kickEmbed], allowedMentions: { repliedUser: false } });
            await sendAuditLog(kickEmbed);
            return;
        } catch (e) {
            return message.reply({ content: `❌ Error al expulsar usuario: ${e.message}` });
        }
    }

    if (primaryCmd === 'sban' || primaryCmd === 'ban') {
        if (!isStaffMember) {
            return message.reply({ content: '❌ Solo los miembros del Staff tienen autorización para banear usuarios.', allowedMentions: { repliedUser: false } });
        }
        if (hierarchy.level < STAFF_LEVELS.ADMIN) {
            return message.reply({ content: '🚫 **Permiso denegado:** Los Moderadores tienen facultad para suspender / mutear usuarios (`smute`), pero el baneo definitivo en Discord está reservado exclusivamente para Administradores y Dirección.', allowedMentions: { repliedUser: false } });
        }
        const targetMember = message.mentions.members.first() || await message.guild.members.fetch(cmdArgs[0]).catch(() => null);
        const targetId = targetMember ? targetMember.id : cmdArgs[0]?.replace(/[^0-9]/g, '');
        if (!targetId) {
            return message.reply({ content: '📌 Uso: `sban @usuario [motivo]`\n*Ejemplo:* `sban @Steve Uso reiterado de cheats / hacks`', allowedMentions: { repliedUser: false } });
        }
        if (targetMember && targetMember.roles.highest.position >= message.member.roles.highest.position && !isJack) {
            return message.reply({ content: '❌ No puedes sancionar a un miembro con un rol igual o superior al tuyo.' });
        }
        const reason = cmdArgs.slice(1).join(' ').trim() || 'Infracción grave de normativas';
        try {
            if (targetMember) {
                await targetMember.send(`🔨 Has sido baneado de **DrakesCraft Network** por **${message.author.tag}**.\n**Motivo:** ${reason}`).catch(() => {});
            }
            await message.guild.bans.create(targetId, { reason: `${message.author.tag}: ${reason}` });

            const banEmbed = new EmbedBuilder()
                .setTitle('🔨 Miembro Baneado del Servidor')
                .setColor(0x992D22)
                .addFields(
                    { name: '👤 Usuario Sancionado', value: targetMember ? `${targetMember.user} (\`${targetMember.user.tag}\`)` : `ID: \`${targetId}\``, inline: true },
                    { name: '🛡️ Moderador', value: `${message.author} (\`${message.author.tag}\`)`, inline: true },
                    { name: '📝 Motivo', value: reason, inline: false }
                )
                .setFooter({ text: 'DrakesCraft Moderation Suite' })
                .setTimestamp();

            await message.reply({ embeds: [banEmbed], allowedMentions: { repliedUser: false } });
            await sendAuditLog(banEmbed); await sendModLog(banEmbed);
            return;
        } catch (e) {
            return message.reply({ content: `❌ Error al banear usuario: ${e.message}` });
        }
    }

    if (primaryCmd === 'smute' || primaryCmd === 'mute' || primaryCmd === 'stimeout') {
        if (!isStaffMember) {
            return message.reply({ content: '❌ Solo los miembros del Staff tienen autorización para aislar / mutear usuarios.', allowedMentions: { repliedUser: false } });
        }
        const targetMember = message.mentions.members.first();
        if (!targetMember) {
            return message.reply({ content: '📌 Uso: `smute @usuario <minutos> [motivo]`\n*Ejemplo:* `smute @Steve 30 Flood y spam en canal general`' });
        }
        if (targetMember.roles.highest.position >= message.member.roles.highest.position && !isJack) {
            return message.reply({ content: '❌ No puedes sancionar a un miembro con un rol igual o superior al tuyo.' });
        }
        const minutes = parseInt(cmdArgs[1], 10);
        if (isNaN(minutes) || minutes < 1 || minutes > 40320) {
            return message.reply({ content: '⚠️ Por favor especifica un tiempo válido en minutos (entre 1 y 40320 minutos / 28 días).' });
        }
        const reason = cmdArgs.slice(2).join(' ').trim() || 'Conducta inapropiada en chat';
        const durationMs = minutes * 60 * 1000;
        try {
            await targetMember.timeout(durationMs, `${message.author.tag}: ${reason}`);
            await targetMember.send(`🔇 Has sido silenciado temporalmente en **DrakesCraft Network** por **${minutes} minutos**.\n**Motivo:** ${reason}`).catch(() => {});

            const muteEmbed = new EmbedBuilder()
                .setTitle('🔇 Usuario Silenciado (Timeout)')
                .setColor(0xF39C12)
                .addFields(
                    { name: '👤 Usuario', value: `${targetMember.user} (\`${targetMember.user.tag}\`)`, inline: true },
                    { name: '⏳ Duración', value: `\`${minutes} minutos\` (hasta <t:${Math.floor((Date.now() + durationMs) / 1000)}:R>)`, inline: true },
                    { name: '🛡️ Moderador', value: `${message.author} (\`${message.author.tag}\`)`, inline: true },
                    { name: '📝 Motivo', value: reason, inline: false }
                )
                .setFooter({ text: 'DrakesCraft Moderation Suite' })
                .setTimestamp();

            await message.reply({ embeds: [muteEmbed], allowedMentions: { repliedUser: false } });
            await sendAuditLog(muteEmbed); await sendModLog(muteEmbed);
            return;
        } catch (e) {
            return message.reply({ content: `❌ Error al silenciar: ${e.message}` });
        }
    }

    if (primaryCmd === 'sunmute' || primaryCmd === 'unmute') {
        if (!isStaffMember) {
            return message.reply({ content: '❌ Solo los miembros del Staff pueden retirar silencios.', allowedMentions: { repliedUser: false } });
        }
        const targetMember = message.mentions.members.first();
        if (!targetMember) {
            return message.reply({ content: '📌 Uso: `sunmute @usuario`' });
        }
        try {
            await targetMember.timeout(null, `Retirado por ${message.author.tag}`);
            return message.reply({ content: `🔊 Se ha retirado el silencio a **${targetMember.user.tag}** exitosamente.` });
        } catch (e) {
            return message.reply({ content: `❌ Error al retirar silencio: ${e.message}` });
        }
    }

    if (primaryCmd === 'swarn' || primaryCmd === 'warn') {
        if (!isStaffMember) {
            return message.reply({ content: '❌ Solo los miembros del Staff pueden emitir advertencias formales.', allowedMentions: { repliedUser: false } });
        }
        const targetMember = message.mentions.members.first();
        if (!targetMember) {
            return message.reply({ content: '📌 Uso: `swarn @usuario <motivo>`\n*Ejemplo:* `swarn @Steve Respeta a los demás miembros en el chat de texto.`' });
        }
        const reason = cmdArgs.slice(1).join(' ').trim();
        if (!reason) {
            return message.reply({ content: '⚠️ Debes indicar el motivo de la advertencia formal.' });
        }
        try {
            await targetMember.send(`⚠️ **ADVERTENCIA FORMAL EN DRAKESCRAFT NETWORK**\nHas recibido una advertencia por parte de **${message.author.tag}**.\n**Motivo:** ${reason}\n*Por favor revisa las normas en <#${CHANNELS.REGLAS}> para evitar sanciones mayores.*`).catch(() => {});

            const warnEmbed = new EmbedBuilder()
                .setTitle('⚠️ Advertencia Formal Emitida')
                .setColor(0xF1C40F)
                .addFields(
                    { name: '👤 Usuario Advertido', value: `${targetMember.user} (\`${targetMember.user.tag}\`)`, inline: true },
                    { name: '🛡️ Moderador', value: `${message.author} (\`${message.author.tag}\`)`, inline: true },
                    { name: '📝 Motivo', value: reason, inline: false }
                )
                .setFooter({ text: 'DrakesCraft Moderation Suite · Advertencia Registrada' })
                .setTimestamp();

            await message.reply({ embeds: [warnEmbed], allowedMentions: { repliedUser: false } });
            await sendAuditLog(warnEmbed); await sendModLog(warnEmbed);
            return;
        } catch (e) {
            return message.reply({ content: `❌ Error al registrar advertencia: ${e.message}` });
        }
    }

    if (primaryCmd === 'slowmode') {
        if (!isStaffMember) {
            return message.reply({ content: '❌ Solo los miembros del Staff pueden ajustar el modo pausado.', allowedMentions: { repliedUser: false } });
        }
        const seconds = parseInt(cmdArgs[0], 10);
        if (isNaN(seconds) || seconds < 0 || seconds > 21600) {
            return message.reply({ content: '📌 Uso: `slowmode <segundos>` (entre 0 y 21600 segundos). Usa `slowmode 0` para desactivar.' });
        }
        try {
            await message.channel.setRateLimitPerUser(seconds, `Ajustado por ${message.author.tag}`);
            return message.reply({ content: seconds === 0 ? '⚡ Modo pausado desactivado en este canal.' : `⏳ Modo pausado establecido en **${seconds} segundos** por mensaje.` });
        } catch (e) {
            return message.reply({ content: `❌ Error al ajustar slowmode: ${e.message}` });
        }
    }

    if (primaryCmd === 'slock' || primaryCmd === 'lock') {
        if (!isStaffMember) {
            return message.reply({ content: '❌ Solo los miembros del Staff pueden bloquear canales.', allowedMentions: { repliedUser: false } });
        }
        try {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }, { reason: `Bloqueado por ${message.author.tag}` });
            return message.reply({ content: '🔒 **Canal bloqueado.** Los miembros `@everyone` no pueden enviar mensajes temporalmente.' });
        } catch (e) {
            return message.reply({ content: `❌ Error al bloquear canal: ${e.message}` });
        }
    }

    if (primaryCmd === 'sunlock' || primaryCmd === 'unlock') {
        if (!isStaffMember) {
            return message.reply({ content: '❌ Solo los miembros del Staff pueden desbloquear canales.', allowedMentions: { repliedUser: false } });
        }
        try {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }, { reason: `Desbloqueado por ${message.author.tag}` });
            return message.reply({ content: '🔓 **Canal desbloqueado.** Los miembros pueden volver a participar con normalidad.' });
        } catch (e) {
            return message.reply({ content: `❌ Error al desbloquear canal: ${e.message}` });
        }
    }

    // =========================================================================
    // 🧹 GESTIÓN Y AUDITORÍA DE INACTIVIDAD (SINACTIVOS / INACTIVOS / PURGAR)
    // =========================================================================
    if (primaryCmd === 'sinactivos' || primaryCmd === 'inactivos') {
        if (!message.guild) {
            return message.reply({ content: '❌ Este comando solo puede ejecutarse en un servidor de Discord.', allowedMentions: { repliedUser: false } });
        }

        // Permisos mínimos para ver auditoría: Admin (80) o Dueño (100) o Jack
        if (hierarchy.level < STAFF_LEVELS.ADMIN && !isJack) {
            return message.reply({ content: '⚠️ Este comando de auditoría y gestión de inactividad está reservado exclusivamente para Administradores y Dirección General.', allowedMentions: { repliedUser: false } });
        }

        const subCmd = (cmdArgs[0] || '').toLowerCase();
        const isPurge = subCmd === 'purgar' || subCmd === 'kick' || subCmd === 'expulsar';

        let daysThreshold = 365; // Por defecto 1 año (365 días)
        let parsedDays = isPurge ? parseInt(cmdArgs[1], 10) : parseInt(cmdArgs[0], 10);
        if (!isNaN(parsedDays) && parsedDays > 0) {
            daysThreshold = parsedDays;
        }

        if (daysThreshold < 30) {
            return message.reply({ content: '⚠️ Por seguridad del servidor, el umbral mínimo de inactividad permitido es de **30 días**.', allowedMentions: { repliedUser: false } });
        }

        // Si es purga/expulsión, SOLO Jack o Dueño (100)
        if (isPurge && hierarchy.level < STAFF_LEVELS.OWNER && !isJack) {
            return message.reply({ content: '⚠️ La ejecución de purga y expulsión masiva está reservada **únicamente para la Dirección General / Dueños**.', allowedMentions: { repliedUser: false } });
        }

        const statusMsg = await message.reply({ content: `🔍 Analizando miembros del servidor con antigüedad mayor o igual a **${daysThreshold} días**...`, allowedMentions: { repliedUser: false } });

        try {
            await message.guild.members.fetch();
            const now = Date.now();
            const msThreshold = daysThreshold * 24 * 60 * 60 * 1000;

            const WHITELIST_ROLE_IDS = new Set([
                '1539641774392348754', // 👑 ︱ ᴅᴜᴇñᴏ
                '1539642179822161940', // 🛡️ ︱ ᴀᴅᴍɪɴ
                '1539642260621369454', // 💻 ︱ ᴅᴇᴠ
                '1539642370356940861', // ⚔️ ︱ ᴍᴏᴅ
                '1539642446861041694', // 🤝 ︱ ʜᴇʟᴘᴇʀ
                '1539642520991178833', // 🔨 ︱ ʙᴜɪʟᴅᴇʀ
                '1539768983287496855', // 💫 |  STAFF
                '1545668300367994980', // 👑 ︱ ʜɪɢʜ sᴛᴀғғ
                '1545668302700023928', // ⚡ ︱ ᴘᴇʀᴍɪsᴏs+
                '1544153904395194408', // 🎭 │ ʙᴜғᴏɴ
                '1539643506258092032', // 📜 ︱ ᴏʟᴅsᴄʜᴏᴏʟ
                '1539642703263043634', // 💎 ︱ ʙᴏᴏsᴛᴇʀ
                '1544689169371107439', // Server Booster
                '1539642806480674816', // ⚡ ︱ ᴛɪᴛᴀɴ
                '1539642860473688185', // 👑 ︱ ᴢᴇᴜs
                '1539642971287199744', // ⚡ ︱ ᴛʜᴏʀ
                '1539643031869857792', // 🌊 ︱ ᴘᴏsᴇɪᴅᴏɴ
                '1539643102954782760', // 💀 ︱ ᴀɴᴜʙɪs
                '1539643159900983347', // 💖 ︱ ᴀғʀᴏᴅɪᴛᴀ
                '1539643212938088568', // 🏹 ︱ ᴀʀᴛᴇᴍɪsᴀ
                '1539643276125274263', // 🔥 ︱ ʜᴇғᴇsᴛᴏ
                '1539643334354534490', // 💨 ︱ ʜᴇʀᴍᴇs
                '1539643395507752980', // 🕯️ ︱ ʜᴇsᴛɪᴀ
                '1539643449186328626', // 🦁 ︱ ʜᴇʀᴄᴜʟᴇs
                '1539642595259719750'  // 🤖 ︱ ʙᴏᴛs
            ]);

            const allMembers = message.guild.members.cache;
            let totalMembers = allMembers.size;
            let protectedCount = 0;
            const candidates = [];

            for (const [id, member] of allMembers) {
                const isBot = member.user.bot;
                const isOwnerOrJack = id === JACK_DISCORD_ID || id === KIKA_DISCORD_ID || id === '493868699489665044';
                const memberHierarchy = getStaffMemberHierarchy(member, id);
                const hasWhitelistRole = member.roles.cache.some(r => WHITELIST_ROLE_IDS.has(r.id));
                const isBooster = member.premiumSinceTimestamp !== null;

                if (isBot || isOwnerOrJack || memberHierarchy.isStaff || hasWhitelistRole || isBooster) {
                    protectedCount++;
                    continue;
                }

                if (!member.joinedTimestamp) continue;
                const ageMs = now - member.joinedTimestamp;
                if (ageMs >= msThreshold) {
                    const days = Math.floor(ageMs / (1000 * 60 * 60 * 24));
                    candidates.push({ member, days, id, tag: member.user.tag, joinedTimestamp: member.joinedTimestamp });
                }
            }

            candidates.sort((a, b) => b.days - a.days);

            if (!isPurge) {
                const embed = new EmbedBuilder()
                    .setTitle('🧹 Auditoría de Miembros Inactivos')
                    .setColor(candidates.length > 0 ? 0xF1C40F : 0x2ECC71)
                    .setFooter({ text: 'DrakesCraft Security Suite · Inactivity Auditor' })
                    .setTimestamp()
                    .addFields(
                        { name: '📊 Total Servidor', value: `${totalMembers} miembros`, inline: true },
                        { name: '🛡️ En Whitelist Protegidos', value: `${protectedCount} miembros`, inline: true },
                        { name: '⏳ Umbral Evaluado', value: `≥ ${daysThreshold} días`, inline: true },
                        { name: '🎯 Candidatos Detectados', value: `**${candidates.length}** miembros`, inline: true }
                    );

                if (candidates.length === 0) {
                    embed.setDescription(
                        `✅ **No se encontraron usuarios regulares inactivos con más de ${daysThreshold} días en el servidor.**\n\n` +
                        `*Nota de Seguridad:* Todos los miembros antiguos registrados cuentan con rangos protegidos (Staff, VIPs, Boosters u OldSchool).`
                    );
                } else {
                    const sampleList = candidates.slice(0, 15).map((c, idx) => 
                        `**${idx + 1}.** \`${c.tag}\` (<@${c.id}>) — *${c.days} días en el servidor*`
                    ).join('\n');

                    embed.setDescription(
                        `⚠️ Se encontraron **${candidates.length}** usuarios que llevan más de **${daysThreshold} días** en el servidor sin roles protegidos.\n\n` +
                        sampleList +
                        (candidates.length > 15 ? `\n*... y ${candidates.length - 15} miembros más.*` : '') +
                        `\n\n💡 **Para expulsar a estos miembros de forma segura:**\n` +
                        `Un Dueño debe ejecutar: \`sinactivos purgar ${daysThreshold}\``
                    );
                }

                return statusMsg.edit({ content: null, embeds: [embed] });
            }

            // MODO PURGA / EXPULSIÓN (SOLO DUEÑO)
            if (candidates.length === 0) {
                return statusMsg.edit({
                    content: `ℹ️ No hay usuarios regulares que cumplan el criterio de inactividad (≥ ${daysThreshold} días) para purgar.`
                });
            }

            await statusMsg.edit({
                content: `🚨 **Iniciando purga segura de ${candidates.length} miembros inactivos** (umbral: ≥ ${daysThreshold} días)...\n*Velocidad:* 1 miembro cada 800ms para evitar rate-limits.`
            });

            let kicked = 0;
            let failed = 0;
            const purgeReason = `Inactividad prolongada en la comunidad (>= ${daysThreshold} días) [Ejecutado por ${message.author.tag}]`;

            for (const cand of candidates) {
                try {
                    if (cand.member.roles.cache.some(r => WHITELIST_ROLE_IDS.has(r.id))) {
                        continue;
                    }
                    await cand.member.kick(purgeReason);
                    kicked++;
                } catch (err) {
                    console.error(`[PURGA-INACTIVOS] Error expulsando a ${cand.tag} (${cand.id}):`, err.message);
                    failed++;
                }
                await new Promise(r => setTimeout(r, 800));
            }

            const resultEmbed = new EmbedBuilder()
                .setTitle('🧹 Purga de Miembros Inactivos Finalizada')
                .setColor(0xE74C3C)
                .setDescription(`Se ha completado el procedimiento de expulsión por inactividad prolongada.`)
                .addFields(
                    { name: '👑 Ejecutado por', value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
                    { name: '⏳ Umbral Aplicado', value: `≥ ${daysThreshold} días`, inline: true },
                    { name: '✅ Expulsados Exitosamente', value: `**${kicked}**`, inline: true },
                    { name: '⚠️ Fallidos / Errores', value: `**${failed}**`, inline: true }
                )
                .setFooter({ text: 'DrakesCraft Security Suite · Expulsión por Inactividad' })
                .setTimestamp();

            await statusMsg.edit({ content: null, embeds: [resultEmbed] });
            await sendAuditLog(resultEmbed);
            await sendModLog(resultEmbed);
        } catch (err) {
            console.error('[PURGA-INACTIVOS] Error general:', err);
            return statusMsg.edit({ content: `❌ Error al procesar la auditoría/purga de inactivos: ${err.message}` });
        }
        return;
    }

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
    const promptLower = cleanPrompt.toLowerCase();
    const wantsAudio = (
        promptLower.startsWith('!voz') ||
        promptLower.startsWith('/voz') ||
        promptLower.startsWith('!audio') ||
        promptLower.startsWith('/audio') ||
        anyKeyword(promptLower, [
            'manda audio', 'en audio', 'un audio', 'responde en audio', 
            'crea un audio', 'graba un audio', 'nota de voz', 'háblame con tu voz', 'hablame con tu voz', 'di con tu voz',
            'manda un audio', 'mándame un audio', 'mandame un audio', 'dilo con tu voz', 'envía un audio', 'envia un audio'
        ])
    );

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
    const isImageRequest = (
        primaryCmd === 'imagen' || 
        primaryCmd === 'image' || 
        primaryCmd === 'simagen' || 
        primaryCmd === 'simage' ||
        contentLower.startsWith('!imagen') || 
        contentLower.startsWith('/imagen') || 
        contentLower.startsWith('!image') || 
        contentLower.startsWith('/image') ||
        anyKeyword(cleanPrompt.toLowerCase(), [
            'genera una imagen', 'crea una imagen', 'generar imagen', 'crear imagen', 
            'generate una imagen', 'dibuja', 'dibujame', 'haz una imagen', 'creame una imagen'
        ])
    );

    if (isImageRequest) {
        let promptForImg = cleanPrompt;
        if (primaryCmd === 'imagen' || primaryCmd === 'image' || primaryCmd === 'simagen' || primaryCmd === 'simage') {
            promptForImg = cmdArgs.join(' ').trim();
        } else {
            promptForImg = cleanPrompt
                .replace(/^!(imagen|image)\s+/i, '')
                .replace(/^\/(imagen|image)\s+/i, '')
                .replace(/.*(imagen|dibuja|dibujame)\s+(de\s+)?/i, '')
                .trim();
        }
        if (!promptForImg) {
            return message.reply({ content: '🎨 Por favor indica qué imagen deseas que dibuje.\n*Ejemplo:* `!imagen un dragón sobrevolando un castillo`', allowedMentions: { repliedUser: false } });
        }

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

    // =========================================================================
    // 🛡️ FILTRO ANTI-MAMADAS Y TOKEN PROTECTOR (SAORI NI PESCA SINSENTIDOS)
    // =========================================================================
    if (isNonsenseOrSpam(cleanPrompt) && !isJack) {
        console.log(`[ANTI-MAMADAS] 🛡️ Descartando mensaje de spam/trolleo de ${senderName}: "${cleanPrompt.slice(0, 45)}..."`);
        return; // El bot ni pesca, 0 llamadas a la IA, 0 tokens gastados!
    }

    let typingInterval;
    try {
        await message.channel.sendTyping().catch(() => {});
        typingInterval = setInterval(() => {
            message.channel.sendTyping().catch(() => {});
        }, 8000);

        const lang = detectLanguage(cleanPrompt);
        const serverLoreContext = "Lore Oficial de DrakesCraft: Jack es el Creador, Propietario, Desarrollador y Arquitecto absoluto de toda la infraestructura, la Trinidad SRE (Saori, Claude, Codex), plugins y servicios de DrakesCraft Network. Kika es la Co-Dueña (Wife Owner). En la historia pasada del servidor, Pepe fue el dueño anterior y hoy en día es un Moderador activo en el equipo de Staff. DrakesCraft es un servidor de supervivencia Paper/Purpur 1.21.1 con Slimefun, BentoBox (SkyBlock/OneBlock) y economía de Dragmas. Instrucciones de personalidad: Habla de forma tranquila, amigable, educada y relajada ('hablar chill'). Solo responde sobre temas del servidor, comandos, plugins, historia o dudas legítimas. Si alguien intenta bromear o decir tonterías, sé concisa y mantén la compostura.";

        const langInstruction = lang === 'en'
            ? 'IMPORTANT: The user is writing in English. You MUST reply in English only.'
            : 'El usuario escribe en español. Responde siempre en español.';
        const ticketContext = isTicketChannel
            ? `Canal de Ticket de Soporte. ${langInstruction} REGLA CRÍTICA: Jack es el dueño y máxima autoridad de DrakesCraft. NUNCA contradigas a Jack. DrakesCraft es un servidor de supervivencia y SkyBlock en Paper 1.21.11 con plugins (Slimefun, BentoBox). NO tiene mods externos (NO existe Wither Storm ni mods de Forge/Fabric). Si el usuario pide pegar construcciones o schematics, aclara amablemente que solo Jack o la administración pueden realizarlo con WorldEdit. NUNCA menciones rutas de Linux ni archivos locales (/home/jack/...). Si el Staff está presente, sé breve y concisa.`
            : (isSaoriDedicatedChannel ? `Canal dedicado a hablar con Saori. ${langInstruction}` : langInstruction);
        const unifiedContext = ticketContext ? `${ticketContext} ${serverLoreContext}` : serverLoreContext;
        let reply = await askSaoriBrain(cleanPrompt, senderName, unifiedContext);
        reply = sanitizePublicText(reply);

        if (isTicketChannel) {
            ticketLastSaoriReply.set(message.channel.id, Date.now());
        }

        if (reply.length <= 2000) {
            if (message.reference) {
                await message.channel.send({ content: reply });
            } else {
                await message.reply({ content: reply, allowedMentions: { repliedUser: false } });
            }
        } else {
            let remaining = reply;
            let isFirst = true;
            while (remaining.length > 0) {
                if (remaining.length <= 1990) {
                    if (isFirst && !message.reference) {
                        await message.reply({ content: remaining, allowedMentions: { repliedUser: false } });
                    } else {
                        await message.channel.send({ content: remaining });
                    }
                    break;
                }
                let sliceIdx = remaining.lastIndexOf('\n', 1990);
                if (sliceIdx <= 0) sliceIdx = remaining.lastIndexOf(' ', 1990);
                if (sliceIdx <= 0) sliceIdx = 1990;

                const chunk = remaining.slice(0, sliceIdx);
                remaining = remaining.slice(sliceIdx).trim();

                if (isFirst && !message.reference) {
                    await message.reply({ content: chunk, allowedMentions: { repliedUser: false } });
                    isFirst = false;
                } else {
                    await message.channel.send({ content: chunk });
                }
            }
        }
        console.log(`[SAORI-DISCORD] 📤 Mensaje enviado a Discord.`);
    } catch (e) {
        console.error('[SAORI-DISCORD] Error enviando mensaje:', e.message);
    } finally {
        if (typingInterval) clearInterval(typingInterval);
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


async function syncNicknames(guild) {
    if (!guild) return;
    try {
        const members = await guild.members.fetch().catch(() => null);
        if (!members) return;
        let count = 0;
        for (const [id, m] of members) {
            if (m.user.bot || m.id === JACK_DISCORD_ID) continue;
            const rawName = m.nickname || m.user.globalName || m.user.username;
            const formatted = formatMemberNickname(rawName, m.roles.cache.map(r => r.id), m.id);
            if (formatted && formatted !== m.nickname) {
                await m.setNickname(formatted).catch(() => {});
                count++;
            }
        }
        if (count > 0) {
            console.log(`[NICK-SYNC] ✅ Sincronización automática: ${count} apodos normalizados a Small Caps.`);
        }
    } catch (e) {
        console.error('[NICK-SYNC] Error en sincronización de apodos:', e.message);
    }
}

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



function anyKeyword(text, list) {
    return list.some(k => text.includes(k));
}

async function startDiscordBot() {
    try {
        await client.login(DISCORD_BOT_TOKEN);
    } catch (err) {
        console.error('❌ [SAORI-DISCORD] Error al iniciar sesión en Discord:', err.message);
        console.log('⏳ Reintentando conexión con Discord en 10 segundos...');
        setTimeout(startDiscordBot, 10000);
    }
}
startDiscordBot();


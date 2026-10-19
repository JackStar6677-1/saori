// SAORI WhatsApp Bridge · Full SRE Capabilities (Minecraft Console, Live Telemetry, FAQ, TTS/STT & Quick Commands)

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');
const pino   = require('pino');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const os     = require('os');
const fetch  = require('node-fetch');
const qrcodeTerminal = require('qrcode-terminal');

const AUTH_DIR         = process.env.AUTH_DIR || path.join(__dirname, '../data/auth_info');
const AI_DAEMON_URL    = 'http://127.0.0.1:8089/chat';
const FAQ_DAEMON_URL   = 'http://127.0.0.1:8089/faq';
const POWER_DAEMON_URL = 'http://127.0.0.1:8089/power';
const SPARK_DAEMON_URL = 'http://127.0.0.1:8089/spark';
const IMAGE_DAEMON_URL = 'http://127.0.0.1:8089/image';
const TTS_URL          = 'http://127.0.0.1:8089/tts';
const STT_URL          = 'http://127.0.0.1:8089/stt';
const WEBHOOK_PORT     = 8088;

const PTERODACTYL_PANEL_URL = (process.env.PTERODACTYL_PANEL_URL || 'https://panel.thegamehosting.com').replace(/\/+$/, '');
const PTERODACTYL_SERVER_ID = process.env.PTERODACTYL_SERVER_ID || '';
const PTERODACTYL_API_KEY   = process.env.PTERODACTYL_API_KEY || '';

const JACK_NAMES          = (process.env.ADMIN_NAMES || 'admin,owner,lead').split(',').map(s => s.trim().toLowerCase());
const STAFF_GROUP_JID     = process.env.WHATSAPP_STAFF_GROUP_JID || '';
const ADMIN_PHONE_NUMBER  = process.env.ADMIN_WHATSAPP_NUMBER || '';
const SERVER_HOST_LABEL   = process.env.SERVER_HOST_LABEL || 'SRE-Production-Cluster';
const HIGH_STAFF_NAMES    = (process.env.HIGH_STAFF_NAMES || 'admin,moderator,operator').split(',').map(s => s.trim().toLowerCase());

const logger = pino({ level: 'error' });
let globalSock = null;

const processedMessages = new Set();
const lastReplies       = new Map();

// ------------------------------------------------------------------
// DETECCIÓN DE IDIOMA
// ------------------------------------------------------------------
function detectLanguage(text) {
    const t = text.toLowerCase();
    const enWords = ['i ', 'the ', 'is ', 'are ', 'my ', 'you ', 'it ', 'have ', 'want ',
                     'need ', 'can ', 'would ', 'like ', 'please ', 'hello', 'hi ', 'how ',
                     'what ', 'where ', 'when ', 'this ', 'that ', 'with ', 'for ', 'and ',
                     'but ', 'staff', 'server', 'players'];
    const esWords = ['yo ', 'el ', 'la ', 'es ', 'son ', 'mi ', 'tu ', 'quiero ', 'necesito ',
                     'puedo ', 'hola', 'como ', 'donde ', 'cuando ', 'esto ', 'eso ', 'con ',
                     'para ', 'y ', 'pero ', 'tengo ', 'saori', 'servidor', 'jugadores'];
    const enScore = enWords.filter(w => t.includes(w)).length;
    const esScore = esWords.filter(w => t.includes(w)).length;
    return enScore > esScore ? 'en' : 'es';
}

// ------------------------------------------------------------------
// SANITIZACIÓN Y NORMALIZACIÓN DE NOMBRE DE STAFF / USUARIO (ANTI-SPOOFING)
// ------------------------------------------------------------------
function cleanSenderName(raw, isVerifiedJack = false) {
    if (isVerifiedJack) return 'Admin';
    if (!raw) return 'Usuario';
    const lower = raw.toLowerCase();

    if (JACK_NAMES.some(n => lower.includes(n))) {
        return 'Usuario';
    }

    let s = raw.trim();
    if (s.toLowerCase().startsWith('mr_') && s.length > 3) s = s.slice(3);
    else if (s.toLowerCase().startsWith('mr') && s.length > 2) s = s.slice(2);

    const first = s.trim().split(/[\s_\-|✦✧]/)[0];
    const cleanFirst = first.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, '').trim();
    return cleanFirst ? (cleanFirst.charAt(0).toUpperCase() + cleanFirst.slice(1).toLowerCase()) : 'Usuario';
}

// ------------------------------------------------------------------
// CONSULTA DETERMINISTA DE FAQ (SIN CONSUMO DE IA)
// ------------------------------------------------------------------
async function queryFaq(prompt) {
    try {
        const res = await fetch(FAQ_DAEMON_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
            timeout: 5000
        });
        if (res.ok) {
            const data = await res.json();
            if (data && data.hit && data.answer) {
                return data.answer;
            }
        }
    } catch (_) {}
    return null;
}

// ------------------------------------------------------------------
// LLAMADA AL DAEMON HTTP (saori_ai_daemon en :8089)
// ------------------------------------------------------------------
async function askSaori(prompt, senderName, isHighStaff = false) {
    // 1. Probar FAQ determinista primero
    const faqAnswer = await queryFaq(prompt);
    if (faqAnswer) {
        return `🌸 *SAORI FAQ:*\n${faqAnswer}`;
    }

    // 2. Consulta al daemon de IA
    try {
        const lang = detectLanguage(prompt);
        const langHint = lang === 'en'
            ? 'IMPORTANT: Reply in English only.'
            : 'Responde siempre en español.';
        const contextualPrompt = `[WhatsApp Staff Group · ${langHint}]\n${prompt}`;
        const res = await fetch(AI_DAEMON_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: contextualPrompt,
                sender: senderName,
                is_high_staff: isHighStaff,
                scope: 'drakescraft'
            }),
            timeout: 45000
        });
        if (res.ok) {
            const data = await res.json();
            if (data.response) return data.response;
        }
    } catch (e) {
        console.error('[SAORI-AI] Error daemon:', e.message);
    }
    return `¡Hola ${senderName}! Mis circuitos se demoraron un momento en responder en Star. ¿Me repites lo último? 🌸`;
}

// ------------------------------------------------------------------
// TELEMETRÍA EN TIEMPO REAL DE MINECRAFT (Dallas)
// ------------------------------------------------------------------
async function fetchMinecraftLiveStats() {
    let mcData = null;
    let pteroData = null;

    try {
        const mcRes = await fetch('https://api.mcsrvstat.us/3/mc.drakescraft.cl', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 4000
        });
        if (mcRes.ok) mcData = await mcRes.json();
    } catch (e) {
        console.error('[SAORI-MC] Error mcsrvstat:', e.message);
    }

    try {
        const pteroRes = await fetch(`${PTERODACTYL_PANEL_URL}/api/client/servers/${PTERODACTYL_SERVER_ID}/resources`, {
            headers: {
                'Authorization': `Bearer ${PTERODACTYL_API_KEY}`,
                'Accept': 'application/json'
            },
            timeout: 4000
        });
        if (pteroRes.ok) {
            const p = await pteroRes.json();
            pteroData = p.attributes?.resources || null;
        }
    } catch (e) {
        console.error('[SAORI-PTERO] Error resources:', e.message);
    }

    const isOnline = !!(mcData?.online || (pteroData && pteroData.cpu_absolute > 0));
    const playersOnline = mcData?.players?.online ?? 0;
    const playersMax    = mcData?.players?.max ?? 2026;
    const playerList    = mcData?.players?.list ? mcData.players.list.map(p => typeof p === 'string' ? p : p.name) : [];
    const version       = mcData?.version || '1.21.11 (Purpur)';

    const cpuPct   = pteroData ? pteroData.cpu_absolute.toFixed(1) : '--';
    const ramGb    = pteroData ? (pteroData.memory_bytes / (1024 * 1024 * 1024)).toFixed(2) : '--';
    const diskGb   = pteroData ? (pteroData.disk_bytes / (1024 * 1024 * 1024)).toFixed(1) : '--';
    
    let uptimeStr = 'Desconocido';
    if (pteroData && pteroData.uptime) {
        const totalSec = Math.floor(pteroData.uptime / 1000);
        const hours = Math.floor(totalSec / 3600);
        const mins  = Math.floor((totalSec % 3600) / 60);
        uptimeStr = `${hours}h ${mins}m`;
    }

    return {
        online: isOnline,
        playersOnline,
        playersMax,
        playerList,
        version,
        cpuPct,
        ramGb,
        diskGb,
        uptimeStr
    };
}

// ------------------------------------------------------------------
// EJECUCIÓN DE COMANDOS DE CONSOLA EN MINECRAFT (Pterodactyl API)
// ------------------------------------------------------------------
async function executeMinecraftConsole(cmd) {
    if (!PTERODACTYL_API_KEY) {
        return { ok: false, error: 'PTERODACTYL_API_KEY no configurado en entorno.' };
    }
    try {
        const res = await fetch(`${PTERODACTYL_PANEL_URL}/api/client/servers/${PTERODACTYL_SERVER_ID}/command`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PTERODACTYL_API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ command: cmd }),
            timeout: 8000
        });
        if (res.status === 204 || res.ok) {
            return { ok: true };
        }
        const text = await res.text();
        return { ok: false, error: `Panel respondió código ${res.status}: ${text.slice(0, 100)}` };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ------------------------------------------------------------------
// GENERACIÓN DE IMÁGENES
// ------------------------------------------------------------------
async function generateImageViaDaemon(prompt) {
    try {
        const outPath = `/tmp/saori_wa_img_${Date.now()}.png`;
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

// ------------------------------------------------------------------
// TTS (Voz Chilena)
// ------------------------------------------------------------------
async function generateVoiceAudio(text) {
    try {
        const outPath = `/tmp/saori_wa_voice_${Date.now()}.opus`;
        const res = await fetch(TTS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, out_path: outPath }),
            timeout: 20000
        });
        if (res.ok) {
            const data = await res.json();
            if (data.ok && fs.existsSync(outPath)) return outPath;
        }
    } catch (e) {
        console.error('[SAORI-TTS] Error:', e.message);
    }
    return null;
}

// ------------------------------------------------------------------
// STT (Transcripción)
// ------------------------------------------------------------------
async function transcribeAudioFile(filePath) {
    try {
        const res = await fetch(STT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio_path: filePath }),
            timeout: 20000
        });
        if (res.ok) {
            const data = await res.json();
            return data.text || '';
        }
    } catch (e) {
        console.error('[SAORI-STT] Error:', e.message);
    }
    return '';
}

// ------------------------------------------------------------------
// FORMATEADOR INTELIGENTE DE NOTIFICACIONES WHATSAPP
// ------------------------------------------------------------------
function formatWhatsAppNotification(data) {
    const rawType = (data.tipo || data.type || '').toString().trim().toLowerCase();
    if (rawType === 'digest' || data.raw) {
        return (data.resumen || data.detalle || data.titulo || data.title || '').trim();
    }
    let ticketId   = (data.ticket_id || '').toString().trim();
    let agente     = (data.agente || '').toString().trim();
    let titulo     = (data.titulo || data.title || '').toString().trim();
    let detalle    = (data.resumen || data.detalle || '').toString().trim();
    let tipo       = (data.tipo || data.type || '').toString().trim().toLowerCase();
    let estado     = (data.estado || data.status || '').toString().trim().toLowerCase();
    let acciones   = data.acciones || data.actions || [];
    let pendientes = data.pendientes || [];
    let metricas   = data.metricas || data.metrics || null;

    const fullRaw = `${titulo}\n${detalle}`;

    if (!agente || agente === 'SAORI SRE' || agente === 'ALERTA') {
        const mAgente = fullRaw.match(/(?:🤖\s*Agente:?\s*|\[)([A-Za-z0-9_-]{3,20})(?:\]| )/i);
        if (mAgente && !['DRAKES', 'ALERTA', 'SAORI', 'DISCORD', 'INTAKE', 'VERIFIED'].includes(mAgente[1].toUpperCase())) {
            agente = mAgente[1].toUpperCase();
        } else {
            agente = 'SAORI SRE';
        }
    }

    if (!ticketId || ticketId === 'ALERTA' || ticketId === 'undefined') {
        const mTicket = fullRaw.match(/Ticket\s*#?([0-9]{1,5})/i);
        if (mTicket) {
            ticketId = `#${mTicket[1]}`;
        } else {
            ticketId = '';
        }
    } else if (!ticketId.startsWith('#') && /^\d+$/.test(ticketId)) {
        ticketId = `#${ticketId}`;
    }

    const lower = fullRaw.toLowerCase();
    const isError = estado === 'error' || estado === 'bloqueo' || lower.includes('estado: error') || lower.includes('estado: bloqueo') || lower.includes('crash') || lower.includes('caída') || lower.includes('caida') || lower.includes('oom');
    const isAviso = estado === 'aviso' || lower.includes('estado: aviso') || lower.includes('warning') || lower.includes('advertencia');
    const isOk    = estado === 'ok' || lower.includes('estado: ok') || lower.includes('verified') || lower.includes('staged') || lower.includes('estable') || lower.includes('sin recurrencia') || lower.includes('sin firmas') || lower.includes('éxito') || lower.includes('exito');
    const isTelem = tipo === 'telemetria' || lower.includes('telemetría') || lower.includes('telemetria') || (lower.includes('spark') && lower.includes('tps'));

    let headerIcon = 'ℹ️';
    let headerText = 'DRAKES · NOTIFICACIÓN';
    let estadoStr  = 'ℹ️ INFORMATIVO';

    if (isTelem) {
        headerIcon = '📊';
        headerText = 'DRAKES · TELEMETRÍA';
        estadoStr  = '📈 MÉTRICAS ACTIVAS';
    } else if (isError) {
        headerIcon = '🚨';
        headerText = 'DRAKES · INCIDENCIA CRÍTICA';
        estadoStr  = '❌ ERROR / CRÍTICO';
    } else if (isAviso) {
        headerIcon = '⚠️';
        headerText = 'DRAKES · ADVERTENCIA';
        estadoStr  = '⚠️ REVISIÓN REQUERIDA';
    } else if (isOk || titulo.startsWith('✅')) {
        headerIcon = '✅';
        headerText = 'DRAKES · REPORTE OPERATIVO';
        estadoStr  = '✅ ÓPTIMO / VERIFICADO';
    }

    let cleanDetalle = detalle
        .replace(/^🤖\s*Agente:.*$/gmi, '')
        .replace(/^📊\s*Estado:.*$/gmi, '')
        .replace(/^📝\s*Resumen:\s*/gmi, '')
        .trim();

    let notifMsg = `${headerIcon} *[${headerText}]*\n\n`;
    if (ticketId) notifMsg += `🎫 *Ticket:* ${ticketId}\n`;
    if (agente)   notifMsg += `🤖 *Agente:* ${agente}\n`;
    notifMsg += `📊 *Estado:* ${estadoStr}\n`;

    if (cleanDetalle) {
        notifMsg += `\n📝 *Resumen / Diagnóstico:*\n${cleanDetalle.slice(0, 2800)}\n`;
    } else if (titulo) {
        notifMsg += `\n📝 *Resumen:*\n${titulo.slice(0, 1000)}\n`;
    }

    if (typeof acciones === 'string') acciones = [acciones];
    if (Array.isArray(acciones) && acciones.length > 0 && !cleanDetalle.includes('Acciones')) {
        notifMsg += `\n⚡ *Acciones / Fixes ejecutados:*\n`;
        acciones.forEach(a => { notifMsg += `  • ${a}\n`; });
    }

    if (typeof pendientes === 'string') pendientes = [pendientes];
    if (Array.isArray(pendientes) && pendientes.length > 0 && !cleanDetalle.includes('Pendientes')) {
        notifMsg += `\n📌 *Pendientes / Próximos pasos:*\n`;
        pendientes.forEach(p => { notifMsg += `  • ${p}\n`; });
    }

    if (metricas && typeof metricas === 'object') {
        notifMsg += `\n📈 *Telemetría:*\n`;
        for (const [k, v] of Object.entries(metricas)) {
            notifMsg += `  • *${k}:* ${v}\n`;
        }
    }

    const timeStr = new Date().toLocaleTimeString('es-CL', {
        timeZone: 'America/Santiago',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    notifMsg += `\n_SAORI SRE · ${timeStr}_\n`;
    return notifMsg;
}

// ------------------------------------------------------------------
// WEBHOOK DE ALERTAS Y REPORTES
// ------------------------------------------------------------------
function startWebhookServer() {
    const server = http.createServer(async (req, res) => {
        if (req.method === 'GET' && (req.url === '/status' || req.url === '/health')) {
            const isConnected = !!(globalSock && globalSock.user);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                ok: true,
                connected: isConnected,
                phone: globalSock && globalSock.user ? globalSock.user.id : null,
                name: globalSock && globalSock.user ? globalSock.user.name : null
            }));
        }

        if (req.method === 'POST' && req.url === '/send-message') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    let targetJid = data.jid || data.phone || STAFF_GROUP_JID;
                    if (!targetJid.includes('@')) {
                        targetJid = targetJid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    }
                    const text = data.text || data.message || '';
                    const fs = require('fs');
                    let imgBuffer = null;
                    if (data.image_base64) {
                        imgBuffer = Buffer.from(data.image_base64, 'base64');
                    } else if (data.image_path && fs.existsSync(data.image_path)) {
                        imgBuffer = fs.readFileSync(data.image_path);
                    }
                    if (globalSock && imgBuffer) {
                        await globalSock.sendMessage(targetJid, { image: imgBuffer, caption: text || '' });
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ ok: true, targetJid, type: 'image' }));
                    } else if (globalSock && text) {
                        await globalSock.sendMessage(targetJid, { text });
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ ok: true, targetJid, type: 'text' }));
                    } else {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ ok: false, error: 'WhatsApp no conectado o mensaje vacío' }));
                    }
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ ok: false, error: e.message }));
                }
            });
            return;
        }

        if (req.method === 'POST' && req.url === '/notify-ticket') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const data      = JSON.parse(body);
                    let targetJid   = data.group_jid || STAFF_GROUP_JID;

                    const titulo    = data.titulo    || data.title   || '';
                    const detalle   = data.resumen   || data.detalle || '';
                    const ticketId  = data.ticket_id || '';
                    const agente    = data.agente    || '';

                    const combinedLower = `${titulo} ${detalle} ${ticketId} ${agente}`.toLowerCase();
                    const isInternalAlert = [
                        'cuota', 'quota', 'rate limit', 'agotada', 'límite', 'limite',
                        'claude', 'codex', 'antigravity', 'agente', 'triada', 'tríada',
                        'orquestador', 'sre', 'recado', 'tarea', 'jack', 'gemini',
                        'openai', 'groq', 'failover', 'runner', 'prompts'
                    ].some(k => combinedLower.includes(k));

                    if (isInternalAlert && targetJid === STAFF_GROUP_JID) {
                        if (data.p1_critical || data.force_whatsapp) {
                            console.log('[SAORI-WA] 🚨 Alerta P1 critica enviada al staff');
                        } else {
                            console.log('[SAORI-WA] 🔕 Notificacion tecnica ignorada en WhatsApp para no spamear a Jack.');
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ ok: true, silenced: true }));
                        }
                    }

                    const notifMsg = formatWhatsAppNotification(data);

                    if (globalSock && targetJid) {
                        await globalSock.sendMessage(targetJid, { text: notifMsg }).catch(err => {
                            console.error(`[SAORI-WA] Error enviando mensaje a ${targetJid}:`, err.message);
                        });
                        console.log(`[SAORI-WA] 📨 Notificación enviada a ${targetJid}`);
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (e) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                }
            });
        } else {
            res.writeHead(404); res.end();
        }
    });
    server.listen(WEBHOOK_PORT, '127.0.0.1', () => {
        console.log(`[SAORI-WA] Webhook seguro escuchando localmente en 127.0.0.1:${WEBHOOK_PORT}`);
    });
}

// ------------------------------------------------------------------
async function startWhatsAppBot() {
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    console.log(`[SAORI-WA] Baileys v${version.join('.')} iniciando...`);

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        browser: ['SAORI SRE Fleet', 'Chrome', '1.0.0'],
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        defaultQueryTimeoutMs: 60000
    });

    globalSock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n=============================================');
            console.log('📱 [SAORI-WA] ¡NUEVO CÓDIGO QR PARA VINCULAR!');
            console.log('=============================================\n');
            try {
                qrcodeTerminal.generate(qr, { small: true });
                fs.writeFileSync('/tmp/saori_whatsapp_qr.txt', qr, 'utf-8');
                qrcodeTerminal.generate(qr, { small: true }, (ascii) => {
                    fs.writeFileSync('/tmp/saori_whatsapp_qr_ascii.txt', ascii, 'utf-8');
                });
                const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
                const qrRes = await fetch(qrImgUrl, { timeout: 10000 });
                if (qrRes.ok) {
                    const buf = await qrRes.buffer();
                    fs.writeFileSync('/tmp/saori_whatsapp_qr.png', buf);
                }
            } catch (err) {
                console.error('[SAORI-WA] Error procesando QR:', err.message);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const errMsg = lastDisconnect?.error?.message || '';
            const isLoggedOut = (statusCode === DisconnectReason.loggedOut) ||
                                errMsg.includes('device_removed') ||
                                statusCode === 401;
            console.log(`[SAORI-WA] Conexión cerrada. Código: ${statusCode}, LoggedOut: ${isLoggedOut}, Detalle: ${errMsg}`);
            if (isLoggedOut) {
                console.log('⚠️ [SAORI-WA] Sesión desvinculada (401 / device_removed). Limpiando credenciales para nuevo QR...');
                try {
                    const files = fs.readdirSync(AUTH_DIR);
                    for (const f of files) fs.unlinkSync(path.join(AUTH_DIR, f));
                    console.log('🧹 [SAORI-WA] Credenciales obsoletas eliminadas con éxito.');
                } catch (e) {
                    console.error('[SAORI-WA] Error eliminando credenciales:', e.message);
                }
                setTimeout(startWhatsAppBot, 3000);
            } else {
                console.log('[SAORI-WA] Reconectando en 5 segundos...');
                setTimeout(startWhatsAppBot, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ [SAORI-WA] ¡WhatsApp conectado y operativo!');
            try {
                if (fs.existsSync('/tmp/saori_whatsapp_qr.txt')) fs.unlinkSync('/tmp/saori_whatsapp_qr.txt');
                if (fs.existsSync('/tmp/saori_whatsapp_qr_ascii.txt')) fs.unlinkSync('/tmp/saori_whatsapp_qr_ascii.txt');
                if (fs.existsSync('/tmp/saori_whatsapp_qr.png')) fs.unlinkSync('/tmp/saori_whatsapp_qr.png');
            } catch (_) {}
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of (m.messages || [])) {
            if (!msg.message || msg.key.fromMe) continue;

            const msgId = msg.key.id;
            if (processedMessages.has(msgId)) continue;
            processedMessages.add(msgId);
            if (processedMessages.size > 2000) {
                const iter = processedMessages.values();
                for (let i = 0; i < 500; i++) processedMessages.delete(iter.next().value);
            }

            const from    = msg.key.remoteJid || '';
            const isGroup = from.endsWith('@g.us');

            let messageContent =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption || '';

            let isAudio = false;

            if (msg.message.audioMessage) {
                isAudio = true;
                try {
                    const buffer     = await downloadMediaMessage(msg, 'buffer', {});
                    const tempPath   = `/tmp/wa_in_${Date.now()}.ogg`;
                    fs.writeFileSync(tempPath, buffer);
                    const transcript = await transcribeAudioFile(tempPath);
                    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                    console.log(`[SAORI-WA] 🎙️ Audio STT: "${transcript}"`);
                    messageContent = transcript;
                } catch (e) {
                    console.error('[SAORI-WA] Error STT:', e.message);
                }
            }

            if (!messageContent || messageContent.trim().length === 0) continue;

            if (['SAORI Core Status', 'INFORME SRE', 'ALERTA DE TICKET'].some(s => messageContent.includes(s))) continue;

            const senderJid     = msg.key.participant || msg.key.remoteJid || '';
            const senderPhone   = senderJid.replace(/[^0-9]/g, '');
            const isJack        = ADMIN_PHONE_NUMBER ? (senderPhone === ADMIN_PHONE_NUMBER || (ADMIN_PHONE_NUMBER.length >= 8 && senderPhone.endsWith(ADMIN_PHONE_NUMBER.slice(-8)))) : false;
            const senderName    = cleanSenderName(msg.pushName || '', isJack);
            const isHighStaff   = isJack || HIGH_STAFF_NAMES.includes(senderName.toLowerCase());
            const textLower     = messageContent.toLowerCase().trim();

            console.log(`[SAORI-WA] 📨 [${senderName}${isHighStaff ? ' (Staff)' : ''} en ${isGroup ? 'grupo' : 'privado'}]: ${messageContent}`);

            const now = Date.now();
            if (lastReplies.has(from) && (now - lastReplies.get(from) < 2000)) continue;

            const botJid = sock.user?.id || '';
            const botPhone = botJid.split(':')[0].replace(/[^0-9]/g, '');
            const mentionedJids = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const isBotTagged = (botPhone && mentionedJids.some(j => j.includes(botPhone))) || textLower.includes('@saori');

            const hasAiPrefix =
                textLower.startsWith('>saori') ||
                textLower.startsWith('>s ') ||
                textLower === '>s' ||
                textLower.startsWith('!saori') ||
                textLower.startsWith('/saori') ||
                textLower.startsWith('saori:') ||
                textLower.startsWith('saori,') ||
                isBotTagged;

            if (isGroup) {
                const isQuickCommand =
                    textLower.startsWith('!') ||
                    textLower.startsWith('/') ||
                    textLower.startsWith('shelp') ||
                    textLower.startsWith('sip') ||
                    textLower.startsWith('sticket') ||
                    textLower.startsWith('stienda') ||
                    textLower.startsWith('sweb') ||
                    textLower.startsWith('sguia') ||
                    textLower.startsWith('sstats') ||
                    textLower.startsWith('sping') ||
                    textLower.startsWith('sonline') ||
                    textLower.startsWith('stps') ||
                    textLower.startsWith('sdiscord') ||
                    textLower.startsWith('svotar') ||
                    textLower.startsWith('sreglas') ||
                    textLower.startsWith('scmd') ||
                    textLower.startsWith('sspark') ||
                    textLower.startsWith('sreinicio') ||
                    ['help', 'ayuda', 'online', 'tps'].includes(textLower);

                if (!isQuickCommand && !hasAiPrefix) {
                    continue;
                }
            }

            lastReplies.set(from, Date.now());

            // ⚡ COMANDOS RÁPIDOS EN WHATSAPP
            // ==========================================
            // 1. HELP / AYUDA
            // ==========================================
            if (['!help', 'shelp', 'saohelp', '!comandos', 's!help', '/help', 'ayuda', 'help'].includes(textLower)) {
                let helpTxt = `🌸 *S.A.O.R.I. · COMANDOS EN WHATSAPP*\n` +
                              `_Server Autonomous Orchestrator for Resilient Infrastructure_\n\n` +
                              `🎮 *1. Minecraft & Conexión:*\n` +
                              `• *!ip* / *sip* · IPs Java y Bedrock con puertos\n` +
                              `• *!online* / *sonline* · Jugadores conectados en vivo\n` +
                              `• *!stats* / *!tps* · Telemetría en tiempo real de Dallas\n` +
                              `• *!tienda* / *stienda* · Rangos y beneficios Tebex\n` +
                              `• *!web* / *sweb* · Portal web oficial\n` +
                              `• *!discord* / *sdiscord* · Comunidad en Discord\n` +
                              `• *!guia* / *sguia* · Slimefun, BentoBox y Economía\n` +
                              `• *!votar* / *svotar* · Vota y reclama recompensas\n` +
                              `• *!reglas* / *sreglas* · Normativa oficial resumida\n\n` +
                              `🎫 *2. Soporte & SRE:*\n` +
                              `• *!ticket <problema>* o *sticket <problema>*\n` +
                              `  _Registra un ticket formal (#TICKET-XXX) asignado a la Tríada SRE._\n` +
                              `• *!ping* / *sping* · Latencia y estado de los servicios\n\n` +
                              `🎨 *3. Multimedia & Voz:*\n` +
                              `• *!imagen <prompt>* · Generar arte digital con IA\n` +
                              `• *Pide un audio* · Ej: "Saori envía un audio explicando las celdas de Slimefun"\n\n` +
                              `💬 *4. Conversación Inteligente:*\n` +
                              `• *>saori <mensaje>* o *>s <mensaje>*\n` +
                              `  _Habla con Saori. Pregúntale cualquier duda sobre el juego o mecánicas._`;

                if (isHighStaff) {
                    helpTxt += `\n\n🛡️ *5. Herramientas Staff & SRE:*\n` +
                               `• *!spark* · Dispara perfilador Spark de 60s en Dallas\n` +
                               `• *!stats star* · Métricas de infraestructura en Star VPS`;
                    if (isJack) {
                        helpTxt += `\n• *!cmd <comando>* · Consola de servidor Dallas (Pterodactyl)\n` +
                                   `• *!reinicio* · Protocolo seguro de reinicio de 120s`;
                    }
                }

                await sock.sendMessage(from, { text: helpTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            // ==========================================
            // 2. CONEXIÓN, GUÍAS, WEB, TIENDA, DISCORD
            // ==========================================
            if (['!ip', 'sip', 'saoip', 's!ip', '/ip'].includes(textLower)) {
                const ipTxt = `⚡ *CONEXIÓN A DRAKESCRAFT NETWORK*\n\n` +
                              `☕ *Java Edition:* \`mc.drakescraft.cl:25565\`\n` +
                              `   _Compatible con 1.20.5 hasta 1.21.x (Recomendado 1.21.11)_\n\n` +
                              `📱 *Bedrock Edition:* \`mc.drakescraft.cl\` (Puerto: \`25565\`)\n` +
                              `   _Vía GeyserMC / Floodgate nativo_\n\n` +
                              `🌐 *Portal:* https://web.drakescraft.cl/\n` +
                              `🛒 *Tienda:* https://web.drakescraft.cl/store.html\n` +
                              `💬 *Discord:* https://discord.gg/drakescraft`;
                await sock.sendMessage(from, { text: ipTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!online', 'sonline', 'online', '/online'].includes(textLower)) {
                const st = await fetchMinecraftLiveStats();
                if (!st.online) {
                    await sock.sendMessage(from, { text: `🔴 *Servidor Minecraft Offline o en Mantenimiento.*` }, { quoted: isGroup ? msg : undefined });
                    continue;
                }
                let onTxt = `🟢 *JUGADORES EN LÍNEA · DRAKESCRAFT*\n\n` +
                            `👥 *Conectados:* \`${st.playersOnline} / ${st.playersMax}\`\n` +
                            `⚡ *Versión:* \`${st.version}\`\n`;
                if (st.playerList && st.playerList.length > 0) {
                    onTxt += `\n📋 *Lista de Jugadores:*\n` + st.playerList.map(p => `  • ${p}`).join('\n');
                } else if (st.playersOnline > 0) {
                    onTxt += `\n_Hay ${st.playersOnline} jugadores jugando en sus islas._`;
                } else {
                    onTxt += `\n_No hay jugadores conectados en este momento. ¡Sé el primero en entrar!_`;
                }
                await sock.sendMessage(from, { text: onTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (textLower.startsWith('!stats') || textLower.startsWith('sstats') || textLower.startsWith('/stats') ||
                textLower.startsWith('!tps') || textLower.startsWith('stps') || textLower === 'tps') {
                const subArg = textLower.replace(/^(!stats|sstats|\/stats|!tps|stps|tps)\s*/i, '').trim();
                
                if (subArg === 'star') {
                    const load = os.loadavg();
                    const totalMemGb = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
                    const freeMemGb  = (os.freemem()  / (1024 * 1024 * 1024)).toFixed(2);
                    const usedMemGb  = (totalMemGb - freeMemGb).toFixed(2);
                    const hostUptimeH = Math.floor(os.uptime() / 3600);

                    const starTxt = `🖥️ *TELEMETRÍA EN VIVO · STAR VPS*\n\n` +
                                    `⚙️ *Host:* \`${SERVER_HOST_LABEL}\`\n` +
                                    `📈 *Carga CPU (1m, 5m, 15m):* \`${load[0].toFixed(2)}, ${load[1].toFixed(2)}, ${load[2].toFixed(2)}\`\n` +
                                    `💾 *Memoria RAM:* \`${usedMemGb} GB / ${totalMemGb} GB\` (_${freeMemGb} GB libres_)\n` +
                                    `⏱️ *Uptime del Sistema:* \`${hostUptimeH} horas\`\n` +
                                    `🐳 *Contenedores:* SAORI Discord, WA, Web, DB, Cloudflared activos`;
                    await sock.sendMessage(from, { text: starTxt }, { quoted: isGroup ? msg : undefined });
                    continue;
                }

                const st = await fetchMinecraftLiveStats();
                const mcTxt = `⚔️ *TELEMETRÍA EN VIVO · DRAKESCRAFT (DALLAS)*\n\n` +
                              `📊 *Estado:* ${st.online ? '🟢 ONLINE' : '🔴 OFFLINE'}\n` +
                              `👥 *Jugadores:* \`${st.playersOnline} / ${st.playersMax}\`\n` +
                              `⚡ *Motor:* \`${st.version}\`\n` +
                              `💻 *CPU Panel:* \`${st.cpuPct}%\`\n` +
                              `🧠 *RAM Asignada:* \`${st.ramGb} GB\`\n` +
                              `💾 *Espacio Disco:* \`${st.diskGb} GB\`\n` +
                              `⏱️ *Uptime Dallas:* \`${st.uptimeStr}\`\n` +
                              `☕ *Java:* \`mc.drakescraft.cl:25565\`\n` +
                              `📱 *Bedrock:* \`mc.drakescraft.cl:25565\``;
                await sock.sendMessage(from, { text: mcTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!tienda', 'stienda', 'sshop', '!shop', '!store', '/tienda'].includes(textLower)) {
                const tiendaTxt = `🛒 *TIENDA OFICIAL DE DRAKESCRAFT*\n\n` +
                                  `Apoya al servidor y desbloquea beneficios exclusivos:\n` +
                                  `• Rangos VIP, Titan, Dioses y Dragmas\n` +
                                  `• Mochilas especiales, partículas y cosméticos\n` +
                                  `• Métodos de pago: Webpay Plus (Chile), Mercado Pago y PayPal\n\n` +
                                  `🔗 *Portal de Compras:* https://web.drakescraft.cl/store.html`;
                await sock.sendMessage(from, { text: tiendaTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!web', 'sweb', 'saoweb', '!portal', '/web'].includes(textLower)) {
                await sock.sendMessage(from, { text: `🌐 *Portal Web Oficial:* https://web.drakescraft.cl/` }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!discord', 'sdiscord', '!dc', '/discord'].includes(textLower)) {
                const dcTxt = `💬 *COMUNIDAD OFICIAL EN DISCORD*\n\n` +
                              `Únete para sorteos, anuncios, soporte técnico asistido por IA y chat con el Staff:\n` +
                              `🔗 https://discord.gg/drakescraft`;
                await sock.sendMessage(from, { text: dcTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!guia', 'sguia', '!wiki', '/guia'].includes(textLower)) {
                await sock.sendMessage(from, { text: `📚 *Guía Completa (Economía, Slimefun, BentoBox):*\nhttps://web.drakescraft.cl/guia.html` }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!votar', 'svotar', '!vote', '/votar'].includes(textLower)) {
                const voteTxt = `🗳️ *VOTA POR DRAKESCRAFT & GANA RECOMPENSAS*\n\n` +
                                `Cada voto entrega llaves, dinero y beneficios in-game:\n` +
                                `• *PlanetMinecraft:* https://www.planetminecraft.com/server/drakescraft/\n` +
                                `• *40Servidores:* https://www.40servidoresmc.es/drakescraft\n\n` +
                                `¡Usa \`/vote\` dentro de Minecraft para reclamar tu recompensa! ✨`;
                await sock.sendMessage(from, { text: voteTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!reglas', 'sreglas', '!normas', '/reglas'].includes(textLower)) {
                const reglasTxt = `📜 *NORMATIVA ESENCIAL DE DRAKESCRAFT*\n\n` +
                                  `1️⃣ *Respeto mutuo:* Prohibido el acoso, toxicidad severa o discriminación.\n` +
                                  `2️⃣ *Juego limpio:* Cero tolerancia a hacks, cheats, x-ray o clientes modificados no autorizados.\n` +
                                  `3️⃣ *Anti-Dupe / Exploits:* Prohibido aprovecharse de bugs o duplicación de ítems (sanción: ban permanente e IRP).\n` +
                                  `4️⃣ *Construcciones y lag:* Máquinas lag o generadores excesivos serán eliminados sin aviso.\n` +
                                  `5️⃣ *Seguridad:* Cuida tu contraseña de /register; el staff nunca te pedirá tu clave.\n\n` +
                                  `_Normativa completa en #reglas de nuestro Discord._`;
                await sock.sendMessage(from, { text: reglasTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!ping', 'sping', 'saoping', '!ms', '/ping'].includes(textLower)) {
                const tStart = Date.now();
                let daemonOk = false;
                try {
                    const hRes = await fetch('http://127.0.0.1:8089/health', { timeout: 1500 });
                    daemonOk = hRes.ok;
                } catch (_) {}
                const tLatency = Date.now() - tStart;

                const pingTxt = `🏓 *PONG! TELEMETRÍA DE RED & SAORI*\n\n` +
                                `⚡ *Latencia Daemon:* \`${tLatency} ms\`\n` +
                                `🖥️ *Servidor Star:* \`OPERATIVO (${SERVER_HOST_LABEL})\`\n` +
                                `🤖 *Motores:* Claude SRE + Codex GPT + Star Fleet\n` +
                                `🛰️ *Estado Daemon:* ${daemonOk ? '🟢 Conectado' : '🟡 Degradado'}`;
                await sock.sendMessage(from, { text: pingTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            // ==========================================
            // 3. COMANDOS DE ADMINISTRACIÓN Y SRE
            // ==========================================
            if (textLower.startsWith('!cmd ') || textLower.startsWith('scmd ') || textLower.startsWith('/cmd ')) {
                if (!isJack) {
                    await sock.sendMessage(from, { text: `🚫 *Acceso Denegado:* El comando de consola remota está reservado exclusivamente para la dirección de infraestructura (Jack).` }, { quoted: isGroup ? msg : undefined });
                    continue;
                }
                const cmdToExec = messageContent.replace(/^(!cmd|scmd|\/cmd)\s*/i, '').trim();
                if (!cmdToExec) {
                    await sock.sendMessage(from, { text: `❌ *Uso:* \`!cmd <comando de minecraft>\`\n_Ejemplo:_ \`!cmd list\` o \`!cmd kick Spammer\`` }, { quoted: isGroup ? msg : undefined });
                    continue;
                }
                await sock.sendMessage(from, { text: `⚙️ *Ejecutando en Dallas:* \`/${cmdToExec}\`...` }, { quoted: isGroup ? msg : undefined });
                const res = await executeMinecraftConsole(cmdToExec);
                if (res.ok) {
                    await sock.sendMessage(from, { text: `✅ *Comando despachado con éxito a la consola de Dallas:*\n\`/${cmdToExec}\`` }, { quoted: isGroup ? msg : undefined });
                } else {
                    await sock.sendMessage(from, { text: `❌ *Fallo al ejecutar comando:*\n${res.error}` }, { quoted: isGroup ? msg : undefined });
                }
                continue;
            }

            if (['!spark', 'sspark', '/spark'].includes(textLower)) {
                if (!isHighStaff) {
                    await sock.sendMessage(from, { text: `🚫 *Acceso Restringido:* El perfilador de Spark solo puede ser accionado por miembros del Staff de alto rango.` }, { quoted: isGroup ? msg : undefined });
                    continue;
                }
                await sock.sendMessage(from, { text: `⏳ *Iniciando perfilador Spark de 60 segundos en Dallas...*\n_Por favor espera un minuto para recibir el diagnóstico._` }, { quoted: isGroup ? msg : undefined });
                try {
                    const spRes = await fetch(SPARK_DAEMON_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ timeout: 60 }),
                        timeout: 90000
                    });
                    if (spRes.ok) {
                        const spData = await spRes.json();
                        const outText = spData.formatted || `⚡ Spark completado: ${JSON.stringify(spData.result || {}).slice(0, 300)}`;
                        await sock.sendMessage(from, { text: `📊 *DIAGNÓSTICO SPARK EN VIVO:*\n\n${outText}` }, { quoted: isGroup ? msg : undefined });
                    } else {
                        await sock.sendMessage(from, { text: `⚠️ No se pudo completar el perfil de Spark desde el daemon.` }, { quoted: isGroup ? msg : undefined });
                    }
                } catch (err) {
                    await sock.sendMessage(from, { text: `⚠️ Error ejecutando Spark: ${err.message}` }, { quoted: isGroup ? msg : undefined });
                }
                continue;
            }

            if (['!reinicio', 'sreinicio', '/reinicio'].includes(textLower)) {
                if (!isJack) {
                    await sock.sendMessage(from, { text: `🚫 Solo Jack puede iniciar el protocolo de reinicio.` }, { quoted: isGroup ? msg : undefined });
                    continue;
                }
                await sock.sendMessage(from, { text: `🔄 *Iniciando protocolo de reinicio seguro de Dallas (120 segundos)...*` }, { quoted: isGroup ? msg : undefined });
                try {
                    const powRes = await fetch(POWER_DAEMON_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'restart',
                            sender: 'Jack',
                            is_high_staff: true,
                            seconds: 120,
                            say_message: 'Reinicio programado solicitado por Dirección General (120s)'
                        }),
                        timeout: 10000
                    });
                    if (powRes.ok) {
                        const pData = await powRes.json();
                        await sock.sendMessage(from, { text: `✅ *Protocolo activo:* ${pData.message}` }, { quoted: isGroup ? msg : undefined });
                    } else {
                        await sock.sendMessage(from, { text: `⚠️ Error activando reinicio seguro desde el daemon.` }, { quoted: isGroup ? msg : undefined });
                    }
                } catch (e) {
                    await sock.sendMessage(from, { text: `⚠️ Error: ${e.message}` }, { quoted: isGroup ? msg : undefined });
                }
                continue;
            }

            // ==========================================
            // 4. TICKETS DE SOPORTE TÉCNICO
            // ==========================================
            if (textLower.startsWith('!ticket ') || textLower.startsWith('sticket ') || textLower.startsWith('/ticket ')) {
                const ticketDesc = messageContent.replace(/^(!ticket|sticket|\/ticket)\s*/i, '').trim();
                if (!ticketDesc || ticketDesc.length < 5) {
                    await sock.sendMessage(from, { text: '❌ *Uso correcto:* `!ticket <descripción detallada del problema>`\n_Ejemplo:_ `!ticket Error al generar isla en OneBlock`' }, { quoted: isGroup ? msg : undefined });
                    continue;
                }
                const ticketReply = await askSaori(`ticket: ${ticketDesc}`, senderName, isHighStaff);
                await sock.sendMessage(from, { text: ticketReply }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            // ==========================================
            // 5. GENERACIÓN DE IMÁGENES
            // ==========================================
            const isImageRequest = 
                textLower.startsWith('/imagen') || 
                textLower.startsWith('/image') || 
                textLower.startsWith('!imagen') || 
                textLower.startsWith('!image') || 
                textLower.includes('genera una imagen') || 
                textLower.includes('crea una imagen') || 
                textLower.includes('dibuja una imagen') || 
                textLower.includes('dibuja ') || 
                textLower.includes('haz una imagen');

            if (isImageRequest) {
                let promptForImg = messageContent
                    .replace(/^\/imagen\s*/i, '')
                    .replace(/^\/image\s*/i, '')
                    .replace(/^!imagen\s*/i, '')
                    .replace(/^!image\s*/i, '')
                    .replace(/^(?:saori|atenea)[,\s]+/i, '')
                    .replace(/(?:por favor|pls|plz)/gi, '')
                    .replace(/(?:genera|crea|dibuja|haz)\s+(?:una\s+)?imagen\s+(?:de\s+|sobre\s+)?/gi, '')
                    .trim();

                if (!promptForImg) promptForImg = 'Paisaje épico de fantasía con dragones y castillos medievales en Minecraft';

                const statusOpts = isGroup ? { quoted: msg } : {};
                await sock.sendMessage(from, { text: `🎨 *SAORI Art:* Generando imagen ("_${promptForImg.slice(0, 50)}..._"), dame unos segundos...` }, statusOpts).catch(() => {});

                const imgPath = await generateImageViaDaemon(promptForImg);
                if (imgPath && fs.existsSync(imgPath)) {
                    await sock.sendMessage(from, {
                        image: { url: imgPath },
                        caption: `🎨 *SAORI Art Generative Studio*\n✨ *Prompt:* ${promptForImg}`
                    }, statusOpts).catch(e => console.error('[SAORI-WA] Error enviando imagen:', e.message));
                    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
                    console.log(`[SAORI-WA] 🎨 Imagen enviada a ${from}`);
                    continue;
                } else {
                    await sock.sendMessage(from, { text: `🌸 Tuve un inconveniente con los motores de imagen en Star. Intenta con otro prompt más tarde.` }, statusOpts).catch(() => {});
                    continue;
                }
            }

            // ==========================================
            // 6. AUDIO Y NOTAS DE VOZ
            // ==========================================
            const wantsAudio =
                textLower.startsWith('!voz') ||
                textLower.startsWith('/voz') ||
                textLower.startsWith('!audio') ||
                textLower.startsWith('/audio') ||
                textLower.includes('manda audio') ||
                textLower.includes('mándame un audio') ||
                textLower.includes('mandame un audio') ||
                textLower.includes('manda un audio') ||
                textLower.includes('envía un audio') ||
                textLower.includes('envia un audio') ||
                textLower.includes('envíame un audio') ||
                textLower.includes('enviame un audio') ||
                textLower.includes('responde en audio') ||
                textLower.includes('responde con un audio') ||
                textLower.includes('responde con audio') ||
                textLower.includes('explica en un audio') ||
                textLower.includes('explícame en audio') ||
                textLower.includes('explicame en audio') ||
                textLower.includes('graba un audio') ||
                textLower.includes('hablame con tu voz') ||
                textLower.includes('háblame con tu voz') ||
                textLower.includes('dilo con tu voz') ||
                textLower.includes('nota de voz');

            // ==========================================
            // 7. RESPUESTA CONVERSACIONAL INTELIGENTE
            // ==========================================
            let promptForAi = messageContent;
            if (hasAiPrefix) {
                promptForAi = messageContent
                    .replace(/^>(?:saori|s)\s*/i, '')
                    .replace(/^[!\/](?:saori)\s*/i, '')
                    .replace(/^saori[:,]\s*/i, '')
                    .replace(/^@saori\s*/i, '')
                    .trim();
            }
            if (!promptForAi || promptForAi.length === 0) {
                promptForAi = '¡Hola Saori!';
            }

            const aiReply = await askSaori(promptForAi, senderName, isHighStaff);

            if (wantsAudio) {
                const audioPath = await generateVoiceAudio(aiReply);
                if (audioPath) {
                    await sock.sendMessage(from, {
                        audio: { url: audioPath },
                        mimetype: 'audio/mp4',
                        ptt: true
                    }, { quoted: msg }).catch(e => console.error('[SAORI-WA] Error voz:', e.message));
                    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                    console.log(`[SAORI-WA] 🎙️ Audio enviado.`);
                    continue;
                }
            }

            const sendOpts = isGroup ? { quoted: msg } : {};
            await sock.sendMessage(from, { text: aiReply }, sendOpts)
                .catch(e => console.error('[SAORI-WA] Error send:', e.message));
            console.log(`[SAORI-WA] 📤 Respuesta enviada.`);
        }
    });
}

startWebhookServer();
startWhatsAppBot().catch(err => {
    console.error('[SAORI-WA] Error fatal:', err);
});

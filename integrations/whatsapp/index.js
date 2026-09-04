// SAORI WhatsApp Bridge · Full SRE Capabilities (Minecraft Console, Live Logs, TTS/STT & Quick Commands)

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
const fetch  = require('node-fetch');

const AUTH_DIR         = process.env.AUTH_DIR || path.join(__dirname, '../data/auth_info');
const AI_DAEMON_URL    = 'http://127.0.0.1:8089/chat';
const IMAGE_DAEMON_URL = 'http://127.0.0.1:8089/image';
const TTS_URL          = 'http://127.0.0.1:8089/tts';
const STT_URL          = 'http://127.0.0.1:8089/stt';
const WEBHOOK_PORT     = 8088;

const JACK_NAMES       = ['jack', 'admin', 'jackstar'];
const ADMIN_PHONE_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER || '';
const ADMIN_JID         = ADMIN_PHONE_NUMBER ? `${ADMIN_PHONE_NUMBER}@s.whatsapp.net` : '';
const STAFF_GROUP_JID  = process.env.WHATSAPP_STAFF_GROUP_JID || 'your_staff_group_jid@g.us';

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
    if (isVerifiedJack) return 'Jack';
    if (!raw) return 'Usuario';
    const lower = raw.toLowerCase();

    // BLOQUEO ANTI-SPOOFING: Si alguien intenta llamarse Jack o Admin sin ser el teléfono verificado de Jack
    if (JACK_NAMES.some(n => lower.includes(n))) {
        return 'Usuario';
    }

    if (lower.includes('emilio') || lower.includes('em1lio')) return 'Emilio';
    if (lower.includes('pasient') || lower.includes('pacox')) return 'Pasiente';
    if (lower.includes('pepino'))  return 'Pepino';
    if (lower.includes('chagui'))  return 'Chagui';
    if (lower.includes('lauti') || lower.includes('lautaro')) return 'Lauti';
    if (lower.includes('macgyver')) return 'Macgyver';
    if (lower.includes('tomi') || lower.includes('bytomixd') || lower.includes('tomixd') || lower.includes('tomas')) return 'Tomi';
    if (lower.includes('kika'))    return 'Kika';
    if (lower.includes('derem'))   return 'Derem';

    let s = raw.trim();
    if (s.toLowerCase().startsWith('mr_') && s.length > 3) s = s.slice(3);
    else if (s.toLowerCase().startsWith('mr') && s.length > 2) s = s.slice(2);

    const first = s.trim().split(/[\s_\-|✦✧]/)[0];
    const cleanFirst = first.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, '').trim();
    return cleanFirst ? (cleanFirst.charAt(0).toUpperCase() + cleanFirst.slice(1).toLowerCase()) : 'Usuario';
}

// ------------------------------------------------------------------
// LLAMADA AL DAEMON HTTP (saori_ai_daemon en :8089)
// ------------------------------------------------------------------
async function askSaori(prompt, senderName) {
    try {
        const lang = detectLanguage(prompt);
        const langHint = lang === 'en'
            ? 'IMPORTANT: Reply in English only.'
            : 'Responde siempre en español.';
        const contextualPrompt = `[WhatsApp Staff Group · ${langHint}]\n${prompt}`;
        const res = await fetch(AI_DAEMON_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: contextualPrompt, sender: senderName }),
            timeout: 45000
        });
        if (res.ok) {
            const data = await res.json();
            if (data.response) return data.response;
        }
    } catch (e) {
        console.error('[SAORI-AI] Error daemon:', e.message);
    }
    return `Hola ${senderName}, tuve un lapso procesando en Star. ¿Me repites tu consulta?`;
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
// WEBHOOK DE ALERTAS
// ------------------------------------------------------------------
function startWebhookServer() {
    const server = http.createServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/notify-ticket') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const data      = JSON.parse(body);
                    const ticketId  = data.ticket_id || 'ALERTA';
                    const agente    = data.agente    || 'SAORI SRE';
                    const titulo    = data.titulo    || data.title   || 'Alerta';
                    const detalle   = data.resumen   || data.detalle || '';
                    let targetJid   = data.group_jid || STAFF_GROUP_JID;

                    // FIREWALL DE PRIVACIDAD: Alertas de cuota, agentes IA, Tríada o internas NUNCA van al grupo de Staff
                    const combinedLower = `${titulo} ${detalle} ${ticketId} ${agente}`.toLowerCase();
                    const isInternalAlert = [
                        'cuota', 'quota', 'rate limit', 'agotada', 'límite', 'limite',
                        'claude', 'codex', 'antigravity', 'agente', 'triada', 'tríada',
                        'orquestador', 'sre', 'recado', 'tarea', 'jack', 'gemini',
                        'openai', 'groq', 'failover', 'runner', 'prompts'
                    ].some(k => combinedLower.includes(k));

                    if (isInternalAlert && targetJid === STAFF_GROUP_JID) {
                        console.log(`[SAORI-WA] 🛡️ Alerta interna interceptada. Se prohíbe envío al grupo Staff; redirigiendo a Jack.`);
                        targetJid = ADMIN_JID || STAFF_GROUP_JID;
                    }

                    const notifMsg =
                        `🚨 *[DRAKES · ALERTA]*\n\n` +
                        `📌 *${ticketId}*\n` +
                        `🤖 *Agente:* ${agente}\n` +
                        `📝 *${titulo}*\n` +
                        (detalle ? `🔍 ${detalle.slice(0, 280)}\n` : '') +
                        `\n_SAORI · ${new Date().toLocaleTimeString('es-CL')}_`;

                    if (globalSock && targetJid) {
                        await globalSock.sendMessage(targetJid, { text: notifMsg }).catch(() => {});
                        console.log(`[SAORI-WA] 🚨 Alerta enviada a ${targetJid}`);
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
// BOT PRINCIPAL
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
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log(`[SAORI-WA] Conexión cerrada. Reconectando: ${shouldReconnect}`);
            if (shouldReconnect) setTimeout(startWhatsAppBot, 5000);
        } else if (connection === 'open') {
            console.log('✅ [SAORI-WA] WhatsApp conectado.');
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

            // ---- Extrae texto del mensaje ----
            let messageContent =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption || '';

            let isAudio = false;

            // ---- STT: Nota de voz entrante ----
            if (msg.message.audioMessage) {
                isAudio = true;
                try {
                    const buffer      = await downloadMediaMessage(msg, 'buffer', {});
                    const tempPath    = `/tmp/wa_in_${Date.now()}.ogg`;
                    fs.writeFileSync(tempPath, buffer);
                    const transcript  = await transcribeAudioFile(tempPath);
                    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                    console.log(`[SAORI-WA] 🎙️ Audio STT: "${transcript}"`);
                    messageContent = transcript;
                } catch (e) {
                    console.error('[SAORI-WA] Error STT:', e.message);
                }
            }

            if (!messageContent || messageContent.trim().length === 0) continue;

            // Ignorar mensajes internos de SAORI
            if (['SAORI Core Status', 'INFORME SRE', 'ALERTA DE TICKET'].some(s => messageContent.includes(s))) continue;

            const senderJid   = msg.key.participant || msg.key.remoteJid || '';
            const senderPhone = senderJid.replace(/[^0-9]/g, '');
            const isJack      = ADMIN_PHONE_NUMBER ? (senderPhone === ADMIN_PHONE_NUMBER || senderPhone.endsWith(ADMIN_PHONE_NUMBER.slice(-8))) : false;
            const senderName  = cleanSenderName(msg.pushName || '', isJack);
            const textLower   = messageContent.toLowerCase();

            console.log(`[SAORI-WA] 📨 [${senderName} en ${isGroup ? 'grupo' : 'privado'}]: ${messageContent}`);

            // Cooldown anti-spam (2s)
            const now = Date.now();
            if (lastReplies.has(from) && (now - lastReplies.get(from) < 2000)) continue;

            // ---- En grupos: responder SOLO si mencionan a Saori o usan comandos ----
            // Un audio por sí solo NO activa a Saori a menos que en la transcripción la mencionen explícitamente o sea un comando
            if (isGroup) {
                const isMentioned =
                    textLower.includes('saori') ||
                    textLower.includes('@saori') ||
                    textLower.startsWith('/') ||
                    textLower.startsWith('!') ||
                    textLower.startsWith('shelp') ||
                    textLower === 'help' ||
                    textLower === 'ayuda';
                if (!isMentioned) continue;
            }

            lastReplies.set(from, Date.now());

            // ⚡ COMANDOS RÁPIDOS EN WHATSAPP (shelp, sticket, sip, stienda, sweb, sguia, sstats, sping)
            if (['!help', 'shelp', 'saohelp', '!comandos', 's!help', '/help', 'ayuda'].includes(textLower)) {
                const helpTxt = `🌸 *S.A.O.R.I. · COMANDOS EN WHATSAPP*\n` +
                                `_Server Autonomous Orchestrator for Resilient Infrastructure_\n\n` +
                                `🎫 *1. Tickets & Tríada SRE:*\n` +
                                `• *!ticket <problema>* o *sticket <problema>*\n` +
                                `  _Registra un ticket formal (#TICKET-XXX) asignado a la Tríada de Agentes (Claude Code, Codex y Antigravity)._\n\n` +
                                `🎮 *2. Minecraft & Conexión:*\n` +
                                `• *!ip* / *sip* · Datos de conexión Java y Bedrock\n` +
                                `• *!tienda* / *stienda* · Tienda oficial y rangos\n` +
                                `• *!web* / *sweb* · Portal web oficial\n` +
                                `• *!guia* / *sguia* · Guías de Slimefun y economía\n\n` +
                                `🖥️ *3. Telemetría & Servidores:*\n` +
                                `• *!stats* / *sstats* · Rendimiento del servidor Minecraft\n` +
                                `• *!stats star* · Servidor Star\n` +
                                `• *!ping* / *sping* · Latencia de la red\n\n` +
                                `🎨 *4. Arte & Voz:*\n` +
                                `• *!imagen <prompt>* · Generar imagen con IA\n` +
                                `• *Pide un audio* · Ej: "Saori envía un audio explicando..."`;
                await sock.sendMessage(from, { text: helpTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            // 🎫 COMANDO DIRECTO !ticket EN WHATSAPP
            if (textLower.startsWith('!ticket ') || textLower.startsWith('sticket ') || textLower.startsWith('/ticket ')) {
                const ticketDesc = messageContent.replace(/^(!ticket|sticket|\/ticket)\s*/i, '').trim();
                if (!ticketDesc || ticketDesc.length < 5) {
                    await sock.sendMessage(from, { text: '❌ *Uso correcto:* `!ticket <descripción detallada del problema>`\n_Ejemplo:_ `!ticket Error al generar isla en OneBlock`' }, { quoted: isGroup ? msg : undefined });
                    continue;
                }
                const ticketReply = await askSaori(`ticket: ${ticketDesc}`, senderName);
                await sock.sendMessage(from, { text: ticketReply }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!ip', 'sip', 'saoip', 's!ip', '/ip'].includes(textLower)) {
                const ipTxt = `⚡ *CONEXIÓN A DRAKESCRAFT NETWORK*\n\n` +
                              `☕ *Java Edition:* \`mc.drakescraft.cl:25565\`\n` +
                              `📱 *Bedrock Edition:* \`mc.drakescraft.cl\` (Puerto: \`19132\`)\n` +
                              `🌐 *Web:* https://web.drakescraft.cl/\n` +
                              `🛒 *Tienda:* https://tienda.drakescraft.cl`;
                await sock.sendMessage(from, { text: ipTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!tienda', 'stienda', 'sshop', '!shop', '!store', '/tienda'].includes(textLower)) {
                const tiendaTxt = `🛒 *TIENDA OFICIAL DE DRAKESCRAFT*\n\n` +
                                  `Adquiere Rangos VIP, Titán, Dioses y beneficios exclusivos:\n` +
                                  `🔗 https://web.drakescraft.cl/store.html`;
                await sock.sendMessage(from, { text: tiendaTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!web', 'sweb', 'saoweb', '!portal', '/web'].includes(textLower)) {
                await sock.sendMessage(from, { text: `🌐 *Portal Web Oficial:* https://web.drakescraft.cl/` }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!guia', 'sguia', '!wiki', '/guia'].includes(textLower)) {
                await sock.sendMessage(from, { text: `📚 *Guía Completa (Economía, Slimefun):*\nhttps://web.drakescraft.cl/guia.html` }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!ping', 'sping', 'saoping', '!ms', '/ping'].includes(textLower)) {
                const pingTxt = `🏓 *PONG! LATENCIA DE SAORI*\n\n` +
                                `⚡ *Tiempo de Respuesta:* \`<50 ms\`\n` +
                                `🖥️ *Servidor Host:* \`ONLINE · ${process.env.STAR_HOST || 'star.local'}\`\n` +
                                `🤖 *Motores:* Tríada SRE (Claude + Codex + Antigravity)`;
                await sock.sendMessage(from, { text: pingTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (textLower.startsWith('!stats') || textLower.startsWith('sstats') || textLower.startsWith('/stats')) {
                const subArg = textLower.replace(/^(!stats|sstats|\/stats)\s*/i, '').trim();
                if (subArg === 'star') {
                    const starTxt = `🖥️ *TELEMETRÍA DE INFRAESTRUCTURA: STAR*\n\n` +
                                    `⚙️ *Uptime:* Operativo 24/7\n` +
                                    `💾 *RAM Libre:* 30+ GB\n` +
                                    `🐳 *Docker:* Contenedores activos (SAORI, Web, DB, Cloudflared)`;
                    await sock.sendMessage(from, { text: starTxt }, { quoted: isGroup ? msg : undefined });
                    continue;
                }
                const mcTxt = `⚔️ *ESTADO DEL SERVIDOR: DRAKESCRAFT (MINECRAFT)*\n\n` +
                              `⚡ *Rendimiento:* \`20.0 TPS\` (MSPT <25ms)\n` +
                              `☕ *Java:* \`mc.drakescraft.cl:25565\`\n` +
                              `📱 *Bedrock:* \`mc.drakescraft.cl\` (Puerto: \`25565\`)`;
                await sock.sendMessage(from, { text: mcTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            // ---- 1. GENERACIÓN DE IMÁGENES ----
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

            // Solo responder con nota de voz si el usuario lo solicita EXPLÍCITAMENTE (ej: "Saori envía un audio explicando...")
            // NUNCA responder con audio automáticamente solo porque el usuario envió una nota de voz.
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

            // ---- Obtener respuesta (executor → daemon) ----
            const aiReply = await askSaori(messageContent, senderName);

            // ---- Enviar nota de voz si se pidió ----
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

            // ---- Enviar texto ----
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

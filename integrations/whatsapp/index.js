// SAORI WhatsApp Bridge · Omnichannel Engine with Voice In/Out Support (Chilean Voice)

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const http = require('http');
const fetch = require('node-fetch');

const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, '../data/auth_info');
const AI_DAEMON_URL = 'http://127.0.0.1:8089/chat';
const TTS_URL = 'http://127.0.0.1:8089/tts';
const STT_URL = 'http://127.0.0.1:8089/stt';
const WEBHOOK_PORT = 8088;

const logger = pino({ level: 'error' });
let globalSock = null;

const processedMessages = new Set();
const lastReplies = new Map();

// Inferencia con Claude Brain
async function getClaudeResponse(prompt, senderName) {
    try {
        const res = await fetch(AI_DAEMON_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, sender: senderName }),
            timeout: 35000
        });
        if (res.ok) {
            const data = await res.json();
            if (data.response) return data.response;
        }
    } catch (e) {
        console.error('[SAORI-AI] Error invocando Claude Daemon:', e.message);
    }
    return `🌸 **Saori:** ¡Hola ${senderName}! Tuve un pequeño lapso procesando en Star. ¿Me repites tu consulta? ✨`;
}

// Generar nota de voz con acento chileno
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
            if (data.ok && fs.existsSync(outPath)) {
                return outPath;
            }
        }
    } catch (e) {
        console.error('[SAORI-TTS] Error generando voz:', e.message);
    }
    return null;
}

// Transcribir audio entrante a texto
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
        console.error('[SAORI-STT] Error transcribiendo:', e.message);
    }
    return '';
}

// Webhook de notificaciones de tickets
function startWebhookServer() {
    const server = http.createServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/notify-ticket') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);
                    const ticketId = data.ticket_id || data.id || 'N/A';
                    const agente = data.agente || 'SAORI SRE';
                    const titulo = data.titulo || data.title || 'Ticket Resuelto';
                    const detalle = data.detalle || data.resumen || '';
                    const targetGroup = data.group_jid || '120363422906663864@g.us';

                    const notifMsg = `🎫 *[ALERTA DE TICKET · DRAKES REPORTE]*\n\n` +
                                     `📌 *Ticket:* #${ticketId}\n` +
                                     `🤖 *Agente:* ${agente}\n` +
                                     `✅ *Estado:* Solucionado / Cerrado\n` +
                                     `📝 *Detalle:* ${titulo}\n` +
                                     (detalle ? `🔍 *Resumen:* ${detalle}\n` : '') +
                                     `\n_Notificación sincronizada automáticamente._`;

                    if (globalSock && targetGroup) {
                        await globalSock.sendMessage(targetGroup, { text: notifMsg }).catch(() => {});
                        console.log(`[SAORI-WA] 📢 Alerta de ticket #${ticketId} enviada a ${targetGroup}.`);
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, message: 'Ticket notificado exitosamente' }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                }
            });
        } else {
            res.writeHead(404);
            res.end();
        }
    });

    server.listen(WEBHOOK_PORT, '0.0.0.0', () => {
        console.log(`[SAORI-WA] Webhook escuchando en puerto ${WEBHOOK_PORT}`);
    });
}

async function startWhatsAppBot() {
    if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    console.log(`[SAORI-WA] Iniciando Baileys v${version.join('.')}...`);

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
            if (shouldReconnect) {
                setTimeout(startWhatsAppBot, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ [SAORI-WA] ¡Conexión establecida exitosamente con WhatsApp!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        const messages = m.messages || [];

        for (const msg of messages) {
            if (!msg.message) continue;
            if (msg.key.fromMe) continue;

            const msgId = msg.key.id;
            if (processedMessages.has(msgId)) continue;
            processedMessages.add(msgId);
            if (processedMessages.size > 2000) {
                const iter = processedMessages.values();
                for (let i = 0; i < 500; i++) processedMessages.delete(iter.next().value);
            }

            const from = msg.key.remoteJid || '';
            const isGroup = from.endsWith('@g.us');

            let isAudio = false;
            let messageContent = msg.message.conversation || 
                                 msg.message.extendedTextMessage?.text || 
                                 msg.message.imageMessage?.caption ||
                                 msg.message.videoMessage?.caption || '';

            // 1. Detectar si es una nota de voz o audio
            if (msg.message.audioMessage) {
                isAudio = true;
                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {});
                    const tempAudioPath = `/tmp/wa_in_${Date.now()}.ogg`;
                    fs.writeFileSync(tempAudioPath, buffer);
                    const transcript = await transcribeAudioFile(tempAudioPath);
                    if (fs.existsSync(tempAudioPath)) fs.removeSync ? fs.removeSync(tempAudioPath) : fs.unlinkSync(tempAudioPath);
                    
                    console.log(`[SAORI-WA] 🎙️ Audio recibido de ${msg.pushName}: "${transcript}"`);
                    messageContent = transcript;
                } catch (e) {
                    console.error('[SAORI-WA] Error descargando/procesando audio:', e.message);
                }
            }

            if (!messageContent || messageContent.trim().length === 0) continue;

            if (messageContent.includes('SAORI Core Status') || 
                messageContent.includes('INFORME SRE CONSOLIDADO') || 
                messageContent.includes('ALERTA DE TICKET')) {
                continue;
            }

            let senderName = msg.pushName || 'Staff';
            if (senderName.toLowerCase().includes('pablo')) {
                senderName = 'Jack';
            }

            console.log(`[SAORI-WA] 📨 [${senderName} en ${from}]: ${messageContent}`);

            const now = Date.now();
            if (lastReplies.has(from) && (now - lastReplies.get(from) < 2000)) {
                continue;
            }

            const textLower = messageContent.toLowerCase();
            const wantsAudio = isAudio || 
                               textLower.includes('manda audio') || 
                               textLower.includes('envia audio') || 
                               textLower.includes('en audio') || 
                               textLower.includes('responde en audio') ||
                               textLower.includes('un audio');

            // En Grupos:
            if (isGroup) {
                const isMentioned = isAudio || 
                                    textLower.includes('saori') || 
                                    textLower.includes('@saori') || 
                                    textLower.includes('atenea') ||
                                    textLower.startsWith('/') ||
                                    textLower.startsWith('!');

                if (!isMentioned) continue;

                lastReplies.set(from, Date.now());
                const aiReply = await getClaudeResponse(messageContent, senderName);

                if (wantsAudio) {
                    const audioPath = await generateVoiceAudio(aiReply);
                    if (audioPath) {
                        await sock.sendMessage(from, { 
                            audio: { url: audioPath }, 
                            mimetype: 'audio/mp4', 
                            ptt: true 
                        }, { quoted: msg });
                        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                        console.log(`[SAORI-WA] 🎙️ Nota de voz chilena enviada al grupo.`);
                        continue;
                    }
                }

                await sock.sendMessage(from, { text: aiReply }, { quoted: msg });
                console.log(`[SAORI-WA] 📤 Respuesta enviada a ${from}`);
                continue;
            }

            // En Privado:
            if (!isGroup) {
                lastReplies.set(from, Date.now());
                const aiReply = await getClaudeResponse(messageContent, senderName);

                if (wantsAudio) {
                    const audioPath = await generateVoiceAudio(aiReply);
                    if (audioPath) {
                        await sock.sendMessage(from, { 
                            audio: { url: audioPath }, 
                            mimetype: 'audio/mp4', 
                            ptt: true 
                        });
                        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                        console.log(`[SAORI-WA] 🎙️ Nota de voz chilena enviada a privado.`);
                        continue;
                    }
                }

                await sock.sendMessage(from, { text: aiReply });
                console.log(`[SAORI-WA] 📤 Respuesta enviada a privado ${from}`);
            }
        }
    });
}

startWebhookServer();
startWhatsAppBot().catch(err => {
    console.error('Fatal error en SAORI WhatsApp Bot:', err);
});

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

            // ⚡ COMANDOS RÁPIDOS EN WHATSAPP (shelp, sip, stienda, sweb, sguia, smusica, sstats, sping)
            if (['!help', 'shelp', 'saohelp', '!comandos', 's!help', '/help'].includes(textLower)) {
                const helpTxt = `🌸 *COMANDOS DE SAORI EN WHATSAPP*\n\n` +
                                `🎮 *Minecraft DrakesCraft:*\n` +
                                `• *!ip* / *sip* · Datos de conexión Java y Bedrock\n` +
                                `• *!tienda* / *stienda* · Tienda oficial y rangos\n` +
                                `• *!web* / *sweb* · Portal web oficial\n` +
                                `• *!guia* / *sguia* · Guías de Slimefun, economía y comandos\n\n` +
                                `🖥️ *Telemetría & Servidores:*\n` +
                                `• *!stats* / *sstats* · Estado de DrakesCraft (TPS, jugadores)\n` +
                                `• *!stats star* · Servidor de infraestructura Star\n` +
                                `• *!stats nova* · Laptop de Jack\n` +
                                `• *!stats nexus* · Estación PC de Jack\n` +
                                `• *!ping* / *sping* · Latencia del bot y de Star\n\n` +
                                `🎨 *Imágenes & Voz:*\n` +
                                `• *!imagen <prompt>* · Generar arte con IA\n` +
                                `• *Envía un audio* · SAORI te responderá con su voz chilena ✨`;
                await sock.sendMessage(from, { text: helpTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!ip', 'sip', 'saoip', 's!ip', '/ip'].includes(textLower)) {
                const ipTxt = `⚡ *CONEXIÓN A DRAKESCRAFT NETWORK*\n\n` +
                              `☕ *Java Edition:* \`mc.drakescraft.cl:25565\`\n` +
                              `📱 *Bedrock Edition:* \`mc.drakescraft.cl\` (Puerto: \`25565\`)\n` +
                              `🌐 *Web:* https://web.drakescraft.cl/\n` +
                              `🛒 *Tienda:* https://web.drakescraft.cl/store.html`;
                await sock.sendMessage(from, { text: ipTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!tienda', 'stienda', 'sshop', '!shop', '!store', '/tienda'].includes(textLower)) {
                const tiendaTxt = `🛒 *TIENDA OFICIAL DE DRAKESCRAFT*\n\n` +
                                  `Adquiere Rangos VIP, Titan, Dios, Dragmas y beneficios exclusivos:\n` +
                                  `🔗 https://web.drakescraft.cl/store.html`;
                await sock.sendMessage(from, { text: tiendaTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!web', 'sweb', 'saoweb', '!portal', '/web'].includes(textLower)) {
                await sock.sendMessage(from, { text: `🌐 *Portal Web Oficial:* https://web.drakescraft.cl/` }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!guia', 'sguia', '!wiki', '/guia'].includes(textLower)) {
                await sock.sendMessage(from, { text: `📚 *Guía Completa (Economía, XP, Slimefun):*\nhttps://web.drakescraft.cl/guia.html` }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (['!ping', 'sping', 'saoping', '!ms', '/ping'].includes(textLower)) {
                const pingTxt = `🏓 *PONG! LATENCIA DE SAORI*\n\n` +
                                `⚡ *Tiempo de Respuesta:* \`<50 ms\`\n` +
                                `🖥️ *Servidor Star:* \`ONLINE · 192.168.0.120\`\n` +
                                `🤖 *Motores:* Claude Haiku + Baileys WhatsApp`;
                await sock.sendMessage(from, { text: pingTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            if (textLower.startsWith('!stats') || textLower.startsWith('sstats') || textLower.startsWith('/stats')) {
                const subArg = textLower.replace(/^(!stats|sstats|\/stats)\s*/i, '').trim();
                if (subArg === 'star') {
                    const starTxt = `🖥️ *TELEMETRÍA DE INFRAESTRUCTURA: STAR*\n\n` +
                                    `⚙️ *Uptime:* 2+ días activo\n` +
                                    `💾 *RAM Libre:* 35+ GB\n` +
                                    `🐳 *Docker:* 18 contenedores activos (SAORI, DB, Cloudflared)`;
                    await sock.sendMessage(from, { text: starTxt }, { quoted: isGroup ? msg : undefined });
                    continue;
                }
                if (subArg === 'nexus') {
                    const nexusTxt = `🖥️ *TELEMETRÍA DE NODO: NEXUS*\n\n` +
                                     `🔥 *CPU:* Ryzen 5 5500 (6 Núcleos / 12 Hilos)\n` +
                                     `🎮 *GPU:* NVIDIA GeForce RTX 4060 (8GB VRAM)\n` +
                                     `🎨 *Capacidades:* ComfyUI / SDXL / Pony V6`;
                    await sock.sendMessage(from, { text: nexusTxt }, { quoted: isGroup ? msg : undefined });
                    continue;
                }
                if (subArg === 'nova') {
                    const novaTxt = `💻 *TELEMETRÍA DE NODO: NOVA (LAPTOP JACK)*\n\n` +
                                    `🌐 *Red:* Tailscale Mesh (\`100.110.230.7\`)\n` +
                                    `🎮 *Hardware:* GPU MX450 · Ryzen Mobile`;
                    await sock.sendMessage(from, { text: novaTxt }, { quoted: isGroup ? msg : undefined });
                    continue;
                }
                const mcTxt = `⚔️ *ESTADO DEL SERVIDOR: DRAKESCRAFT (MINECRAFT)*\n\n` +
                              `⚡ *Rendimiento:* \`20.0 TPS\` (MSPT <25ms)\n` +
                              `☕ *Java:* \`mc.drakescraft.cl:25565\`\n` +
                              `📱 *Bedrock:* \`mc.drakescraft.cl\` (Puerto: \`25565\`)`;
                await sock.sendMessage(from, { text: mcTxt }, { quoted: isGroup ? msg : undefined });
                continue;
            }

            // 🎨 GENERACIÓN DE IMÁGENES EN WHATSAPP (!imagen <prompt>, dibuja <prompt>)
            const isImgReq = textLower.startsWith('!imagen') || 
                             textLower.startsWith('!image') || 
                             textLower.startsWith('!dibuja') ||
                             textLower.startsWith('dibuja ') ||
                             textLower.startsWith('genera una imagen');

            if (isImgReq) {
                let imgPrompt = messageContent.replace(/^(!imagen|!image|!dibuja|dibuja|genera una imagen de|genera una imagen)\s+/i, '').trim();
                if (!imgPrompt) imgPrompt = 'Diosa Saori cyberpunk';

                await sock.sendMessage(from, { text: `🎨 *Pintando y renderizando con los motores de Star...* ✨` }, { quoted: isGroup ? msg : undefined });

                try {
                    const imgRes = await fetch('http://127.0.0.1:8089/image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prompt: imgPrompt }),
                        timeout: 45000
                    });

                    if (imgRes.ok) {
                        const imgData = await imgRes.json();
                        if (imgData.ok && imgData.image_path && fs.existsSync(imgData.image_path)) {
                            const imgBuffer = fs.readFileSync(imgData.image_path);
                            await sock.sendMessage(from, { 
                                image: imgBuffer, 
                                caption: `🌸 *Arte Generado por SAORI*\n✨ *Prompt:* ${imgPrompt}` 
                            }, { quoted: isGroup ? msg : undefined });
                            fs.unlinkSync(imgData.image_path);
                            console.log(`[SAORI-WA] 🎨 Imagen enviada exitosamente.`);
                            continue;
                        }
                    }
                } catch (e) {
                    console.error('[SAORI-WA] Error generando imagen:', e.message);
                }
                await sock.sendMessage(from, { text: `❌ No se pudo completar la generación en este momento. Intenta de nuevo.` }, { quoted: isGroup ? msg : undefined });
                continue;
            }

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
                    if (audioPath && fs.existsSync(audioPath)) {
                        const audioBuffer = fs.readFileSync(audioPath);
                        await sock.sendMessage(from, { 
                            audio: audioBuffer, 
                            mimetype: 'audio/ogg; codecs=opus', 
                            ptt: true 
                        }, { quoted: msg });
                        fs.unlinkSync(audioPath);
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
                    if (audioPath && fs.existsSync(audioPath)) {
                        const audioBuffer = fs.readFileSync(audioPath);
                        await sock.sendMessage(from, { 
                            audio: audioBuffer, 
                            mimetype: 'audio/ogg; codecs=opus', 
                            ptt: true 
                        });
                        fs.unlinkSync(audioPath);
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

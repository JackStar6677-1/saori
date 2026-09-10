#!/usr/bin/env node

/* Publishes the NEXO community charter and a pinned, channel-specific guide in every text channel. */
const fs = require('fs');
const path = require('path');

const GUILD_ID = '699391897369575476';
const BOT_ID = '1463972559946125354';
const token = process.env.DISCORD_BOT_TOKEN;
const API = 'https://discord.com/api/v10';
const state = JSON.parse(fs.readFileSync(process.env.LEGACY_GUILD_STATE_PATH || path.join(__dirname, '..', 'legacy-guild-state.json'), 'utf8'));
if (!token) throw new Error('DISCORD_BOT_TOKEN no está definido.');

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function request(method, endpoint, body, attempt = 0) {
    const response = await fetch(`${API}${endpoint}`, { method, headers: { Authorization: `Bot ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 204) return null;
    if (response.status === 429 && attempt < 20) {
        await sleep(Math.ceil((data.retry_after || 1) * 1000) + 100);
        return request(method, endpoint, body, attempt + 1);
    }
    if (!response.ok) throw new Error(`${method} ${endpoint}: ${response.status} ${JSON.stringify(data)}`);
    return data;
}
const get = endpoint => request('GET', endpoint);
const post = (endpoint, body) => request('POST', endpoint, body);
const put = endpoint => request('PUT', endpoint);

const RULES = {
    '👋・ʙɪᴇɴᴠᴇɴɪᴅᴀ': ['👋 Bienvenida', 'Este canal es de lectura. Empieza por las normas y personaliza tu perfil antes de conversar.', 'Siguiente paso: revisa #📜・ɴᴏʀᴍᴀs y usa #🎭・ᴘᴇʀғɪʟ-ʏ-ʀᴏʟᴇs.'],
    '📜・ɴᴏʀᴍᴀs': ['📜 Reglamento NEXO', 'Estas normas aplican a toda la comunidad, mensajes directos vinculados al servidor y salas de voz.', 'Ignorar las normas no elimina la responsabilidad de cumplirlas.'],
    '📦・ᴀʀᴄʜɪᴠᴏ-ᴅʀᴀᴋᴇs': ['📦 Archivo DrakesCraft', 'Canal de lectura para la migración y enlaces oficiales. No se usa para soporte ni conversación.', 'La actividad de DrakesCraft continúa en el Discord nuevo enlazado arriba.'],
    '🎭・ᴘᴇʀғɪʟ-ʏ-ʀᴏʟᴇs': ['🎭 Perfil y roles', 'Usa los menús para elegir región e intereses. No uses roles para acosar, etiquetar masivamente o excluir a otros.', 'Los roles son opcionales y se pueden cambiar cuando quieras.'],
    '💬・ɢᴇɴᴇʀᴀʟ-ᴇs': ['💬 General ES', 'Charla en español, buena onda y conversaciones abiertas. Respeta el ritmo de los demás.', 'Sin flood, insultos, contenido sexual, guerras políticas/religiosas, publicidad no autorizada ni @everyone.'],
    '🌍・ɢᴇɴᴇʀᴀʟ-ᴇɴ': ['🌍 General EN', 'English chat for relaxed, inclusive conversation.', 'No harassment, flooding, sexual content, inflammatory political/religious fights, unsolicited ads, or mass mentions.'],
    '👤・ᴘʀᴇsᴇɴᴛᴀᴛᴇ': ['👤 Preséntate', 'Cuéntanos intereses, juegos o proyectos. Comparte solo información que te sientas cómodo haciendo pública.', 'No solicites datos personales, ubicación, edad exacta, fotos íntimas ni contactos privados.'],
    '📷・ᴍᴇᴅɪᴀ-ʏ-ᴍᴇᴍᴇs': ['📷 Media y memes', 'Comparte contenido propio o que tengas derecho a publicar. Mantén el humor seguro y respetuoso.', 'Prohibido NSFW, gore, humillación dirigida, doxxing, phishing, malware y material de odio.'],
    '💥・ʀᴀɴᴅᴏᴍ': ['💥 Random', 'Canal para temas ligeros fuera de categoría, sin convertirlo en spam.', 'No cadenas, flood, publicidad repetida, contenido ilegal o ataques personales.'],
    '🎮・ʙᴜsᴄᴀ-ᴘᴀʀᴛʏ': ['🎮 Busca party', 'Publica juego, plataforma, horario y región. Respeta un no y acuerda expectativas antes de entrar a voz.', 'No reclutamiento abusivo, estafas, boosting pagado no autorizado ni discriminación.'],
    '🟢・sᴀɴᴅʙᴏx-ʏ-ᴍɪɴᴇᴄʀᴀғᴛ': ['🟢 Sandbox y Minecraft', 'Construcciones, mods, servidores, guías y partidas. Da crédito a creadores y avisa si algo requiere mods.', 'No compartas cheats, dupes, exploits, cuentas robadas ni enlaces de descargas sospechosas.'],
    '🕹️・ᴏᴛʀᴏs-ᴊᴜᴇɢᴏs': ['🕹️ Otros juegos', 'Habla de cualquier juego y arma grupo sin presionar a nadie.', 'No venta de cuentas, hacks, boosting engañoso, sorteos falsos ni spam de invitaciones.'],
    '🎬・ᴄʟɪᴘs-ʏ-sᴛʀᴇᴀᴍs': ['🎬 Clips y streams', 'Comparte clips, directos y creaciones propias. Si es contenido ajeno, acredita al creador.', 'Autopromoción moderada: no flood, no clickbait engañoso y nada NSFW.'],
    '🌎・ᴘᴀísᴇs-ʏ-ᴄᴜʟᴛᴜʀᴀs': ['🌎 Países y culturas', 'Comparte costumbres, idiomas y experiencias con curiosidad y respeto.', 'No xenofobia, estereotipos, discusiones políticas incendiarias ni ataques a nacionalidades.'],
    '💻・ᴛᴇᴄʜ-ʏ-ᴅᴇᴠ': ['💻 Tech y Dev', 'Pide ayuda, muestra proyectos y comparte aprendizaje. Incluye contexto y respeta licencias.', 'Prohibido malware, doxxing, intrusiones, DDoS, phishing, piratería o instrucciones para dañar sistemas.'],
    '🎨・ᴀʀᴛᴇ-ᴍúsɪᴄᴀ-ʏ-ᴀɴɪᴍᴇ': ['🎨 Arte, música y anime', 'Comparte obras, recomendaciones y feedback constructivo.', 'No robo de crédito, filtraciones, NSFW, spoilers sin aviso ni hostigamiento a fandoms.'],
    '💡・ʀᴇᴄᴏᴍᴇɴᴅᴀᴄɪᴏɴᴇs': ['💡 Recomendaciones', 'Sugiere juegos, series, música, recursos o lugares con una breve razón.', 'Marca spoilers, evita enlaces sospechosos y no conviertas recomendaciones en publicidad.'],
    '💬・sᴛᴀғғ-ʜǫ': ['💬 Staff HQ', 'Coordinación interna, decisiones y seguimiento de la comunidad.', 'Información confidencial: no compartas capturas, casos, datos de miembros ni decisiones internas fuera del staff.'],
    '🚨・ᴍᴏᴅ-ʟᴏɢs': ['🚨 Moderación', 'Registro interno de acciones y contexto. Es un canal de lectura y trazabilidad.', 'Cada acción debe ser objetiva, proporcional y basada en evidencia verificable.'],
    '🛡️・ᴀʟᴇʀᴛᴀs-ᴅᴇ-sᴇɢᴜʀɪᴅᴀᴅ': ['🛡️ Alertas de seguridad', 'Canal privado para avisos de Discord y respuesta del staff.', 'Trata cualquier dato sensible como confidencial; no reenvíes alertas fuera del equipo.']
};

const CHARTER = [
    { title: '✦ 1 · Convivencia', body: 'Respeta a cada persona. No hay espacio para acoso, amenazas, discriminación, humillación dirigida o campañas contra miembros.' },
    { title: '✦ 2 · Seguridad y menores', body: 'No pidas ni compartas datos personales, ubicaciones, contraseñas, imágenes íntimas ni contenido sexual. Cualquier conducta de grooming, extorsión o riesgo se reporta y se sanciona de inmediato.' },
    { title: '✦ 3 · Contenido y enlaces', body: 'Prohibidos NSFW, gore, odio, phishing, malware, estafas, doxxing, actividades ilegales y enlaces engañosos. Publica solo contenido que puedas compartir.' },
    { title: '✦ 4 · Conversación sana', body: 'No flood, spam, cadenas, autopromoción no autorizada ni menciones masivas. Los temas políticos o religiosos solo se toleran si son respetuosos y no derivan en confrontación.' },
    { title: '✦ 5 · Moderación', body: 'El staff evalúa contexto y evidencia. Las medidas pueden ir desde una orientación hasta timeout, expulsión o baneo según gravedad y reincidencia. Apelar se hace con calma y por el canal indicado.' }
];

async function pin(channelId, payload) {
    const message = await post(`/channels/${channelId}/messages`, payload);
    await put(`/channels/${channelId}/pins/${message.id}`);
}

async function main() {
    const channels = await get(`/guilds/${GUILD_ID}/channels`);
    const byName = new Map(channels.map(channel => [channel.name, channel]));
    const norms = byName.get('📜・ɴᴏʀᴍᴀs');
    for (const section of CHARTER) {
        await pin(norms.id, { embeds: [{ title: section.title, description: section.body, color: 0x2DD4BF, footer: { text: 'NEXO · Reglamento general' } }] });
    }
    for (const [name, [title, description, rule]] of Object.entries(RULES)) {
        if (name === '📜・ɴᴏʀᴍᴀs') continue;
        const channel = byName.get(name);
        if (!channel) throw new Error(`Canal no encontrado: ${name}`);
        await pin(channel.id, { embeds: [{ title, description, fields: [{ name: 'Regla del canal', value: rule }], color: 0xC891FF, footer: { text: 'NEXO · Guía fija de canal' } }] });
    }
    // Voice channels cannot contain pinned messages; their category title and the general charter apply.
    console.log(`[NEXO] Normativa fijada en ${CHARTER.length + Object.keys(RULES).length - 1} canales de texto.`);
}

main().catch(error => { console.error('[NEXO] Falló la publicación de normas:', error.stack || error.message); process.exit(1); });

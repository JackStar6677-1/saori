#!/usr/bin/env node

/* Applies the visual language of a mature community without changing NEXO's social purpose. */
const fs = require('fs');
const path = require('path');

const GUILD_ID = '699391897369575476';
const token = process.env.DISCORD_BOT_TOKEN;
const API = 'https://discord.com/api/v10';
const state = JSON.parse(fs.readFileSync(process.env.LEGACY_GUILD_STATE_PATH || path.join(__dirname, '..', 'legacy-guild-state.json'), 'utf8'));
const BOT_ID = '1463972559946125354';
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
const patch = (endpoint, body) => request('PATCH', endpoint, body);
const post = (endpoint, body) => request('POST', endpoint, body);
const del = endpoint => request('DELETE', endpoint);

async function main() {
    const [channels, roles] = await Promise.all([get(`/guilds/${GUILD_ID}/channels`), get(`/guilds/${GUILD_ID}/roles`)]);
    const channel = name => channels.find(item => item.name === name);
    const role = name => roles.find(item => item.name === name);

    const categoryNames = {
        'COMIENZA-AQUI': '✦ ɪɴɪᴄɪᴏ ✦',
        'SOCIAL': '✦ ᴄᴏᴍᴜɴɪᴅᴀᴅ ✦',
        'JUGAMOS': '✦ ɢᴀᴍɪɴɢ ✦',
        'MUNDOS-E-IDEAS': '✦ ᴍᴜɴᴅᴏs & ɪᴅᴇᴀs ✦',
        'VOZ': '✦ sᴀʟᴀs ᴅᴇ ᴠᴏᴢ ✦',
        'STAFF': '✦ ᴢᴏɴᴀ sᴛᴀғғ ✦'
    };
    const channelNames = {
        'bienvenida': '👋・ʙɪᴇɴᴠᴇɴɪᴅᴀ',
        'normas-y-seguridad': '📜・ɴᴏʀᴍᴀs',
        'mudanza-drakes': '📦・ᴀʀᴄʜɪᴠᴏ-ᴅʀᴀᴋᴇs',
        'elige-tus-roles': '🎭・ᴘᴇʀғɪʟ-ʏ-ʀᴏʟᴇs',
        'general-es': '💬・ɢᴇɴᴇʀᴀʟ-ᴇs',
        'general-en': '🌍・ɢᴇɴᴇʀᴀʟ-ᴇɴ',
        'presentate': '👤・ᴘʀᴇsᴇɴᴛᴀᴛᴇ',
        'memes-y-media': '📷・ᴍᴇᴅɪᴀ-ʏ-ᴍᴇᴍᴇs',
        'random': '💥・ʀᴀɴᴅᴏᴍ',
        'busca-party': '🎮・ʙᴜsᴄᴀ-ᴘᴀʀᴛʏ',
        'minecraft-y-sandbox': '🟢・sᴀɴᴅʙᴏx-ʏ-ᴍɪɴᴇᴄʀᴀғᴛ',
        'otros-juegos': '🕹️・ᴏᴛʀᴏs-ᴊᴜᴇɢᴏs',
        'clips-y-streams': '🎬・ᴄʟɪᴘs-ʏ-sᴛʀᴇᴀᴍs',
        'paises-y-culturas': '🌎・ᴘᴀísᴇs-ʏ-ᴄᴜʟᴛᴜʀᴀs',
        'tech-y-dev': '💻・ᴛᴇᴄʜ-ʏ-ᴅᴇᴠ',
        'arte-musica-y-anime': '🎨・ᴀʀᴛᴇ-ᴍúsɪᴄᴀ-ʏ-ᴀɴɪᴍᴇ',
        'recomendaciones': '💡・ʀᴇᴄᴏᴍᴇɴᴅᴀᴄɪᴏɴᴇs',
        'lounge': '🔊・ʟᴏᴜɴɢᴇ',
        'gaming': '🎮・ɢᴀᴍɪɴɢ',
        'musica': '🎵・ᴍúsɪᴄᴀ',
        'afk': '💤・ᴀғᴋ',
        'staff-hq': '💬・sᴛᴀғғ-ʜǫ',
        'mod-log': '🚨・ᴍᴏᴅ-ʟᴏɢs',
        'alertas-de-seguridad': '🛡️・ᴀʟᴇʀᴛᴀs-ᴅᴇ-sᴇɢᴜʀɪᴅᴀᴅ'
    };
    for (const [from, to] of Object.entries(categoryNames)) await patch(`/channels/${channel(from).id}`, { name: to });
    for (const [from, to] of Object.entries(channelNames)) await patch(`/channels/${channel(from).id}`, { name: to });

    const roleStyles = {
        '✦ Founder': ['👑 ︱ ɴᴇxᴏ ᴏᴡɴᴇʀ', 0xF6C667],
        '✦ Staff': ['🛡️ ︱ ᴀᴅᴍɪɴ', 0xE05263],
        '✦ Moderator': ['⚔️ ︱ ᴍᴏᴅ', 0xD97757],
        '✦ Host': ['🎙️ ︱ ʜᴏsᴛ', 0x4EA8DE],
        '✦ Builder': ['🧱 ︱ ʙᴜɪʟᴅᴇʀ', 0x4EBA91],
        'Chile': ['🇨🇱 ︱ ᴄʜɪʟᴇ', 0xD94F5C],
        'Latinoamérica': ['🌎 ︱ ʟᴀᴛɪɴᴏᴀᴍéʀɪᴄᴀ', 0xE9A23B],
        'España': ['🇪🇸 ︱ ᴇsᴘᴀñᴀ', 0xD86B45],
        'International': ['🌐 ︱ ɪɴᴛᴇʀɴᴀᴛɪᴏɴᴀʟ', 0x5E9FD6],
        'Gaming': ['🎮 ︱ ɢᴀᴍɪɴɢ', 0x8D6FD1],
        'Tech & Dev': ['💻 ︱ ᴛᴇᴄʜ & ᴅᴇᴠ', 0x4EA8DE],
        'Arte & Creatividad': ['🎨 ︱ ᴄʀᴇᴀᴛɪᴠᴏ', 0xDE6FA1],
        'Música': ['🎵 ︱ ᴍúsɪᴄᴀ', 0xC891FF]
    };
    for (const [from, [name, color]] of Object.entries(roleStyles)) await patch(`/guilds/${GUILD_ID}/roles/${role(from).id}`, { name, color, hoist: ['✦ Founder', '✦ Staff', '✦ Moderator', '✦ Host', '✦ Builder'].includes(from) });

    // Replace provisional messages with polished, scannable landing cards.
    for (const channelId of [state.channels.welcome, state.channels.rules, state.channels.roles]) {
        const messages = await get(`/channels/${channelId}/messages?limit=20`);
        for (const message of messages.filter(item => item.author.id === BOT_ID)) await del(`/channels/${channelId}/messages/${message.id}`);
    }
    await post(`/channels/${state.channels.welcome}/messages`, { embeds: [{ title: '✦ Bienvenido a NEXO', color: 0x2DD4BF, description: 'Una comunidad chill para **conocer gente, conversar, jugar y crear** sin presión.', fields: [{ name: '01 · Ubícate', value: `Lee <#${state.channels.rules}> para mantener el espacio seguro.` }, { name: '02 · Personaliza tu perfil', value: `Elige región e intereses en <#${state.channels.roles}>.` }, { name: '03 · Entra a la conversación', value: `Preséntate en <#${state.channels.generalEs}> o visita el chat inglés.` }], footer: { text: 'NEXO · Social & Gaming' } }] });
    await post(`/channels/${state.channels.rules}/messages`, { embeds: [{ title: '📜 Normas de NEXO', color: 0xF6C667, description: 'Pocas reglas, claras y aplicadas con criterio.', fields: [{ name: 'Respeto primero', value: 'Sin acoso, discriminación, doxxing ni hostigamiento.' }, { name: 'Espacio seguro', value: 'Nada ilegal, estafas, phishing, malware o contenido que ponga a otros en riesgo.' }, { name: 'Buena convivencia', value: 'Sin spam, publicidad no autorizada ni flood. Usa cada canal según su tema.' }], footer: { text: 'Si algo cruza el límite, avisa a moderación.' } }] });
    await post(`/channels/${state.channels.roles}/messages`, { embeds: [{ title: '🎭 Haz tuyo el servidor', color: 0xC891FF, description: 'Elige una **región** y un **interés** con los menús de abajo. Puedes cambiarlos cuando quieras.', footer: { text: 'NEXO · perfiles de comunidad' } }], components: [
        { type: 1, components: [{ type: 3, custom_id: 'legacy_region_roles', placeholder: '🌎 Elige tu región', options: [['Chile', state.roles.regions.chile, '🇨🇱'], ['Latinoamérica', state.roles.regions.latam, '🌎'], ['España', state.roles.regions.espana, '🇪🇸'], ['International', state.roles.regions.international, '🌐']].map(([label, value, name]) => ({ label, value, emoji: { name } })) }] },
        { type: 1, components: [{ type: 3, custom_id: 'legacy_interest_roles', placeholder: '✨ Elige un interés', options: [['Gaming', state.roles.interests.gaming, '🎮'], ['Tech y desarrollo', state.roles.interests.tech, '💻'], ['Arte y creatividad', state.roles.interests.creative, '🎨'], ['Música', state.roles.interests.music, '🎵']].map(([label, value, name]) => ({ label, value, emoji: { name } })) }] }
    ] });
    console.log('[NEXO] Pulido visual completado.');
}

main().catch(error => { console.error('[NEXO] Falló el pulido:', error.stack || error.message); process.exit(1); });

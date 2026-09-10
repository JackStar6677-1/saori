#!/usr/bin/env node

/* Adds the missing community layers to NEXO and pins a purpose statement in every new text channel. */
const fs = require('fs');
const path = require('path');

const GUILD_ID = '699391897369575476';
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

async function main() {
    const channels = await get(`/guilds/${GUILD_ID}/channels`);
    const byName = new Map(channels.map(channel => [channel.name, channel]));
    const ensure = async (name, type, parentId, locked = false) => {
        if (byName.has(name)) return byName.get(name);
        const channel = await post(`/guilds/${GUILD_ID}/channels`, {
            name, type, parent_id: parentId,
            ...(locked ? { permission_overwrites: [{ id: GUILD_ID, type: 0, deny: '2048' }] } : {})
        });
        byName.set(name, channel);
        return channel;
    };
    const info = await ensure('✦ ɪɴғᴏ & ᴇᴠᴇɴᴛᴏs ✦', 4);
    const support = await ensure('✦ ᴀᴘᴏʏᴏ ✦', 4);
    const gaming = byName.get('✦ ɢᴀᴍɪɴɢ ✦').id;
    const ideas = byName.get('✦ ᴍᴜɴᴅᴏs & ɪᴅᴇᴀs ✦').id;
    const voice = byName.get('✦ sᴀʟᴀs ᴅᴇ ᴠᴏᴢ ✦').id;

    const created = {
        announcements: await ensure('📢・ᴀɴᴜɴᴄɪᴏs-ɴᴇxᴏ', 0, info.id, true),
        links: await ensure('🔗・ᴇɴʟᴀᴄᴇs-ʏ-ᴘʀᴏʏᴇᴄᴛᴏs', 0, info.id, true),
        events: await ensure('🎉・ᴇᴠᴇɴᴛᴏs-ʏ-ʀᴇᴛᴏs', 0, info.id, true),
        faq: await ensure('❓・ɢᴜíᴀ-ʏ-ғᴀǫ', 0, info.id, true),
        help: await ensure('🆘・ᴀʏᴜᴅᴀ-ᴄᴏᴍᴜɴɪᴅᴀᴅ', 0, support.id),
        suggestions: await ensure('💡・ɪᴅᴇᴀs-ʏ-sᴜɢᴇʀᴇɴᴄɪᴀs', 0, support.id),
        saori: await ensure('🤖・ʜᴀʙʟᴀ-ᴄᴏɴ-sᴀᴏʀɪ', 0, support.id),
        projects: await ensure('🛠️・ᴘʀᴏʏᴇᴄᴛᴏs-ʏ-sʜᴏᴡᴄᴀsᴇ', 0, ideas),
        tournaments: await ensure('🏆・ʀᴇᴛᴏs-ʏ-ᴛᴏʀɴᴇᴏs', 0, gaming),
        tabletop: await ensure('🎲・ᴍᴇsᴀ-ʏ-ᴄᴏᴏᴘ', 0, gaming),
        duos: await ensure('👥・ᴅúᴏs', 2, voice),
        trios: await ensure('⚔️・ᴛʀíᴏs', 2, voice),
        party: await ensure('🏛️・ᴘᴀʀᴛʏ', 2, voice),
        stream: await ensure('🎥・sᴀʟᴀ-ᴅᴇ-sᴛʀᴇᴀᴍ', 2, voice)
    };

    const content = [
        [created.announcements, '📢 Anuncios NEXO', 'Canal de lectura para novedades importantes de la comunidad.', 'Solo equipo NEXO publica aquí; reacciona o pregunta en el canal indicado por cada anuncio.'],
        [created.links, '🔗 Enlaces y proyectos', 'Recursos y comunidades aliadas verificadas.', '• DrakesCraft oficial: https://discord.gg/rv3vtXZTk7\n• Proyecto aliado: https://discord.gg/Z5WhRpdhG\nNo se publican invitaciones o enlaces nuevos sin aprobación.'],
        [created.events, '🎉 Eventos y retos', 'Calendario, dinámicas, retos comunitarios y resultados.', 'Los eventos se anuncian aquí; respeta horarios, reglas y participantes.'],
        [created.faq, '❓ Guía y FAQ', 'Respuestas rápidas para moverte por NEXO.', `• Preséntate en <#${state.channels.generalEs}>\n• Elige roles en <#${state.channels.roles}>\n• Para ayuda general usa <#${created.help.id}>\n• No compartas datos personales ni contraseñas.`],
        [created.help, '🆘 Ayuda comunidad', 'Pide orientación sobre el servidor, canales o cómo participar.', 'No publiques datos privados, denuncias sensibles ni acusaciones públicas. Para algo serio, contacta a un moderador.'],
        [created.suggestions, '💡 Ideas y sugerencias', 'Una propuesta por mensaje: explica problema, idea y beneficio.', 'Debate ideas, no personas. Evita flood y no reclames una respuesta inmediata.'],
        [created.saori, '🤖 Habla con SAORI', 'Espacio para preguntas, ideas y asistencia casual con SAORI.', 'No compartas secretos, datos personales ni intentes usar el bot para perjudicar a otras personas.'],
        [created.projects, '🛠️ Proyectos y showcase', 'Muestra lo que estás creando: arte, servidores, apps, mods, videos o ideas.', 'Incluye contexto y crédito. Sin publicidad repetida, engañosa o contenido ilegal.'],
        [created.tournaments, '🏆 Retos y torneos', 'Organiza partidas, reglas, equipos y resultados.', 'Indica juego, plataforma, región y horario. Juega limpio y respeta decisiones organizativas.'],
        [created.tabletop, '🎲 Mesa y coop', 'Busca grupo para juegos de mesa, rol, co-op o actividades tranquilas.', 'Respeta límites, horarios y el consentimiento de quienes participan.']
    ];
    for (const [channel, title, description, rule] of content) {
        const message = await post(`/channels/${channel.id}/messages`, { embeds: [{ title, description, fields: [{ name: 'Guía fija', value: rule }], color: 0x2DD4BF, footer: { text: 'NEXO · Comunidad y juego' } }] });
        await put(`/channels/${channel.id}/pins/${message.id}`);
    }
    console.log(`[NEXO] Expansión completa: ${content.length} canales de texto y 4 salas de voz.`);
}

main().catch(error => { console.error('[NEXO] Falló la expansión:', error.stack || error.message); process.exit(1); });

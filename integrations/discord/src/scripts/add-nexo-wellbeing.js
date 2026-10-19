#!/usr/bin/env node

/* Provisions wellbeing, science and indie spaces plus selectable thematic roles for NEXO. */
const fs = require('fs');
const path = require('path');
const GUILD_ID = '699391897369575476';
const token = process.env.DISCORD_BOT_TOKEN;
const API = 'https://discord.com/api/v10';
const statePath = process.env.LEGACY_GUILD_STATE_PATH || path.join(__dirname, '..', 'legacy-guild-state.json');
if (!token) throw new Error('DISCORD_BOT_TOKEN no está definido.');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function request(method, endpoint, body, attempt = 0) {
    const response = await fetch(`${API}${endpoint}`, { method, headers: { Authorization: `Bot ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 204) return null;
    if (response.status === 429 && attempt < 20) { await sleep(Math.ceil((data.retry_after || 1) * 1000) + 100); return request(method, endpoint, body, attempt + 1); }
    if (!response.ok) throw new Error(`${method} ${endpoint}: ${response.status} ${JSON.stringify(data)}`);
    return data;
}
const get = endpoint => request('GET', endpoint);
const post = (endpoint, body) => request('POST', endpoint, body);
const put = endpoint => request('PUT', endpoint);
async function main() {
    const [channels, roles] = await Promise.all([get(`/guilds/${GUILD_ID}/channels`), get(`/guilds/${GUILD_ID}/roles`)]);
    const byName = new Map(channels.map(channel => [channel.name, channel]));
    const roleByName = new Map(roles.map(role => [role.name, role]));
    const ensureChannel = async (name, type, parentId) => {
        if (byName.has(name)) return byName.get(name);
        const channel = await post(`/guilds/${GUILD_ID}/channels`, { name, type, parent_id: parentId });
        byName.set(name, channel); return channel;
    };
    const ensureRole = async (key, name, color) => {
        if (roleByName.has(name)) return roleByName.get(name);
        const role = await post(`/guilds/${GUILD_ID}/roles`, { name, color, mentionable: false });
        roleByName.set(name, role); return role;
    };
    const category = await ensureChannel('✦ ʙɪᴇɴᴇsᴛᴀʀ & ᴄɪᴇɴᴄɪᴀ ✦', 4);
    const wellbeing = await ensureChannel('🌱・ᴀᴄᴏᴍᴘᴀñᴀᴍɪᴇɴᴛᴏ', 0, category.id);
    const psychology = await ensureChannel('🧠・ᴘsɪᴄᴏʟᴏɢíᴀ-ʏ-ʀᴇᴄᴜʀsᴏs', 0, category.id);
    const science = await ensureChannel('🔬・ᴄɪᴇɴᴄɪᴀ-ʏ-ᴄᴜʀɪᴏsɪᴅᴀᴅ', 0, category.id);
    const indie = await ensureChannel('👾・ɪɴᴅɪᴇ-ɢᴇᴍs', 0, category.id);
    const thematic = {
        bienestar: await ensureRole('bienestar', '🌱 ︱ ʙɪᴇɴᴇsᴛᴀʀ', 0x52B788),
        mente: await ensureRole('mente', '🧠 ︱ ᴍᴇɴᴛᴇ', 0xA78BFA),
        ciencia: await ensureRole('ciencia', '🔬 ︱ ᴄɪᴇɴᴄɪᴀ', 0x38BDF8),
        indie: await ensureRole('indie', '👾 ︱ ɪɴᴅɪᴇ', 0xFB7185)
    };
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.channels.wellbeing = wellbeing.id;
    state.channels.psychology = psychology.id;
    state.channels.science = science.id;
    state.channels.indie = indie.id;
    state.roles.themes = Object.fromEntries(Object.entries(thematic).map(([key, role]) => [key, role.id]));
    state.roles.staff = {
        owner: roleByName.get('👑 ︱ ɴᴇxᴏ ᴏᴡɴᴇʀ').id,
        admin: roleByName.get('🛡️ ︱ ᴀᴅᴍɪɴ').id,
        moderator: roleByName.get('⚔️ ︱ ᴍᴏᴅ').id,
        host: roleByName.get('🎙️ ︱ ʜᴏsᴛ').id,
        builder: roleByName.get('🧱 ︱ ʙᴜɪʟᴅᴇʀ').id
    };
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    const pin = async (channel, embed) => { const message = await post(`/channels/${channel.id}/messages`, { embeds: [embed] }); await put(`/channels/${channel.id}/pins/${message.id}`); return message; };
    await pin(wellbeing, { title: '🌱 Acompañamiento entre pares', color: 0x52B788, description: 'Un lugar para conversar con cuidado, compartir cómo te sientes y acompañar sin juzgar.', fields: [{ name: 'Límite importante', value: 'No es terapia, diagnóstico ni atención de crisis. Si tú o alguien está en peligro inmediato, contacta emergencias locales, una línea de crisis de tu país o una persona de confianza ahora.' }, { name: 'Cómo participar', value: 'Escucha, no minimices, no presiones por detalles y evita dar consejos médicos. Respeta siempre un “no quiero hablar de eso”.' }], footer: { text: 'NEXO · Cuidado, respeto y límites sanos' } });
    await pin(psychology, { title: '🧠 Psicología y recursos', color: 0xA78BFA, description: 'Psicoeducación, hábitos, comunicación y recursos confiables.', fields: [{ name: 'Regla', value: 'No diagnostiques a otros ni sustituyas ayuda profesional. Comparte fuentes y experiencias con humildad.' }, { name: 'Privacidad', value: 'No publiques datos personales, historiales clínicos, autolesiones gráficas ni contenido que pueda poner a alguien en riesgo.' }], footer: { text: 'NEXO · Información no sustituye atención profesional' } });
    await pin(science, { title: '🔬 Ciencia y curiosidad', color: 0x38BDF8, description: 'Preguntas, divulgación, experimentos seguros, espacio, naturaleza y pensamiento crítico.', fields: [{ name: 'Regla', value: 'Distingue evidencia, hipótesis y opinión. No presentes desinformación como hecho ni promuevas prácticas peligrosas.' }], footer: { text: 'NEXO · Curiosidad con rigor' } });
    await pin(indie, { title: '👾 Indie gems', color: 0xFB7185, description: 'Recomendaciones de joyas indie, demos, game jams y conversaciones de diseño.', fields: [{ name: 'Recomendación de la comunidad', value: '**Voices of the Void (VOTV)** · exploración, señales extrañas y sci-fi atmosférica.\nhttps://mrdrnose.itch.io/votv' }, { name: 'Regla', value: 'Indica plataforma, precio o demo cuando puedas. No compartas piratería, cracks ni enlaces sospechosos.' }], footer: { text: 'NEXO · Juegos pequeños, ideas enormes' } });
    const profile = await get(`/channels/${state.channels.roles}/messages?limit=20`);
    const oldThemeMenu = profile.find(message => message.components?.some(row => row.components?.some(component => component.custom_id === 'legacy_theme_roles')));
    if (!oldThemeMenu) {
        const menuMessage = await pin({ id: state.channels.roles }, { title: '✨ Temas que te interesan', color: 0xFB7185, description: 'Elige un tema para encontrar a tu gente.', footer: { text: 'NEXO · Roles temáticos' } });
        await request('PATCH', `/channels/${state.channels.roles}/messages/${menuMessage.id}`, { embeds: [{ title: '✨ Temas que te interesan', color: 0xFB7185, description: 'Elige un tema para encontrar a tu gente.', footer: { text: 'NEXO · Roles temáticos' } }], components: [{ type: 1, components: [{ type: 3, custom_id: 'legacy_theme_roles', placeholder: '✨ Elige un tema', options: [['Bienestar', thematic.bienestar.id, '🌱'], ['Psicología', thematic.mente.id, '🧠'], ['Ciencia', thematic.ciencia.id, '🔬'], ['Indie games', thematic.indie.id, '👾']].map(([label, value, name]) => ({ label, value, emoji: { name } })) }] }] });
    }
    console.log('[NEXO] Bienestar, ciencia, indie, roles temáticos y estado de nicks configurados.');
}
main().catch(error => { console.error('[NEXO] Falló la ampliación temática:', error.stack || error.message); process.exit(1); });

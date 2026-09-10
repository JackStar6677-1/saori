#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const token = process.env.DISCORD_BOT_TOKEN;
const API = 'https://discord.com/api/v10';
const state = JSON.parse(fs.readFileSync(process.env.LEGACY_GUILD_STATE_PATH || path.join(__dirname, '..', 'legacy-guild-state.json'), 'utf8'));
if (!token) throw new Error('DISCORD_BOT_TOKEN no está definido.');

async function request(method, endpoint, body) {
    const response = await fetch(`${API}${endpoint}`, { method, headers: { Authorization: `Bot ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`${method} ${endpoint}: ${response.status} ${JSON.stringify(data)}`);
    return data;
}

async function main() {
    const message = await request('POST', `/channels/${state.channels.roles}/messages`, {
        embeds: [{ title: '✨ Temas que te interesan', color: 0xFB7185, description: 'Elige un tema para encontrar a tu gente.', footer: { text: 'NEXO · Roles temáticos' } }],
        components: [{ type: 1, components: [{ type: 3, custom_id: 'legacy_theme_roles', placeholder: '✨ Elige un tema', options: [
            ['Bienestar', state.roles.themes.bienestar, '🌱'], ['Psicología', state.roles.themes.mente, '🧠'], ['Ciencia', state.roles.themes.ciencia, '🔬'], ['Indie games', state.roles.themes.indie, '👾']
        ].map(([label, value, name]) => ({ label, value, emoji: { name } })) }] }]
    });
    await request('PUT', `/channels/${state.channels.roles}/pins/${message.id}`);
    console.log('[NEXO] Menú de roles temáticos fijado.');
}

main().catch(error => { console.error('[NEXO] Falló el menú temático:', error.stack || error.message); process.exit(1); });

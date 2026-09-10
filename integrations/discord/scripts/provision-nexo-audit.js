#!/usr/bin/env node

/* Creates an isolated, staff-only audit channel for NEXO and records it in state. */
const fs = require('fs');
const path = require('path');

const GUILD_ID = '699391897369575476';
const API = 'https://discord.com/api/v10';
const token = process.env.DISCORD_BOT_TOKEN;
const statePath = process.env.LEGACY_GUILD_STATE_PATH || path.join(__dirname, '..', 'legacy-guild-state.json');
if (!token) throw new Error('DISCORD_BOT_TOKEN no está definido.');

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function request(method, endpoint, body, attempt = 0) {
    const response = await fetch(`${API}${endpoint}`, {
        method,
        headers: { Authorization: `Bot ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 204) return null;
    if (response.status === 429 && attempt < 20) {
        await sleep(Math.ceil((data.retry_after || 1) * 1000) + 150);
        return request(method, endpoint, body, attempt + 1);
    }
    if (!response.ok) throw new Error(`${method} ${endpoint}: ${response.status} ${JSON.stringify(data)}`);
    return data;
}

async function main() {
    const [channels, roles, bot] = await Promise.all([
        request('GET', `/guilds/${GUILD_ID}/channels`),
        request('GET', `/guilds/${GUILD_ID}/roles`),
        request('GET', '/users/@me')
    ]);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const byName = new Map(channels.map(channel => [channel.name, channel]));
    const staffRoleIds = Object.values(state.roles.staff || {});
    const botMember = await request('GET', `/guilds/${GUILD_ID}/members/${bot.id}`);
    const botRoleId = botMember.roles.find(roleId => roles.some(role => role.id === roleId && role.managed));
    const overwrites = [
        { id: GUILD_ID, type: 0, deny: '1024' },
        ...staffRoleIds.map(id => ({ id, type: 0, allow: '66560' })), // ViewChannel + ReadMessageHistory
        ...(botRoleId ? [{ id: botRoleId, type: 0, allow: '68608' }] : []) // View, SendMessages, ReadHistory
    ];
    let category = byName.get('🛡️ ᴏᴘᴇʀᴀᴄɪᴏɴᴇs sʀᴇ');
    if (!category) {
        category = await request('POST', `/guilds/${GUILD_ID}/channels`, { name: '🛡️ ᴏᴘᴇʀᴀᴄɪᴏɴᴇs sʀᴇ', type: 4, permission_overwrites: overwrites });
    }
    let audit = byName.get('🛡️・ᴀᴜᴅɪᴛᴏʀíᴀ-nexo');
    if (!audit) {
        audit = await request('POST', `/guilds/${GUILD_ID}/channels`, {
            name: '🛡️・ᴀᴜᴅɪᴛᴏʀíᴀ-nexo', type: 0, parent_id: category.id,
            topic: 'Registro privado e inmutable de seguridad, moderación y cambios de NEXO.',
            permission_overwrites: overwrites
        });
    }
    state.channels.audit = audit.id;
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    const previous = await request('GET', `/channels/${audit.id}/messages?limit=10`);
    if (!previous.some(message => message.embeds?.[0]?.title === '🛡️ NEXO Security Audit')) {
        const message = await request('POST', `/channels/${audit.id}/messages`, {
            embeds: [{
                title: '🛡️ NEXO Security Audit', color: 0x38BDF8,
                description: 'Canal privado de trazabilidad operativa administrado por SAORI. Los registros de NEXO no se envían a DrakesCraft y los de DrakesCraft no se envían aquí.',
                fields: [
                    { name: 'Eventos cubiertos', value: 'Ingresos y salidas, roles y apodos, mensajes editados o eliminados, canales, bans, voz e hilos.' },
                    { name: 'Acceso', value: 'Solo staff de NEXO y SAORI. No usar para conversación: es un registro forense.' }
                ], footer: { text: 'NEXO · Aislamiento por guildId activo' }
            }]
        });
        await request('PUT', `/channels/${audit.id}/pins/${message.id}`);
    }
    console.log(`[NEXO-AUDIT] Canal privado configurado: ${audit.id}`);
}

main().catch(error => { console.error('[NEXO-AUDIT] Falló:', error.stack || error.message); process.exit(1); });

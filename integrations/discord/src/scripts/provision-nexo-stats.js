#!/usr/bin/env node

/* Provisions voice-label statistics owned exclusively by NEXO. */
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
    const channels = await request('GET', `/guilds/${GUILD_ID}/channels`);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const byName = new Map(channels.map(channel => [channel.name, channel]));
    const byId = new Map(channels.map(channel => [channel.id, channel]));
    const lockedLabelPermissions = [{ id: GUILD_ID, type: 0, allow: '1024', deny: '1048576' }]; // ViewChannel, deny Connect
    let category = byName.get('📊 ᴇsᴛᴀᴅísᴛɪᴄᴀs');
    if (!category) {
        category = await request('POST', `/guilds/${GUILD_ID}/channels`, {
            name: '📊 ᴇsᴛᴀᴅísᴛɪᴄᴀs', type: 4, permission_overwrites: lockedLabelPermissions
        });
    }
    const definitions = [
        ['total', '👥・ᴍɪᴇᴍʙʀᴏs: --'],
        ['humans', '🧑・ᴜsᴜᴀʀɪᴏs: --'],
        ['staff', '🛡️・sᴛᴀғғ: --'],
        ['online', '🟢・ᴇɴ ʟíɴᴇᴀ: --']
    ];
    const stats = {};
    for (const [key, name] of definitions) {
        let channel = byId.get(state.channels.stats?.[key]) || byName.get(name);
        if (!channel) {
            channel = await request('POST', `/guilds/${GUILD_ID}/channels`, {
                name, type: 2, parent_id: category.id, permission_overwrites: lockedLabelPermissions
            });
        }
        stats[key] = channel.id;
    }
    state.channels.stats = stats;
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    console.log(`[NEXO-STATS] Etiquetas creadas: ${Object.values(stats).join(', ')}`);
}

main().catch(error => { console.error('[NEXO-STATS] Falló:', error.stack || error.message); process.exit(1); });

#!/usr/bin/env node

/* Resumable, rate-limited nickname normalization for the complete NEXO member list. */
const fs = require('fs');
const path = require('path');
const { formatNickname, LEGACY_GUILD_ID } = require('../legacyGuild');

const token = process.env.DISCORD_BOT_TOKEN;
const ownerId = process.env.DISCORD_OWNER_ID || '493868699489665044';
const API = 'https://discord.com/api/v10';
const statePath = process.env.LEGACY_GUILD_STATE_PATH || path.join(__dirname, '..', 'legacy-guild-state.json');
const progressPath = path.join(__dirname, '..', 'nexo-nickname-sync-progress.json');
if (!token) throw new Error('DISCORD_BOT_TOKEN no está definido.');

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function readProgress() {
    try { return JSON.parse(fs.readFileSync(progressPath, 'utf8')); } catch { return { after: null, scanned: 0, updated: 0, skipped: 0, errors: [] }; }
}
function writeProgress(progress) { fs.writeFileSync(progressPath, `${JSON.stringify(progress, null, 2)}\n`, 'utf8'); }
function setBulkActive(active) {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.nicknameBulkSyncActive = active;
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
async function request(method, endpoint, body, attempt = 0) {
    const response = await fetch(`${API}${endpoint}`, { method, headers: { Authorization: `Bot ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 204) return null;
    if (response.status === 429 && attempt < 30) {
        await sleep(Math.ceil((data.retry_after || 1) * 1000) + 150);
        return request(method, endpoint, body, attempt + 1);
    }
    if (!response.ok) throw new Error(`${method} ${endpoint}: ${response.status} ${JSON.stringify(data)}`);
    return data;
}

async function main() {
    const progress = readProgress();
    setBulkActive(true);
    try {
        for (;;) {
            const query = new URLSearchParams({ limit: '1000', ...(progress.after ? { after: progress.after } : {}) });
            const members = await request('GET', `/guilds/${LEGACY_GUILD_ID}/members?${query}`);
            if (!members.length) break;
            for (const member of members) {
                progress.after = member.user.id;
                progress.scanned++;
                if (member.user.bot || member.user.id === ownerId) continue;
                const source = member.nick || member.user.global_name || member.user.username;
                const target = formatNickname(source, member.roles || []);
                if (!target || target === member.nick) continue;
                try {
                    await request('PATCH', `/guilds/${LEGACY_GUILD_ID}/members/${member.user.id}/nick`, { nick: target });
                    progress.updated++;
                } catch (error) {
                    progress.skipped++;
                    if (progress.errors.length < 50) progress.errors.push({ memberId: member.user.id, message: error.message });
                }
                // One mutation per 750 ms keeps below Discord's member-edit bucket.
                await sleep(750);
                if (progress.scanned % 25 === 0) writeProgress(progress);
            }
            writeProgress(progress);
            if (members.length < 1000) break;
        }
        progress.completedAt = new Date().toISOString();
        writeProgress(progress);
        console.log(`[NEXO-NICKS] Completado: ${progress.scanned} revisados, ${progress.updated} actualizados, ${progress.skipped} omitidos.`);
    } finally {
        setBulkActive(false);
    }
}

main().catch(error => { console.error('[NEXO-NICKS] Falló:', error.stack || error.message); process.exit(1); });

'use strict';
/**
 * Sincronizacion REAL de rangos VIP Minecraft -> Discord.
 *
 * Antes `syncPlayerRanksWithDiscord` era un mapa fijo de dos jugadores y nunca quitaba roles:
 * StoneAgeKing lucia Zeus en Discord siendo `default` (Polis) en el servidor (2026-09-20).
 *
 * Fuente de verdad: LuckPerms en YAML (`plugins/LuckPerms/yaml-storage`), leido por la API de
 * ficheros del panel: `uuidcache.txt` (uuid:nombre) y `users/<uuid>.yml` (parents con expiry).
 * Un jugador sin fichero es `default`. Se enlaza cada miembro de Discord con su IGN por apodo
 * (small caps -> ascii), nombre global o username; si no se resuelve, NO se le toca nada.
 *
 * Aplica: anade el rol del grupo VIP activo y quita los roles VIP que ya no tenga en el
 * servidor. Roles solo-Discord (streamer, influencer, booster) no se tocan. Dry run con
 * RANK_SYNC_DRY_RUN=1 (solo registra).
 */
const fetch = global.fetch || require('node-fetch');

const PTERO_BASE = `${(process.env.PTERODACTYL_PANEL_URL || 'https://panel.thegamehosting.com').replace(/\/+$/, '')}/api/client/servers/${process.env.PTERODACTYL_SERVER_ID || '38528a4e'}`;
const KEY = process.env.PTERODACTYL_API_KEY || '';
const UA = 'curl/8.5.0';
const DRY = process.env.RANK_SYNC_DRY_RUN === '1';

// Grupos de LuckPerms que tienen rol en Discord. Los que no son grupos LP (streamer, influencer)
// quedan fuera a proposito: son roles solo de Discord y no se sincronizan.
// oldschool se anade si esta en LP pero NUNCA se quita: en Discord tambien se otorga a mano a veteranos.
const ADD_ONLY = new Set(['oldschool']);
const LP_GROUPS = ['oldschool', 'hermes', 'hestia', 'hercules', 'hefesto', 'artemisa', 'afrodita', 'anubis', 'poseidon', 'thor', 'zeus', 'titan'];

const SMALL_CAPS = { 'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ғ': 'f', 'ɢ': 'g', 'ʜ': 'h', 'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p', 'ǫ': 'q', 'ʀ': 'r', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'ʏ': 'y', 'ᴢ': 'z' };

function fromSmallCaps(text) {
    let out = '';
    for (const ch of (text || '')) out += SMALL_CAPS[ch] || ch;
    return out;
}

/** Candidatos de IGN a partir de lo visible en Discord: apodo sin decoraciones, nombre global, username. */
function ignCandidates(member) {
    const raw = [member.nickname, member.user.globalName, member.user.username].filter(Boolean);
    const out = new Set();
    for (const r of raw) {
        let s = fromSmallCaps(r).normalize('NFKD').replace(/[̀-ͯ]/g, '');
        s = s.replace(/[✦★☆✧⚡][^✦★☆✧⚡]*[✦★☆✧⚡]/g, ' '); // prefijo de rango "✦ ʜᴇғᴇsᴛᴏ ✦"
        s = s.replace(/[✦★☆✧⚡]/g, ' ');
        // quitar sufijos de staff " - admin", " | mod"
        s = s.replace(/\s*[-–—|]\s*(admin|mod|dev|helper|builder|owner|staff|bufon|wife owner|husband owner|dios).*$/i, '');
        // solo el nombre completo limpio: un token suelto ("ney" de "ney_15") apuntaria a otro jugador
        const t = s.trim().replace(/[^A-Za-z0-9_.]/g, '');
        if (t.length >= 3) out.add(t.toLowerCase());
    }
    return [...out];
}

async function pteroJson(path) {
    const r = await fetch(`${PTERO_BASE}${path}`, { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json', 'User-Agent': UA }, timeout: 10000 });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
    return r.json();
}

async function pteroText(path) {
    const r = await fetch(`${PTERO_BASE}/files/contents?file=${encodeURIComponent(path)}`, { headers: { Authorization: `Bearer ${KEY}`, Accept: 'text/plain', 'User-Agent': UA }, timeout: 10000 });
    if (!r.ok) throw new Error(`HTTP ${r.status} contents ${path}`);
    return r.text();
}

/** Parser minimo del YAML de usuario de LuckPerms: solo `parents` (con o sin expiry) y `name`. */
function parseUserYaml(text) {
    const parents = [];
    let name = null;
    let inParents = false;
    let current = null;
    for (const line of text.split('\n')) {
        const m = line.match(/^name:\s*(.+)$/);
        if (m) { name = m[1].trim(); continue; }
        if (/^parents:\s*$/.test(line)) { inParents = true; continue; }
        if (inParents) {
            if (/^[^\s-]/.test(line)) { inParents = false; current = null; continue; }
            // formas que escribe LuckPerms: "- grupo" (permanente) y "- grupo:" + "    expiry: N" (temporal)
            let mm = line.match(/^- group:\s*(\S+)/);
            if (mm) { current = { group: mm[1].toLowerCase(), expiry: 0 }; parents.push(current); continue; }
            mm = line.match(/^-\s+([A-Za-z0-9_.-]+):?\s*$/);
            if (mm) { current = { group: mm[1].toLowerCase(), expiry: 0 }; parents.push(current); continue; }
            mm = line.match(/^\s+expiry:\s*(\d+)/);
            if (mm && current) { current.expiry = parseInt(mm[1], 10); continue; }
        }
    }
    return { name, parents };
}

const path = require('path');
const fs = require('fs');
/** Discord id -> IGN para cuentas cuyo nombre en Discord no es su IGN (src/data/rank-aliases.json). */
function loadAliases() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'rank-aliases.json'), 'utf8'));
    } catch (e) {
        return {};
    }
}

const cache = { users: new Map() }; // uuid -> { modifiedAt, groups: Set }

/** uuid -> Set de grupos VIP activos. Solo usuarios con fichero; el resto son default. */
async function loadLuckPermsGroups() {
    const now = Math.floor(Date.now() / 1000);
    const list = await pteroJson('/files/list?directory=' + encodeURIComponent('/plugins/LuckPerms/yaml-storage/users'));
    const result = new Map();
    for (const it of list.data || []) {
        const a = it.attributes;
        if (!a.is_file || !/^[0-9a-f-]{36}\.yml$/.test(a.name)) continue;
        const uuid = a.name.slice(0, 36);
        const cached = cache.users.get(uuid);
        let groups;
        if (cached && cached.modifiedAt === a.modified_at) {
            groups = cached.groups;
        } else {
            const parsed = parseUserYaml(await pteroText(`/plugins/LuckPerms/yaml-storage/users/${a.name}`));
            groups = new Set(parsed.parents.filter(p => LP_GROUPS.includes(p.group) && (!p.expiry || p.expiry > now)).map(p => p.group));
            cache.users.set(uuid, { modifiedAt: a.modified_at, groups });
        }
        result.set(uuid, groups);
    }
    return result;
}

/** nombre (lower) -> uuid desde uuidcache.txt */
async function loadUuidCache() {
    const text = await pteroText('/plugins/LuckPerms/yaml-storage/uuidcache.txt');
    const map = new Map();
    for (const line of text.split('\n')) {
        const m = line.match(/^([0-9a-f-]{36}):(.+)$/);
        if (m) map.set(m[2].trim().toLowerCase(), m[1]);
    }
    return map;
}

/**
 * @param guild guild de DrakesCraft
 * @param rankRoles mapa grupo -> roleId (RANK_MAPPINGS del bot)
 * @param opts { skipMemberIds: Set }
 */
async function syncRanks(guild, rankRoles, opts = {}) {
    if (!KEY) { console.warn('[RANK-SYNC] PTERODACTYL_API_KEY ausente; sin sincronizacion.'); return null; }
    const skip = opts.skipMemberIds || new Set();
    const vipRoleIds = new Set(LP_GROUPS.map(g => rankRoles[g]).filter(Boolean));
    const [byName, groupsByUuid] = await Promise.all([loadUuidCache(), loadLuckPermsGroups()]);
    // el bot ya hace varios fetch de miembros al arrancar (opcode 8 se limita); usar la cache si esta completa
    const members = guild.members.cache.size >= guild.memberCount - 2 ? guild.members.cache : await guild.members.fetch();
    const aliases = loadAliases();
    const stats = { resueltos: 0, sinIgn: 0, anadidos: 0, quitados: 0, cambios: [], ambiguos: [] };
    for (const [, member] of members) {
        if (member.user.bot || skip.has(member.id)) continue;
        let uuid = null, ign = null;
        const alias = aliases[member.id];
        if (alias && byName.has(alias.toLowerCase())) {
            ign = alias.toLowerCase(); uuid = byName.get(ign);
        } else {
            // todos los candidatos que existen en el servidor; si apuntan a cuentas distintas, ambiguo
            const hits = new Map();
            for (const c of ignCandidates(member)) {
                if (byName.has(c)) hits.set(byName.get(c), c);
                else if (byName.has('.' + c)) hits.set(byName.get('.' + c), '.' + c); // Bedrock
            }
            if (hits.size > 1) {
                stats.ambiguos.push(`${member.user.tag}: ${[...hits.values()].join('/')}`);
                continue;
            }
            if (hits.size === 1) { [[uuid, ign]] = [...hits.entries()]; }
        }
        if (!uuid) { stats.sinIgn++; continue; }
        stats.resueltos++;
        const groups = groupsByUuid.get(uuid) || new Set();
        const expected = new Set([...groups].map(g => rankRoles[g]).filter(Boolean));
        for (const roleId of vipRoleIds) {
            const has = member.roles.cache.has(roleId);
            if (expected.has(roleId) && !has) {
                stats.anadidos++; stats.cambios.push(`+${member.user.tag}(${ign}) ${[...groups].join(',')}`);
                if (!DRY) await member.roles.add(roleId, `rank-sync: grupo LuckPerms ${[...groups].join(',')} (${ign})`).catch(e => console.error('[RANK-SYNC] add', member.user.tag, e.message));
            } else if (!expected.has(roleId) && has) {
                if ([...ADD_ONLY].some(g => rankRoles[g] === roleId)) continue;
                stats.quitados++; stats.cambios.push(`-${member.user.tag}(${ign}) rol ${roleId}`);
                if (!DRY) await member.roles.remove(roleId, `rank-sync: en el servidor ${ign} es ${groups.size ? [...groups].join(',') : 'default'}`).catch(e => console.error('[RANK-SYNC] remove', member.user.tag, e.message));
            }
        }
    }
    console.log(`[RANK-SYNC] ${DRY ? '(DRY RUN) ' : ''}resueltos=${stats.resueltos} sinIGN=${stats.sinIgn} ambiguos=${stats.ambiguos.length} +${stats.anadidos} -${stats.quitados}` + (stats.cambios.length ? ' :: ' + stats.cambios.join(' | ') : ''));
    if (stats.ambiguos.length) console.log('[RANK-SYNC] ambiguos (sin tocar, anade alias en src/data/rank-aliases.json): ' + stats.ambiguos.join(' | '));
    return stats;
}

module.exports = { syncRanks, parseUserYaml, ignCandidates, fromSmallCaps, LP_GROUPS };

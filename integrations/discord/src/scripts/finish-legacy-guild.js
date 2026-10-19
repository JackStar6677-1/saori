#!/usr/bin/env node

/* Completes a partially created NEXO guild without deleting existing objects. */
const fs = require('fs');
const path = require('path');

const GUILD_ID = '699391897369575476';
const token = process.env.DISCORD_BOT_TOKEN;
const API = 'https://discord.com/api/v10';
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
    if (response.status === 429 && attempt < 30) {
        await sleep(Math.ceil((data.retry_after || 1) * 1000) + 100);
        return request(method, endpoint, body, attempt + 1);
    }
    if (!response.ok) throw new Error(`${method} ${endpoint}: ${response.status} ${JSON.stringify(data)}`);
    return data;
}

const get = endpoint => request('GET', endpoint);
const post = (endpoint, body) => request('POST', endpoint, body);

async function main() {
    const [channels, roles] = await Promise.all([get(`/guilds/${GUILD_ID}/channels`), get(`/guilds/${GUILD_ID}/roles`)]);
    const byName = new Map(channels.map(channel => [channel.name, channel]));
    const role = name => roles.find(item => item.name === name)?.id;
    const category = name => byName.get(name)?.id;
    const ensure = async (name, type, parent) => {
        if (byName.has(name)) return byName.get(name);
        const channel = await post(`/guilds/${GUILD_ID}/channels`, { name, type, parent_id: parent });
        byName.set(name, channel);
        return channel;
    };

    const voice = category('VOZ');
    const staff = category('STAFF');
    await ensure('lounge', 2, voice);
    await ensure('gaming', 2, voice);
    await ensure('musica', 2, voice);
    await ensure('afk', 2, voice);
    await ensure('staff-hq', 0, staff);
    await ensure('mod-log', 0, staff);

    const state = {
        guildId: GUILD_ID,
        migrationEnabled: true,
        lastBroadcastKey: null,
        channels: {
            welcome: byName.get('bienvenida').id,
            rules: byName.get('normas-y-seguridad').id,
            migration: byName.get('mudanza-drakes').id,
            roles: byName.get('elige-tus-roles').id,
            generalEs: byName.get('general-es').id,
            safety: byName.get('alertas-de-seguridad').id
        },
        roles: {
            regions: { chile: role('Chile'), latam: role('Latinoamérica'), espana: role('España'), international: role('International') },
            interests: { gaming: role('Gaming'), tech: role('Tech & Dev'), creative: role('Arte & Creatividad'), music: role('Música') }
        }
    };
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

    const send = (channelId, body) => post(`/channels/${channelId}/messages`, body);
    await send(state.channels.welcome, { content: `# Bienvenido a NEXO\nUn lugar chill para conocer gente, conversar, jugar y crear. Pasa por <#${state.channels.rules}> y luego elige tus roles en <#${state.channels.roles}>.` });
    await send(state.channels.rules, { content: '# Normas simples\n1. Respeta a las personas y sus límites.\n2. Nada de acoso, discriminación, doxxing, estafas, phishing ni actividades ilegales.\n3. No spam ni publicidad no autorizada.\n4. Usa cada canal para su tema y cuida el ambiente.\n5. Si algo te incomoda, avisa al staff.\n\nLa idea es pasarla bien y que todos se sientan seguros.' });
    await send(state.channels.roles, { content: '# Personaliza tu perfil\nElige una región y un interés. Puedes cambiarlos cuando quieras.', components: [
        { type: 1, components: [{ type: 3, custom_id: 'legacy_region_roles', placeholder: 'Elige tu región', options: [['Chile', state.roles.regions.chile, '🇨🇱'], ['Latinoamérica', state.roles.regions.latam, '🌎'], ['España', state.roles.regions.espana, '🇪🇸'], ['International', state.roles.regions.international, '🌐']].map(([label, value, name]) => ({ label, value, emoji: { name } })) }] },
        { type: 1, components: [{ type: 3, custom_id: 'legacy_interest_roles', placeholder: 'Elige un interés', options: [['Gaming', state.roles.interests.gaming, '🎮'], ['Tech y desarrollo', state.roles.interests.tech, '💻'], ['Arte y creatividad', state.roles.interests.creative, '🎨'], ['Música', state.roles.interests.music, '🎵']].map(([label, value, name]) => ({ label, value, emoji: { name } })) }] }
    ] });
    const migration = await send(state.channels.migration, { content: '@everyone\n# ⚡ RECORDATORIO: NOS MUDAMOS DE CASA · ÚNETE AL NUEVO DISCORD ⚡\n\nHola a toda la comunidad de **DrakesCraft**. Este servidor antiguo queda como archivo. Para la comunidad activa, eventos, soporte y novedades, pásate a la nueva casa oficial:\n👉 **DrakesCraft:** https://discord.gg/rv3vtXZTk7\n👉 **Proyecto aliado:** https://discord.gg/Z5WhRpdhG\n\nCon los años este servidor acumuló miles de cuentas inactivas y canales obsoletos. Si quieres seguir presente, entra al Discord nuevo; si prefieres no recibir avisos, puedes salir de este servidor legado sin problema.\n\nLa actividad oficial de DrakesCraft se realiza únicamente en el servidor nuevo. Este aviso se mantiene visible para que nadie se quede fuera.', components: [{ type: 1, components: [{ type: 2, style: 4, custom_id: 'legacy_migration_disable', label: 'Desactivar avisos automáticos' }] }], allowed_mentions: { parse: ['everyone'] } });
    await request('PUT', `/channels/${state.channels.migration}/pins/${migration.id}`);
    console.log(`[NEXO] Finalización completa. Estado escrito en ${statePath}.`);
}

main().catch(error => { console.error('[NEXO] Falló la finalización:', error.stack || error.message); process.exit(1); });

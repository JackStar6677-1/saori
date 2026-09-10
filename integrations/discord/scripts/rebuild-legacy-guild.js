#!/usr/bin/env node

/* Rebuilds the archived DrakesCraft guild as NEXO. Run only with --apply. */
const fs = require('fs');
const path = require('path');

const GUILD_ID = '699391897369575476';
const OWNER_ID = process.env.DISCORD_OWNER_ID || '493868699489665044';
const token = process.env.DISCORD_BOT_TOKEN;
const statePath = process.env.LEGACY_GUILD_STATE_PATH
    || path.join(__dirname, '..', 'legacy-guild-state.json');
const API = 'https://discord.com/api/v10';

if (!token) throw new Error('DISCORD_BOT_TOKEN no está definido.');
if (!process.argv.includes('--apply')) {
    throw new Error('Operación destructiva bloqueada. Ejecuta con --apply tras validar el inventario.');
}

async function request(method, endpoint, body) {
    const response = await fetch(`${API}${endpoint}`, {
        method,
        headers: {
            Authorization: `Bot ${token}`,
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${method} ${endpoint}: ${response.status} ${JSON.stringify(data)}`);
    return data;
}

const get = endpoint => request('GET', endpoint);
const post = (endpoint, body) => request('POST', endpoint, body);
const patch = (endpoint, body) => request('PATCH', endpoint, body);
const del = endpoint => request('DELETE', endpoint);

async function createChannel(name, type, parentId, topic, locked = false, permissionOverwrites) {
    return post(`/guilds/${GUILD_ID}/channels`, {
        name,
        type,
        ...(parentId ? { parent_id: parentId } : {}),
        ...(topic ? { topic } : {}),
        ...(permissionOverwrites ? { permission_overwrites: permissionOverwrites } : locked
            ? { permission_overwrites: [{ id: GUILD_ID, type: 0, deny: '2048' }] }
            : {})
    });
}

async function main() {
    const [bot, guild, channels, roles] = await Promise.all([
        get('/users/@me'),
        get(`/guilds/${GUILD_ID}`),
        get(`/guilds/${GUILD_ID}/channels`),
        get(`/guilds/${GUILD_ID}/roles`)
    ]);
    console.log(`[NEXO] Reconstruyendo ${guild.name} (${channels.length} canales, ${roles.length} roles).`);

    // Community guilds require a rules and updates channel. Move those pointers to temporary
    // channels so every legacy channel can be removed without disabling Community features.
    const temporaryRules = await createChannel('nexo-temporal-reglas', 0, null, 'Canal temporal durante la reconstrucción.', true);
    const temporaryUpdates = await createChannel('nexo-temporal-avisos', 5, null, 'Canal temporal durante la reconstrucción.', true);
    await patch(`/guilds/${GUILD_ID}`, {
        rules_channel_id: temporaryRules.id,
        public_updates_channel_id: temporaryUpdates.id,
        system_channel_id: null
    });

    // Remove every old category, channel, thread and forum before rebuilding the information architecture.
    for (const channel of channels.sort((a, b) => b.type - a.type)) {
        await del(`/channels/${channel.id}`);
    }

    // Remove editable legacy roles. Managed integration roles are removed when their bot leaves the guild.
    for (const role of roles.filter(role => role.id !== GUILD_ID && !role.managed)) {
        await del(`/guilds/${GUILD_ID}/roles/${role.id}`);
    }

    let after;
    do {
        const members = await get(`/guilds/${GUILD_ID}/members?limit=1000${after ? `&after=${after}` : ''}`);
        for (const member of members) {
            if (member.user.bot && member.user.id !== bot.id) {
                await del(`/guilds/${GUILD_ID}/members/${member.user.id}`);
            }
        }
        after = members.length === 1000 ? members[members.length - 1].user.id : null;
    } while (after);

    await patch(`/guilds/${GUILD_ID}`, {
        name: 'NEXO | Social & Gaming',
        description: 'Comunidad chill para conocer gente, conversar, jugar y crear juntos.'
    });
    // Basic member permissions only. Moderation and administration are granted exclusively by staff roles.
    await patch(`/guilds/${GUILD_ID}/roles/${GUILD_ID}`, {
        permissions: String(1024n + 2048n + 64n + 16384n + 32768n + 65536n + 262144n + 1048576n + 2097152n + 33554432n + 67108864n + 2147483648n)
    });

    const roleDefinitions = [
        ['founder', '✦ Founder', 0xF6C667, true, '8'],
        ['staff', '✦ Staff', 0xE05263, true, String(2n + 4n + 8192n + (1n << 40n))],
        ['moderator', '✦ Moderator', 0xD97757, true, String(8192n + (1n << 40n))],
        ['host', '✦ Host', 0x4EA8DE, false, '0'],
        ['builder', '✦ Builder', 0x4EBA91, false, '0'],
        ['chile', 'Chile', 0xD94F5C, false, '0'],
        ['latam', 'Latinoamérica', 0xE9A23B, false, '0'],
        ['espana', 'España', 0xD86B45, false, '0'],
        ['international', 'International', 0x5E9FD6, false, '0'],
        ['gaming', 'Gaming', 0x8D6FD1, false, '0'],
        ['tech', 'Tech & Dev', 0x4EA8DE, false, '0'],
        ['creative', 'Arte & Creatividad', 0xDE6FA1, false, '0'],
        ['music', 'Música', 0xC891FF, false, '0']
    ];
    const createdRoles = {};
    for (const [key, name, color, hoist, permissions] of roleDefinitions) {
        createdRoles[key] = (await post(`/guilds/${GUILD_ID}/roles`, { name, color, hoist, mentionable: false, permissions })).id;
    }
    await request('PUT', `/guilds/${GUILD_ID}/members/${OWNER_ID}/roles/${createdRoles.founder}`);

    const start = await createChannel('COMIENZA-AQUI', 4);
    const social = await createChannel('SOCIAL', 4);
    const play = await createChannel('JUGAMOS', 4);
    const explore = await createChannel('MUNDOS-E-IDEAS', 4);
    const voice = await createChannel('VOZ', 4);
    const staff = await createChannel('STAFF', 4, null, null, false, [
        { id: GUILD_ID, type: 0, deny: '1024' },
        { id: createdRoles.founder, type: 0, allow: '3072' },
        { id: createdRoles.staff, type: 0, allow: '3072' },
        { id: createdRoles.moderator, type: 0, allow: '3072' }
    ]);

    const welcome = await createChannel('bienvenida', 0, start.id, 'El punto de partida de NEXO.', true);
    const rules = await createChannel('normas-y-seguridad', 0, start.id, 'Convivencia simple: respeto, seguridad y cero actividades ilegales.', true);
    const migration = await createChannel('mudanza-drakes', 5, start.id, 'Archivo y aviso permanente de migración de DrakesCraft.', true);
    const rolesChannel = await createChannel('elige-tus-roles', 0, start.id, 'Elige región e intereses para conocer mejor a la comunidad.', true);
    const generalEs = await createChannel('general-es', 0, social.id, 'El chat principal en español.');
    await createChannel('general-en', 0, social.id, 'English chat for everyone.');
    await createChannel('presentate', 0, social.id, 'Cuéntanos quién eres y qué te gusta hacer.');
    await createChannel('memes-y-media', 0, social.id, 'Memes, fotos y contenido sano.');
    await createChannel('random', 0, social.id, 'Conversaciones sin tema fijo.');
    await createChannel('busca-party', 0, play.id, 'Arma grupo para jugar.');
    await createChannel('minecraft-y-sandbox', 0, play.id, 'Minecraft, sandbox y construcciones.');
    await createChannel('otros-juegos', 0, play.id, 'Todo juego tiene espacio aquí.');
    await createChannel('clips-y-streams', 0, play.id, 'Clips, directos y momentos épicos.');
    await createChannel('paises-y-culturas', 0, explore.id, 'Conoce gente y costumbres de otros lugares.');
    await createChannel('tech-y-dev', 0, explore.id, 'Tecnología, programación y proyectos.');
    await createChannel('arte-musica-y-anime', 0, explore.id, 'Arte, música, anime y cultura pop.');
    await createChannel('recomendaciones', 0, explore.id, 'Series, juegos, música y cosas que valen la pena.');
    await createChannel('lounge', 2, voice.id, 'Charla casual.');
    await createChannel('gaming', 2, voice.id, 'Para jugar en grupo.');
    await createChannel('musica', 2, voice.id, 'Escucha y comparte música.');
    await createChannel('afk', 2, voice.id, 'Descanso automático.');
    await createChannel('staff-hq', 0, staff.id, 'Coordinación privada del equipo.', false);
    await createChannel('mod-log', 0, staff.id, 'Registro privado de moderación.', false);

    const state = {
        guildId: GUILD_ID,
        migrationEnabled: true,
        lastBroadcastKey: null,
        channels: { welcome: welcome.id, rules: rules.id, migration: migration.id, roles: rolesChannel.id, generalEs: generalEs.id },
        roles: {
            regions: Object.fromEntries(['chile', 'latam', 'espana', 'international'].map(key => [key, createdRoles[key]])),
            interests: Object.fromEntries(['gaming', 'tech', 'creative', 'music'].map(key => [key, createdRoles[key]]))
        }
    };
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

    await patch(`/guilds/${GUILD_ID}`, {
        rules_channel_id: rules.id,
        public_updates_channel_id: migration.id,
        system_channel_id: welcome.id
    });
    await del(`/channels/${temporaryRules.id}`);
    await del(`/channels/${temporaryUpdates.id}`);

    const send = (channelId, body) => post(`/channels/${channelId}/messages`, body);
    await send(welcome.id, { content: '# Bienvenido a NEXO\nUn lugar chill para conocer gente, conversar, jugar y crear. Pasa por <#' + rules.id + '> y luego elige tus roles en <#' + rolesChannel.id + '>.' });
    await send(rules.id, { content: '# Normas simples\n1. Respeta a las personas y sus límites.\n2. Nada de acoso, discriminación, doxxing, estafas, phishing ni actividades ilegales.\n3. No spam ni publicidad no autorizada.\n4. Usa cada canal para su tema y cuida el ambiente.\n5. Si algo te incomoda, avisa al staff.\n\nLa idea es pasarla bien y que todos se sientan seguros.' });
    const menuRows = [
        { type: 1, components: [{ type: 3, custom_id: 'legacy_region_roles', placeholder: 'Elige tu región', options: [['Chile', createdRoles.chile, '🇨🇱'], ['Latinoamérica', createdRoles.latam, '🌎'], ['España', createdRoles.espana, '🇪🇸'], ['International', createdRoles.international, '🌐']].map(([label, value, name]) => ({ label, value, emoji: { name } })) }] },
        { type: 1, components: [{ type: 3, custom_id: 'legacy_interest_roles', placeholder: 'Elige un interés', options: [['Gaming', createdRoles.gaming, '🎮'], ['Tech y desarrollo', createdRoles.tech, '💻'], ['Arte y creatividad', createdRoles.creative, '🎨'], ['Música', createdRoles.music, '🎵']].map(([label, value, name]) => ({ label, value, emoji: { name } })) }] }
    ];
    await send(rolesChannel.id, { content: '# Personaliza tu perfil\nElige una región y un interés. Puedes cambiarlos cuando quieras.', components: menuRows });
    const migrationMessage = await send(migration.id, {
        content: '@everyone\n# ⚡ RECORDATORIO: NOS MUDAMOS DE CASA · ÚNETE AL NUEVO DISCORD ⚡\n\nHola a toda la comunidad de **DrakesCraft**. Este servidor antiguo queda como archivo. Para la comunidad activa, eventos, soporte y novedades, pásate a la nueva casa oficial:\n👉 **DrakesCraft:** https://discord.gg/rv3vtXZTk7\n👉 **Proyecto aliado:** https://discord.gg/Z5WhRpdhG\n\nCon los años este servidor acumuló miles de cuentas inactivas y canales obsoletos. Si quieres seguir presente, entra al Discord nuevo; si prefieres no recibir avisos, puedes salir de este servidor legado sin problema.\n\nLa actividad oficial de DrakesCraft se realiza únicamente en el servidor nuevo. Este aviso se mantiene visible para que nadie se quede fuera.',
        components: [{ type: 1, components: [{ type: 2, style: 4, custom_id: 'legacy_migration_disable', label: 'Desactivar avisos automáticos' }] }],
        allowed_mentions: { parse: ['everyone'] }
    });
    await request('PUT', `/channels/${migration.id}/pins/${migrationMessage.id}`);
    console.log(`[NEXO] Estructura lista. Estado escrito en ${statePath}.`);
}

main().catch(error => {
    console.error('[NEXO] Falló la reconstrucción:', error.stack || error.message);
    process.exit(1);
});

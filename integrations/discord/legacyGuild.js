const fs = require('fs');
const path = require('path');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} = require('discord.js');

const LEGACY_GUILD_ID = '699391897369575476';
const STATE_PATH = process.env.LEGACY_GUILD_STATE_PATH
    || path.join(__dirname, 'legacy-guild-state.json');
const OWNER_ID = process.env.DISCORD_OWNER_ID || '493868699489665044';
let schedulerStarted = false;

const SMALL_CAPS = {
    a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ғ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 's', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ'
};

function readState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('[LEGACY-GUILD] No se pudo leer el estado:', error.message);
        }
        return null;
    }
}

function writeState(state) {
    const temporaryPath = `${STATE_PATH}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, STATE_PATH);
}

function migrationText() {
    return [
        '@everyone',
        '# ⚡ RECORDATORIO: NOS MUDAMOS DE CASA · ÚNETE AL NUEVO DISCORD ⚡',
        '',
        'Hola a toda la comunidad de **DrakesCraft**.',
        '',
        'Este servidor antiguo queda como archivo. Para la comunidad activa, eventos, soporte y novedades, pásate a la nueva casa oficial:',
        '👉 **DrakesCraft:** https://discord.gg/rv3vtXZTk7',
        '👉 **Proyecto aliado:** https://discord.gg/Z5WhRpdhG',
        '',
        'Con los años este servidor acumuló miles de cuentas inactivas y canales obsoletos. Si quieres seguir presente, entra al Discord nuevo; si prefieres no recibir avisos, puedes salir de este servidor legado sin problema.',
        '',
        'La actividad oficial de DrakesCraft se realiza únicamente en el servidor nuevo. Este aviso se mantiene visible para que nadie se quede fuera.'
    ].join('\n');
}

function migrationComponents(disabled = false) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('legacy_migration_disable')
            .setLabel(disabled ? 'Avisos desactivados' : 'Desactivar avisos automáticos')
            .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Danger)
            .setDisabled(disabled)
    )];
}

async function publishMigrationAnnouncement(guild, { pin = false } = {}) {
    const state = readState();
    if (!state?.channels?.migration) return null;

    const channel = await guild.channels.fetch(state.channels.migration).catch(() => null);
    if (!channel?.isTextBased()) {
        throw new Error('Canal de migración no disponible.');
    }

    const message = await channel.send({
        content: migrationText(),
        components: migrationComponents(!state.migrationEnabled),
        allowedMentions: { parse: ['everyone'] }
    });
    if (pin) await message.pin('Aviso permanente de migración').catch(() => {});
    return message;
}

function chileClock() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Santiago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date()).reduce((result, part) => {
        result[part.type] = part.value;
        return result;
    }, {});
    return {
        key: `${parts.year}-${parts.month}-${parts.day}`,
        hour: Number(parts.hour),
        minute: Number(parts.minute)
    };
}

function startMigrationScheduler(client) {
    if (schedulerStarted) return;
    schedulerStarted = true;

    const tick = async () => {
        const state = readState();
        if (!state?.migrationEnabled) return;

        const now = chileClock();
        if (now.minute !== 0 || ![12, 20].includes(now.hour)) return;
        const broadcastKey = `${now.key}-${now.hour}`;
        if (state.lastBroadcastKey === broadcastKey) return;

        const guild = client.guilds.cache.get(LEGACY_GUILD_ID);
        if (!guild) return;
        try {
            await publishMigrationAnnouncement(guild);
            state.lastBroadcastKey = broadcastKey;
            writeState(state);
            console.log(`[LEGACY-GUILD] Aviso de migración publicado: ${broadcastKey}.`);
        } catch (error) {
            console.error('[LEGACY-GUILD] Error publicando aviso programado:', error.message);
        }
    };

    setInterval(tick, 30_000);
    tick().catch(error => console.error('[LEGACY-GUILD] Error iniciando scheduler:', error.message));
}

async function onReady(client) {
    const guild = client.guilds.cache.get(LEGACY_GUILD_ID);
    if (!guild || !readState()) return;

    await guild.members.me?.setNickname('SAORI | NEXO').catch(error => {
        console.warn('[LEGACY-GUILD] No se pudo actualizar apodo:', error.message);
    });
    startMigrationScheduler(client);
    setTimeout(() => syncNicknames(guild).catch(error => console.warn('[LEGACY-GUILD] Nicknames:', error.message)), 20_000);
    setInterval(() => syncNicknames(guild).catch(error => console.warn('[LEGACY-GUILD] Nicknames:', error.message)), 5 * 60_000);
}

async function handleInteraction(interaction) {
    if (interaction.guildId !== LEGACY_GUILD_ID) return false;
    const state = readState();
    if (!state) return false;

    if (interaction.isButton() && interaction.customId === 'legacy_migration_disable') {
        if (interaction.user.id !== OWNER_ID) {
            await interaction.reply({ content: 'Solo Jack puede desactivar estos avisos.', ephemeral: true });
            return true;
        }

        state.migrationEnabled = false;
        writeState(state);
        await interaction.update({ components: migrationComponents(true) });
        await interaction.followUp({ content: 'Avisos automáticos de migración desactivados.', ephemeral: true });
        return true;
    }

    const groupByMenu = {
        legacy_region_roles: 'regions',
        legacy_interest_roles: 'interests',
        legacy_theme_roles: 'themes'
    };
    if (!interaction.isStringSelectMenu() || !groupByMenu[interaction.customId]) {
        return false;
    }

    const group = groupByMenu[interaction.customId];
    const groupRoles = state.roles?.[group] || {};
    const selectedRoleId = interaction.values[0];
    if (!Object.values(groupRoles).includes(selectedRoleId)) {
        await interaction.reply({ content: 'Ese rol ya no está disponible.', ephemeral: true });
        return true;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const previousRoleIds = Object.values(groupRoles).filter(roleId => member.roles.cache.has(roleId));
    if (previousRoleIds.length) await member.roles.remove(previousRoleIds, 'Actualización de autorrol NEXO');
    await member.roles.add(selectedRoleId, 'Autorrol NEXO');
    await interaction.reply({ content: 'Tu perfil de comunidad fue actualizado.', ephemeral: true });
    return true;
}

function isSaoriChannel(channelId) {
    return readState()?.channels?.saori === channelId;
}

function threadName(message, prefix) {
    const summary = (message.content || 'consulta')
        .replace(/<[@#&!0-9]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
    return `${prefix}: ${summary || 'consulta'}`.slice(0, 100);
}

async function handleMessage(message) {
    if (message.guildId !== LEGACY_GUILD_ID || message.author.bot || message.channel.isThread()) return;
    const state = readState();
    if (!state) return;

    const channels = state.channels || {};
    if (message.channelId === channels.help || message.channelId === channels.suggestions) {
        const prefix = message.channelId === channels.help ? 'Ayuda' : 'Idea';
        await message.startThread({ name: threadName(message, prefix), autoArchiveDuration: 1440 })
            .catch(error => console.warn('[LEGACY-GUILD] No se pudo abrir hilo:', error.message));
    }
}

function formatNickname(name, roleIds = []) {
    if (!name) return '';
    const state = readState();
    const staff = state?.roles?.staff || {};
    const suffixByRole = {
        [staff.owner]: ' - ᴏᴡɴᴇʀ',
        [staff.admin]: ' - ᴀᴅᴍɪɴ',
        [staff.moderator]: ' - ᴍᴏᴅ',
        [staff.host]: ' - ʜᴏsᴛ',
        [staff.builder]: ' - ʙᴜɪʟᴅᴇʀ'
    };
    const clean = name
        .replace(/\s*[-–—|]\s*(owner|admin|mod|host|builder|staff|ᴏᴡɴᴇʀ|ᴀᴅᴍɪɴ|ᴍᴏᴅ|ʜᴏsᴛ|ʙᴜɪʟᴅᴇʀ).*$/i, '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim();
    const small = [...clean].map(character => SMALL_CAPS[character.toLowerCase()] || character).join('').slice(0, 24).trim();
    const suffix = roleIds.map(id => suffixByRole[id]).find(Boolean) || '';
    return `${small}${suffix}`.slice(0, 32);
}

async function syncNicknames(guild) {
    if (guild.id !== LEGACY_GUILD_ID) return;
    if (readState()?.nicknameBulkSyncActive) return;
    // Do not issue a full gateway member request for a large legacy guild every cycle.
    const members = guild.members.cache;
    let normalized = 0;
    for (const member of members.values()) {
        if (normalized >= 25) break; // Keep Discord's nickname rate limit healthy.
        if (member.user.bot || member.id === OWNER_ID) continue;
        const target = formatNickname(member.nickname || member.user.globalName || member.user.username, [...member.roles.cache.keys()]);
        if (target && target !== member.nickname) {
            await member.setNickname(target, 'Normalización visual NEXO').catch(() => {});
            normalized++;
        }
    }
}

async function onMemberAdd(member) {
    if (member.guild.id !== LEGACY_GUILD_ID || member.user.bot || member.id === OWNER_ID) return;
    const memberRoleId = readState()?.roles?.member;
    if (memberRoleId) {
        await member.roles.add(memberRoleId, 'Rol base automático NEXO').catch(() => {});
    }
    const target = formatNickname(member.user.globalName || member.user.username, [...member.roles.cache.keys()]);
    if (target) await member.setNickname(target, 'Normalización visual NEXO').catch(() => {});
}

function roleMenus(state) {
    const regionOptions = [
        ['chile', 'Chile', '🇨🇱'],
        ['latam', 'Latinoamérica', '🌎'],
        ['espana', 'España', '🇪🇸'],
        ['international', 'International', '🌐']
    ].map(([key, label, emoji]) => new StringSelectMenuOptionBuilder()
        .setLabel(label).setValue(state.roles.regions[key]).setEmoji(emoji));
    const interestOptions = [
        ['gaming', 'Gaming', '🎮'],
        ['tech', 'Tech y desarrollo', '💻'],
        ['creative', 'Arte y creatividad', '🎨'],
        ['music', 'Música', '🎵']
    ].map(([key, label, emoji]) => new StringSelectMenuOptionBuilder()
        .setLabel(label).setValue(state.roles.interests[key]).setEmoji(emoji));
    const themeOptions = Object.entries(state.roles.themes || {}).map(([key, roleId]) => {
        const metadata = {
            bienestar: ['Bienestar', '🌱'], mente: ['Psicología', '🧠'], ciencia: ['Ciencia', '🔬'], indie: ['Indie games', '👾']
        }[key];
        return new StringSelectMenuOptionBuilder().setLabel(metadata[0]).setValue(roleId).setEmoji(metadata[1]);
    });

    return [
        new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId('legacy_region_roles').setPlaceholder('Elige tu región').addOptions(regionOptions)),
        new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId('legacy_interest_roles').setPlaceholder('Elige un interés').addOptions(interestOptions)),
        ...(themeOptions.length ? [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId('legacy_theme_roles').setPlaceholder('Elige un tema').addOptions(themeOptions))] : [])
    ];
}

module.exports = { LEGACY_GUILD_ID, migrationText, migrationComponents, onReady, onMemberAdd, handleInteraction, handleMessage, isSaoriChannel, formatNickname, publishMigrationAnnouncement, readState, roleMenus };

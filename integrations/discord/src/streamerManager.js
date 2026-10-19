const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const STREAMERS_PATHS = [
    process.env.STREAMERS_FILE,
    '/app/data/streamers.json',
    '/opt/stacks/saori-unified/discord/data/streamers.json',
    path.join(__dirname, '../data/streamers.json')
];

function getFilePath() {
    for (const p of STREAMERS_PATHS) {
        if (p && fs.existsSync(p)) return p;
    }
    return '/app/data/streamers.json';
}

function loadStreamers() {
    const f = getFilePath();
    try {
        if (fs.existsSync(f)) {
            const data = JSON.parse(fs.readFileSync(f, 'utf8'));
            if (Array.isArray(data)) return data;
        }
    } catch (e) {
        console.error('[STREAMERS] Error cargando streamers:', e.message);
    }
    return [{
        id: "UCbRPYRPORx09Ws-gCXEn7mg",
        handle: "@jackstar6677",
        name: "JackStar6677",
        url: "https://www.youtube.com/@jackstar6677",
        avatar: "https://yt3.ggpht.com/kzXkvH4SnbSReNumn9cBkNpHqSb_JOS1UKw2e8ecar3Cp0CHOmYEwfloBZy3o0H_kq4KJ7y5=s88-c-k-c0x00ffffff-no-rj",
        is_owner: true,
        notify_subscribers: true,
        notify_vods: true
    }];
}

function saveStreamers(list) {
    const f = getFilePath();
    try {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        const tmp = f + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
        fs.renameSync(tmp, f);
        return true;
    } catch (e) {
        console.error('[STREAMERS] Error guardando streamers:', e.message);
        return false;
    }
}

function fetchUrl(url, maxRedirects = 3) {
    return new Promise((resolve, reject) => {
        if (maxRedirects < 0) return reject(new Error('Demasiadas redirecciones HTTP'));
        const client = url.startsWith('http://') ? http : https;
        const req = client.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'es,en;q=0.9'
            },
            timeout: 10000
        }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                let redirectUrl = res.headers.location;
                if (redirectUrl.startsWith('/')) {
                    const parsed = new URL(url);
                    redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
                }
                return fetchUrl(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
            }
            if (res.statusCode >= 400) {
                return reject(new Error(`HTTP Error ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ body: data, finalUrl: url }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout de conexión')); });
    });
}

async function resolveChannel(target) {
    const clean = target.trim();
    let url = clean;
    let handle = null;

    if (clean.startsWith('@')) {
        handle = clean;
        url = `https://www.youtube.com/${clean}`;
    } else if (clean.includes('youtube.com')) {
        url = clean.startsWith('http') ? clean : `https://${clean}`;
        const hMatch = clean.match(/@([a-zA-Z0-9_\-\.]+)/);
        if (hMatch) handle = `@${hMatch[1]}`;
    } else if (clean.startsWith('UC') && clean.length === 24) {
        url = `https://www.youtube.com/channel/${clean}`;
    } else {
        handle = `@${clean}`;
        url = `https://www.youtube.com/@${clean}`;
    }

    const { body, finalUrl } = await fetchUrl(url);

    // 1. Channel ID
    const cidMatch = body.match(/channel_id=(UC[a-zA-Z0-9_-]{22})/) ||
                     body.match(/itemprop=["']channelId["'] content=["'](UC[a-zA-Z0-9_-]{22})["']/) ||
                     body.match(/canonical["'] href=["']https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})["']/);
    if (!cidMatch) {
        throw new Error('No se pudo identificar el ID del canal de YouTube.');
    }
    const channelId = cidMatch[1];

    // 2. Nombre
    const titleMatch = body.match(/<title>(.*?) - YouTube<\/title>/);
    let name = titleMatch ? titleMatch[1].trim() : (handle || 'Creador');

    // 3. Avatar
    const imgMatch = body.match(/property=["']og:image["'] content=["']([^"']+)["']/) ||
                     body.match(/content=["']([^"']+)["'] property=["']og:image["']/);
    const avatar = imgMatch ? imgMatch[1] : 'https://raw.githubusercontent.com/DrakesCraft-Labs/drakescraft-brand/main/logo_saori.png';

    // 4. Handle canónico
    if (!handle) {
        const handleMatch = body.match(/"canonicalBaseUrl":"\/(@[a-zA-Z0-9_\-\.]+)"/);
        if (handleMatch) handle = handleMatch[1];
    }

    return {
        id: channelId,
        handle: handle || `@${name.replace(/\s+/g, '')}`,
        name: name,
        url: handle ? `https://www.youtube.com/${handle}` : (finalUrl || `https://www.youtube.com/channel/${channelId}`),
        avatar: avatar,
        is_owner: false,
        notify_subscribers: false,
        notify_vods: true
    };
}

async function addStreamer(target, customName = null) {
    const info = await resolveChannel(target);
    if (customName) info.name = customName;

    const list = loadStreamers();
    const existingIndex = list.findIndex(s => s.id === info.id || (s.handle && s.handle.toLowerCase() === info.handle.toLowerCase()));

    if (existingIndex >= 0) {
        list[existingIndex] = { ...list[existingIndex], ...info };
        saveStreamers(list);
        return { updated: true, streamer: list[existingIndex] };
    }

    list.push(info);
    saveStreamers(list);
    return { updated: false, streamer: info };
}

function removeStreamer(target) {
    const clean = target.trim().toLowerCase();
    const list = loadStreamers();
    const index = list.findIndex(s => 
        clean === s.id?.toLowerCase() ||
        clean === s.handle?.toLowerCase() ||
        clean === s.name?.toLowerCase() ||
        (s.url && clean === s.url.toLowerCase()) ||
        (s.name && clean.length > 3 && s.name.toLowerCase().includes(clean))
    );

    if (index === -1) {
        return { success: false, reason: 'not_found' };
    }

    if (list[index].is_owner) {
        return { success: false, reason: 'is_owner' };
    }

    const removed = list.splice(index, 1)[0];
    saveStreamers(list);
    return { success: true, streamer: removed };
}

module.exports = {
    loadStreamers,
    saveStreamers,
    resolveChannel,
    addStreamer,
    removeStreamer
};

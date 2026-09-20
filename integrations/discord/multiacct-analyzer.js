/**
 * ============================================================================
 * 🕵️ MOTOR DE ANÁLISIS DE MULTICUENTAS, INTELIGENCIA IP Y DETECCIÓN DE VPN/PROXY
 * DrakesCraft Network · Saori SRE Security Suite
 * ============================================================================
 * 
 * Funcionalidades:
 * 1. Sincronización periódica con `plugins/nLogin/nlogin.db` (Dallas) para precargar
 *    el historial completo de todas las cuentas y sus IPs registradas.
 * 2. Watcher en tiempo real de `logs/latest.log` capturando cada evento de login:
 *    `[Server thread/INFO]: Player[/IP:port] logged in with entity id ...`
 * 3. Inteligencia de IP y detección de VPN/Proxy/Hosting:
 *    - Integración con ip-api.com (proxy, hosting, ISP, org, país).
 *    - Heurística profunda de ASN y datacenters (OVH, AWS, Hetzner, Vultr, etc.).
 *    - Caché persistente local con TTL de 7 días.
 * 4. Clasificador de riesgo y emisión de alertas a #🚨・ᴍᴏᴅ-ʟᴏɢs con cooldown inteligente.
 * 5. Consultas para comandos de Staff: salts, svpn, smulticuentas, ssyncaccounts.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { EmbedBuilder } = require('discord.js');

// Rutas de persistencia de caché
const STATE_DIR = __dirname;
const ACCOUNTS_CACHE_FILE = path.join(STATE_DIR, 'minecraft-accounts-ip-cache.json');
const IP_INTEL_CACHE_FILE = path.join(STATE_DIR, 'ip-intelligence-cache.json');
const ALERT_STATE_FILE = path.join(STATE_DIR, 'multiacct-alert-state.json');

// Constantes de configuración
const PTERO_SERVER_ID = '38528a4e';
const PTERO_BASE = 'https://panel.thegamehosting.com/api/client/servers/' + PTERO_SERVER_ID;
const IP_INTEL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;   // 6 horas por tupla (jugador+ip+motivo)
const KNOWN_DATACENTERS = [
    'ovh', 'digitalocean', 'hetzner', 'linode', 'amazon', 'aws', 'google cloud',
    'azure', 'microsoft', 'choopa', 'vultr', 'leaseweb', 'datacamp', 'm247',
    'quadranet', 'hostinger', 'contabo', 'cogent', 'clouvider', 'oracle',
    'fastly', 'cloudflare', 'packethub', 'kamatera', 'scaleway', 'ionos'
];

class MultiacctAnalyzer {
    constructor() {
        this.client = null;
        this.pteroApiKey = process.env.PTERODACTYL_API_KEY || '';
        this.modLogChannelId = '1539637396856111165'; // #🚨・ᴍᴏᴅ-ʟᴏɢs
        this.auditChannelId = null;

        // Estructuras en memoria
        // ip -> { ip, accounts: Set(string), lastSeen: Map(player -> timestamp), intel: object }
        this.ipMap = new Map();
        // playerLower -> { name, lastIp, ips: Set(string), lastSeen: number, uuid: string }
        this.playerMap = new Map();
        // ip -> intelData
        this.ipIntelCache = new Map();
        // hash -> timestamp
        this.alertHistory = new Map();
        // Set de hashes de líneas procesadas
        this.seenLogHashes = new Set();

        this.initialized = false;
        this.syncingDb = false;
        this.watchingLogs = false;
        this.watcherTimer = null;
        this.dbSyncTimer = null;
    }

    /**
     * Inicializa el analizador, carga cachés de disco y arranca los bucles de vigilancia.
     */
    async init(client, auditChannelId = null) {
        this.client = client;
        this.auditChannelId = auditChannelId;
        this.pteroApiKey = process.env.PTERODACTYL_API_KEY || '';

        console.log('[MULTIACCT] Inicializando Analizador de Multicuentas e Inteligencia IP...');
        this.loadCaches();

        // 1. Sincronización inicial de base de datos nLogin (asíncrona)
        this.syncNloginDatabase().catch(err => {
            console.error('[MULTIACCT] Error en sincronización inicial de nlogin.db:', err.message);
        });

        // 2. Watcher en tiempo real de latest.log (cada 45 segundos)
        this.watcherTimer = setInterval(() => {
            this.watchMinecraftLogins().catch(err => {
                console.error('[MULTIACCT-WATCHER] Error en ciclo de vigilancia:', err.message);
            });
        }, 45 * 1000);

        // 3. Sincronización periódica con nlogin.db (cada 30 minutos)
        this.dbSyncTimer = setInterval(() => {
            this.syncNloginDatabase().catch(err => {
                console.error('[MULTIACCT-DBSYNC] Error en ciclo de sincronización nlogin.db:', err.message);
            });
        }, 30 * 60 * 1000);

        // Primera pasada inmediata de logs tras 10 segundos de arranque
        setTimeout(() => {
            this.watchMinecraftLogins().catch(() => {});
        }, 10 * 1000);

        this.initialized = true;
        console.log('[MULTIACCT] ✅ Analizador y Watcher de Multicuentas y VPN activos.');
    }

    /**
     * Carga cachés persistentes desde el disco.
     */
    loadCaches() {
        try {
            if (fs.existsSync(IP_INTEL_CACHE_FILE)) {
                const data = JSON.parse(fs.readFileSync(IP_INTEL_CACHE_FILE, 'utf8'));
                for (const [ip, intel] of Object.entries(data)) {
                    this.ipIntelCache.set(ip, intel);
                }
                console.log(`[MULTIACCT] Cargadas ${this.ipIntelCache.size} IPs en caché de inteligencia.`);
            }
        } catch (e) {
            console.warn('[MULTIACCT] Error leyendo IP intel cache:', e.message);
        }

        try {
            if (fs.existsSync(ACCOUNTS_CACHE_FILE)) {
                const data = JSON.parse(fs.readFileSync(ACCOUNTS_CACHE_FILE, 'utf8'));
                if (data.players) {
                    for (const p of data.players) {
                        this.playerMap.set(p.name.toLowerCase(), {
                            name: p.name,
                            lastIp: p.lastIp,
                            ips: new Set(p.ips || [p.lastIp].filter(Boolean)),
                            lastSeen: p.lastSeen || 0,
                            uuid: p.uuid || ''
                        });
                    }
                }
                if (data.ips) {
                    for (const item of data.ips) {
                        const accountsSet = new Set(item.accounts || []);
                        const lastSeenMap = new Map();
                        if (item.lastSeen) {
                            for (const [acc, ts] of Object.entries(item.lastSeen)) {
                                lastSeenMap.set(acc, ts);
                            }
                        }
                        this.ipMap.set(item.ip, {
                            ip: item.ip,
                            accounts: accountsSet,
                            lastSeen: lastSeenMap,
                            intel: item.intel || null
                        });
                    }
                }
                console.log(`[MULTIACCT] Cargadas ${this.playerMap.size} cuentas y ${this.ipMap.size} IPs desde caché local.`);
            }
        } catch (e) {
            console.warn('[MULTIACCT] Error leyendo accounts cache:', e.message);
        }

        try {
            if (fs.existsSync(ALERT_STATE_FILE)) {
                const data = JSON.parse(fs.readFileSync(ALERT_STATE_FILE, 'utf8'));
                if (data.alerts) {
                    for (const [k, ts] of Object.entries(data.alerts)) {
                        this.alertHistory.set(k, ts);
                    }
                }
                if (Array.isArray(data.seenLogHashes)) {
                    this.seenLogHashes = new Set(data.seenLogHashes.slice(-15000));
                }
            }
        } catch (e) {
            console.warn('[MULTIACCT] Error leyendo alert state:', e.message);
        }
    }

    /**
     * Guarda las estructuras en memoria en archivos JSON persistentes.
     */
    saveCaches() {
        try {
            // 1. Guardar IP Intel Cache
            const intelObj = {};
            for (const [ip, intel] of this.ipIntelCache.entries()) {
                intelObj[ip] = intel;
            }
            fs.writeFileSync(`${IP_INTEL_CACHE_FILE}.tmp`, JSON.stringify(intelObj, null, 2));
            fs.renameSync(`${IP_INTEL_CACHE_FILE}.tmp`, IP_INTEL_CACHE_FILE);

            // 2. Guardar Accounts Cache
            const playersArr = [];
            for (const p of this.playerMap.values()) {
                playersArr.push({
                    name: p.name,
                    lastIp: p.lastIp,
                    ips: Array.from(p.ips),
                    lastSeen: p.lastSeen,
                    uuid: p.uuid
                });
            }

            const ipsArr = [];
            for (const item of this.ipMap.values()) {
                const lastSeenObj = {};
                for (const [acc, ts] of item.lastSeen.entries()) {
                    lastSeenObj[acc] = ts;
                }
                ipsArr.push({
                    ip: item.ip,
                    accounts: Array.from(item.accounts),
                    lastSeen: lastSeenObj,
                    intel: item.intel || null
                });
            }

            fs.writeFileSync(`${ACCOUNTS_CACHE_FILE}.tmp`, JSON.stringify({ players: playersArr, ips: ipsArr }, null, 2));
            fs.renameSync(`${ACCOUNTS_CACHE_FILE}.tmp`, ACCOUNTS_CACHE_FILE);

            // 3. Guardar Alert History
            const alertsObj = {};
            const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
            for (const [k, ts] of this.alertHistory.entries()) {
                if (ts > cutoff) alertsObj[k] = ts;
            }

            fs.writeFileSync(`${ALERT_STATE_FILE}.tmp`, JSON.stringify({
                alerts: alertsObj,
                seenLogHashes: Array.from(this.seenLogHashes).slice(-15000)
            }, null, 2));
            fs.renameSync(`${ALERT_STATE_FILE}.tmp`, ALERT_STATE_FILE);
        } catch (e) {
            console.error('[MULTIACCT] Error guardando cachés en disco:', e.message);
        }
    }

    /**
     * Consulta inteligencia de IP (ip-api.com) con caché persistente y heurística.
     */
    async lookupIpIntelligence(ip) {
        if (!ip || ip === '127.0.0.1' || ip === 'localhost' || ip.startsWith('10.') || ip.startsWith('192.168.')) {
            return {
                ip,
                country: 'Local / Privada',
                countryCode: 'XX',
                regionName: 'Local',
                city: 'Local',
                isp: 'Red Interna',
                org: 'Localhost',
                as: 'AS0',
                asname: 'Local',
                mobile: false,
                proxy: false,
                hosting: false,
                vpnRisk: 'LOW',
                isDatacenter: false,
                cachedAt: Date.now()
            };
        }

        const cached = this.ipIntelCache.get(ip);
        if (cached && (Date.now() - (cached.cachedAt || 0) < IP_INTEL_TTL_MS)) {
            return cached;
        }

        try {
            const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,regionName,city,isp,org,as,asname,mobile,proxy,hosting,query`;
            const res = await fetch(url, { headers: { 'User-Agent': 'curl/8.5.0' }, timeout: 6000 });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            if (data.status === 'success') {
                const orgStr = `${data.isp || ''} ${data.org || ''} ${data.as || ''} ${data.asname || ''}`.toLowerCase();
                const hasDcKeyword = KNOWN_DATACENTERS.some(k => orgStr.includes(k));
                const isProxy = data.proxy === true;
                const isHosting = data.hosting === true || hasDcKeyword;

                let vpnRisk = 'LOW';
                if (isProxy || isHosting) {
                    vpnRisk = 'HIGH';
                } else if (data.mobile) {
                    vpnRisk = 'LOW';
                }

                const intel = {
                    ip,
                    country: data.country || 'Desconocido',
                    countryCode: data.countryCode || '',
                    regionName: data.regionName || '',
                    city: data.city || '',
                    isp: data.isp || '',
                    org: data.org || '',
                    as: data.as || '',
                    asname: data.asname || '',
                    mobile: data.mobile === true,
                    proxy: isProxy,
                    hosting: isHosting,
                    vpnRisk,
                    isDatacenter: isHosting,
                    cachedAt: Date.now()
                };

                this.ipIntelCache.set(ip, intel);
                return intel;
            }
        } catch (e) {
            console.warn(`[MULTIACCT] Error consultando IP intel para ${ip}:`, e.message);
        }

        // Fallback básico si falla la API externa
        return cached || {
            ip,
            country: 'No disponible',
            countryCode: '',
            regionName: '',
            city: '',
            isp: 'No disponible',
            org: '',
            as: '',
            asname: '',
            mobile: false,
            proxy: false,
            hosting: false,
            vpnRisk: 'LOW',
            isDatacenter: false,
            cachedAt: Date.now()
        };
    }

    /**
     * Sincroniza el historial de cuentas desde `nlogin.db` en el servidor Dallas.
     */
    async syncNloginDatabase() {
        if (this.syncingDb) return;
        this.syncingDb = true;
        const tmpDbPath = '/tmp/nlogin_download.db';

        try {
            if (!this.pteroApiKey) {
                console.warn('[MULTIACCT] PTERODACTYL_API_KEY ausente; omitiendo sync de nlogin.db');
                return;
            }

            // 1. Obtener URL de descarga temporal
            const dlApiUrl = `${PTERO_BASE}/files/download?file=%2Fplugins%2FnLogin%2Fnlogin.db`;
            const dlRes = await fetch(dlApiUrl, {
                headers: {
                    'Authorization': `Bearer ${this.pteroApiKey}`,
                    'Accept': 'application/json',
                    'User-Agent': 'curl/8.5.0'
                },
                timeout: 8000
            });

            if (!dlRes.ok) {
                console.warn(`[MULTIACCT] Error solicitando descarga de nlogin.db: HTTP ${dlRes.status}`);
                return;
            }

            const dlData = await dlRes.json();
            const directUrl = dlData?.attributes?.url;
            if (!directUrl) throw new Error('No se recibió URL de descarga');

            // 2. Descargar archivo .db
            const fileRes = await fetch(directUrl, { headers: { 'User-Agent': 'curl/8.5.0' }, timeout: 15000 });
            if (!fileRes.ok) throw new Error(`Fallo descargando nlogin.db: HTTP ${fileRes.status}`);
            const buffer = await fileRes.arrayBuffer();
            fs.writeFileSync(tmpDbPath, Buffer.from(buffer));

            // 3. Extraer registros usando Python3 + sqlite3
            const pyScript = `
import sqlite3, json, sys
try:
    conn = sqlite3.connect(sys.argv[1])
    cur = conn.cursor()
    cur.execute("SELECT last_name, unique_id, last_ip, last_seen, creation_date FROM nlogin WHERE last_ip IS NOT NULL AND last_ip != '' AND last_ip != '127.0.0.1';")
    rows = cur.fetchall()
    conn.close()
    out = [{'name': r[0], 'uuid': r[1], 'ip': r[2], 'lastSeen': r[3] or 0, 'created': r[4] or 0} for r in rows]
    print(json.dumps(out))
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
`;
            const jsonOutput = await new Promise((resolve, reject) => {
                execFile('python3', ['-c', pyScript, tmpDbPath], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
                    if (err) return reject(new Error(stderr || err.message));
                    resolve(stdout);
                });
            });

            const records = JSON.parse(jsonOutput);
            let updatedAccounts = 0;

            for (const r of records) {
                if (!r.name || !r.ip) continue;
                this.recordAccountLogin(r.name, r.ip, r.uuid, r.lastSeen);
                updatedAccounts++;
            }

            this.saveCaches();
            console.log(`[MULTIACCT] Sincronización nlogin.db completada: ${updatedAccounts} cuentas indexadas.`);
        } catch (e) {
            console.error('[MULTIACCT] Error en sincronización de nlogin.db:', e.message);
        } finally {
            try { if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath); } catch (_) {}
            this.syncingDb = false;
        }
    }

    /**
     * Registra una vinculación Cuenta <-> IP en las estructuras en memoria.
     */
    recordAccountLogin(playerName, ip, uuid = '', timestamp = Date.now()) {
        const cleanName = playerName.trim();
        const pLower = cleanName.toLowerCase();
        const cleanIp = ip.trim();

        // 1. Actualizar mapa del jugador
        let pEntry = this.playerMap.get(pLower);
        if (!pEntry) {
            pEntry = {
                name: cleanName,
                lastIp: cleanIp,
                ips: new Set([cleanIp]),
                lastSeen: timestamp,
                uuid: uuid || ''
            };
            this.playerMap.set(pLower, pEntry);
        } else {
            pEntry.name = cleanName;
            pEntry.lastIp = cleanIp;
            pEntry.ips.add(cleanIp);
            if (timestamp >= pEntry.lastSeen) {
                pEntry.lastSeen = timestamp;
            }
            if (uuid && !pEntry.uuid) pEntry.uuid = uuid;
        }

        // 2. Actualizar mapa de la IP
        let ipEntry = this.ipMap.get(cleanIp);
        if (!ipEntry) {
            ipEntry = {
                ip: cleanIp,
                accounts: new Set([cleanName]),
                lastSeen: new Map([[cleanName, timestamp]]),
                intel: null
            };
            this.ipMap.set(cleanIp, ipEntry);
        } else {
            ipEntry.accounts.add(cleanName);
            const prevSeen = ipEntry.lastSeen.get(cleanName) || 0;
            if (timestamp >= prevSeen) {
                ipEntry.lastSeen.set(cleanName, timestamp);
            }
        }
    }

    /**
     * Escanea `latest.log` en busca de eventos de conexión en tiempo real.
     */
    async watchMinecraftLogins() {
        if (this.watchingLogs || !this.pteroApiKey) return;
        this.watchingLogs = true;

        try {
            const logsUrl = `${PTERO_BASE}/files/contents?file=logs%2Flatest.log`;
            const res = await fetch(logsUrl, {
                headers: {
                    'Authorization': `Bearer ${this.pteroApiKey}`,
                    'Accept': 'application/json',
                    'User-Agent': 'curl/8.5.0'
                },
                timeout: 8000
            });

            if (!res.ok) return;
            const text = await res.text();
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

            // Regex de login en Paper 1.21:
            // [02:14:20] [Server thread/INFO]: jobboy[/74.105.88.238:2950] logged in with entity id 698833 at ...
            const loginRegex = /\[Server thread\/INFO\]:\s+([A-Za-z0-9_.~-]{3,32})\[\/([0-9a-fA-F.:]+):(\d+)\]\s+logged in with entity id/i;

            const freshLogins = [];
            for (const line of lines) {
                const hash = crypto.createHash('sha256').update(line).digest('hex');
                if (this.seenLogHashes.has(hash)) continue;
                this.seenLogHashes.add(hash);

                const match = line.match(loginRegex);
                if (match) {
                    freshLogins.push({
                        player: match[1],
                        ip: match[2],
                        port: match[3],
                        rawLine: line
                    });
                }
            }

            for (const login of freshLogins) {
                await this.handleLiveLogin(login.player, login.ip);
            }

            if (freshLogins.length > 0) {
                this.saveCaches();
            }
        } catch (e) {
            console.error('[MULTIACCT-WATCHER] Error revisando latest.log:', e.message);
        } finally {
            this.watchingLogs = false;
        }
    }

    /**
     * Procesa un login detectado en vivo, consulta inteligencia IP y decide si emite alerta.
     */
    async handleLiveLogin(player, ip) {
        this.recordAccountLogin(player, ip, '', Date.now());
        const intel = await this.lookupIpIntelligence(ip);

        // Vincular intel al registro de la IP
        const ipEntry = this.ipMap.get(ip);
        if (ipEntry) ipEntry.intel = intel;

        const accountsOnThisIp = ipEntry ? Array.from(ipEntry.accounts) : [player];
        const isMulti = accountsOnThisIp.length > 1;
        const isVpn = intel.vpnRisk === 'HIGH';

        // Evaluar necesidad de alerta
        if (isVpn || isMulti) {
            await this.dispatchSecurityAlert({
                player,
                ip,
                intel,
                accountsOnThisIp,
                isVpn,
                isMulti
            });
        }
    }

    /**
     * Despacha un Embed enriquecido a #🚨・ᴍᴏᴅ-ʟᴏɢs respetando cooldowns para no saturar.
     */
    async dispatchSecurityAlert({ player, ip, intel, accountsOnThisIp, isVpn, isMulti }) {
        const alertType = isVpn && isMulti ? 'VPN_AND_MULTI' : (isVpn ? 'VPN_DETECTED' : 'MULTI_ACCOUNT');
        const alertKey = `${player}:${ip}:${alertType}`;
        const lastAlert = this.alertHistory.get(alertKey) || 0;

        if (Date.now() - lastAlert < ALERT_COOLDOWN_MS) {
            // En cooldown, no emitir duplicado
            return;
        }

        this.alertHistory.set(alertKey, Date.now());

        const isHighSeverity = isVpn || accountsOnThisIp.length >= 3;
        const embedColor = isVpn ? 0xE74C3C : (accountsOnThisIp.length >= 3 ? 0xE67E22 : 0xF1C40F);

        const flag = this.countryFlag(intel.countryCode);
        const geoStr = `${flag} ${intel.country || 'Desconocido'}${intel.city ? ` · ${intel.city}` : ''}`;
        const ispStr = intel.isp ? `${intel.isp} (${intel.as || 'N/A'})` : 'No disponible';

        let title = '🔍 Detección In-Game · Seguridad';
        if (isVpn && isMulti) {
            title = '🚨 ALERTA: Conexión con VPN y Multicuentas Asociadas';
        } else if (isVpn) {
            title = '🛡️ ALERTA: Conexión mediante VPN / Proxy / Datacenter';
        } else if (isMulti) {
            title = '👥 ALERTA: Conexión con Cuentas Múltiples (Misma IP)';
        }

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor(embedColor)
            .setDescription(`Se ha registrado una conexión in-game que cumple criterios de auditoría preventiva.\n**Jugador Activo:** \`${player}\``)
            .addFields(
                { name: '🌐 Dirección IP', value: `\`${ip}\``, inline: true },
                { name: '📍 Ubicación', value: geoStr, inline: true },
                { name: '🏢 Proveedor (ISP)', value: ispStr, inline: true },
                {
                    name: '🛡️ Estado de Red / Anonimato',
                    value: isVpn 
                        ? `🔴 **VPN / Proxy Activo** (Hosting: ${intel.hosting ? 'Sí' : 'No'} · Proxy: ${intel.proxy ? 'Sí' : 'No'})` 
                        : `🟢 **Conexión Residencial** (Limpia)`,
                    inline: false
                }
            )
            .setFooter({ text: 'DrakesCraft Security Fleet · Watcher Autónomo de Cuentas' })
            .setTimestamp();

        if (isMulti) {
            const listStr = accountsOnThisIp.map(acc => {
                const isCurrent = acc.toLowerCase() === player.toLowerCase();
                return isCurrent ? `• **${acc}** *(conectado ahora)*` : `• \`${acc}\``;
            }).join('\n');

            embed.addFields({
                name: `👥 Cuentas Vinculadas a esta IP (${accountsOnThisIp.length})`,
                value: listStr.slice(0, 1024),
                inline: false
            });
        }

        embed.addFields({
            name: '⚡ Acciones Recomendadas para el Staff',
            value: isVpn 
                ? '• Verifica si el jugador evade sanción previa.\n• Comprueba su actividad con `salts ' + player + '` o `/seen ' + player + '` in-game.'
                : '• Consulta con `salts ' + player + '` para auditar inventarios o posibles abusos de kits.',
            inline: false
        });

        // Enviar al canal de moderación
        await this.sendToModChannel(embed);
    }

    /**
     * Envía un embed al canal oficial de mod-logs.
     */
    async sendToModChannel(embed) {
        if (!this.client) return;
        try {
            const channel = this.client.channels.cache.get(this.modLogChannelId) ||
                            await this.client.channels.fetch(this.modLogChannelId).catch(() => null);
            if (channel && channel.isTextBased()) {
                await channel.send({ embeds: [embed] });
            }
        } catch (e) {
            console.error('[MULTIACCT] Error despachando alerta a mod-logs:', e.message);
        }
    }

    /**
     * Busca información completa de un jugador o una dirección IP.
     */
    async lookupTarget(target) {
        const clean = target.trim();
        const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(clean) || clean.includes(':');

        if (isIp) {
            return await this.lookupIp(clean);
        } else {
            return await this.lookupPlayer(clean);
        }
    }

    async lookupPlayer(playerName) {
        const pLower = playerName.toLowerCase().trim();
        const pEntry = this.playerMap.get(pLower);

        if (!pEntry) {
            return {
                found: false,
                query: playerName,
                type: 'player',
                message: `No se encontraron registros de la cuenta \`${playerName}\` en la base de datos local ni en nlogin.db.`
            };
        }

        const lastIp = pEntry.lastIp;
        const intel = lastIp ? await this.lookupIpIntelligence(lastIp) : null;
        const accountsOnSameIp = lastIp && this.ipMap.has(lastIp) 
            ? Array.from(this.ipMap.get(lastIp).accounts)
            : [pEntry.name];

        const otherIps = Array.from(pEntry.ips).filter(ip => ip !== lastIp);

        return {
            found: true,
            query: playerName,
            type: 'player',
            player: pEntry.name,
            uuid: pEntry.uuid,
            lastIp,
            lastSeen: pEntry.lastSeen,
            otherIps,
            intel,
            associatedAccounts: accountsOnSameIp,
            isMulti: accountsOnSameIp.length > 1,
            isVpn: intel ? intel.vpnRisk === 'HIGH' : false
        };
    }

    async lookupIp(ip) {
        const cleanIp = ip.trim();
        const ipEntry = this.ipMap.get(cleanIp);
        const intel = await this.lookupIpIntelligence(cleanIp);

        const accounts = ipEntry ? Array.from(ipEntry.accounts) : [];

        return {
            found: accounts.length > 0 || intel.country !== 'Desconocido',
            query: cleanIp,
            type: 'ip',
            ip: cleanIp,
            intel,
            associatedAccounts: accounts,
            isMulti: accounts.length > 1,
            isVpn: intel.vpnRisk === 'HIGH'
        };
    }

    /**
     * Devuelve el ranking de IPs con más cuentas asociadas.
     */
    getTopMultiAccounts(limit = 10) {
        const list = [];
        for (const [ip, entry] of this.ipMap.entries()) {
            if (ip === '127.0.0.1') continue;
            if (entry.accounts.size > 1) {
                list.push({
                    ip,
                    count: entry.accounts.size,
                    accounts: Array.from(entry.accounts),
                    intel: this.ipIntelCache.get(ip) || null
                });
            }
        }

        list.sort((a, b) => b.count - a.count);
        return list.slice(0, limit);
    }

    /**
     * Convierte un código de país de 2 letras en emoji de bandera.
     */
    countryFlag(countryCode) {
        if (!countryCode || countryCode.length !== 2) return '🌐';
        const code = countryCode.toUpperCase();
        const first = 0x1F1E6 + (code.charCodeAt(0) - 65);
        const second = 0x1F1E6 + (code.charCodeAt(1) - 65);
        return String.fromCodePoint(first, second);
    }
}

// Instancia singleton para el bot
const multiacctAnalyzer = new MultiacctAnalyzer();

module.exports = {
    multiacctAnalyzer,
    MultiacctAnalyzer
};

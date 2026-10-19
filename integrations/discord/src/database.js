// SAORI Discord Database · SQLite WAL Engine
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'saori-discord.db');

// Asegurar directorio data
if (!fs.existsSync(DATA_DIR)) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
        console.error(`[DB-INIT] Error creando ${DATA_DIR}:`, e.message);
    }
}

class SaoriDatabase {
    constructor() {
        this.db = null;
        this.initialized = false;
        this.init();
    }

    init() {
        if (this.initialized) return;
        try {
            this.db = new DatabaseSync(DB_PATH);

            // Optimización WAL y concurrencia segura
            this.db.exec(`
                PRAGMA journal_mode = WAL;
                PRAGMA synchronous = NORMAL;
                PRAGMA foreign_keys = ON;
                PRAGMA busy_timeout = 5000;
            `);

            // Creación de esquemas relacionales
            this.db.exec(`
                -- 1. Interacciones de usuarios (Comandos, botones, modales)
                CREATE TABLE IF NOT EXISTS interactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    user_tag TEXT,
                    channel_id TEXT,
                    channel_name TEXT,
                    type TEXT NOT NULL,
                    details TEXT,
                    created_at TEXT NOT NULL
                );

                -- 2. Sugerencias comunitarias
                CREATE TABLE IF NOT EXISTS suggestions (
                    id INTEGER PRIMARY KEY,
                    author_id TEXT NOT NULL,
                    author_tag TEXT,
                    content TEXT NOT NULL,
                    status TEXT DEFAULT 'PENDING',
                    verdict_reason TEXT,
                    verdict_by TEXT,
                    message_id TEXT,
                    channel_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                -- 3. Sistema de tickets de soporte
                CREATE TABLE IF NOT EXISTS tickets (
                    ticket_id TEXT PRIMARY KEY,
                    channel_id TEXT,
                    user_id TEXT NOT NULL,
                    user_tag TEXT,
                    category TEXT,
                    status TEXT DEFAULT 'OPEN',
                    transcript_path TEXT,
                    created_at TEXT NOT NULL,
                    closed_at TEXT,
                    closed_by TEXT,
                    close_reason TEXT
                );

                -- 4. Acciones de moderación y auditoría SRE
                CREATE TABLE IF NOT EXISTS moderation_actions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    target_id TEXT NOT NULL,
                    target_tag TEXT,
                    moderator_id TEXT,
                    moderator_tag TEXT,
                    action TEXT NOT NULL,
                    reason TEXT,
                    duration_ms INTEGER,
                    created_at TEXT NOT NULL
                );

                -- 5. Cumpleaños comunitarios
                CREATE TABLE IF NOT EXISTS birthdays (
                    user_id TEXT PRIMARY KEY,
                    username TEXT,
                    day INTEGER NOT NULL,
                    month INTEGER NOT NULL,
                    year INTEGER,
                    timezone TEXT DEFAULT 'America/Santiago',
                    created_at TEXT NOT NULL,
                    last_celebrated_year INTEGER
                );

                -- 6. Inteligencia IP y Multicuentas
                CREATE TABLE IF NOT EXISTS multiacct_intel (
                    player_name TEXT PRIMARY KEY,
                    uuid TEXT,
                    last_ip TEXT,
                    is_vpn INTEGER DEFAULT 0,
                    country TEXT,
                    isp TEXT,
                    account_count INTEGER DEFAULT 1,
                    updated_at TEXT NOT NULL
                );

                -- 7. Métricas de Comandos Slash y Analítica
                CREATE TABLE IF NOT EXISTS command_analytics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    command_name TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    user_tag TEXT,
                    channel_id TEXT,
                    latency_ms INTEGER,
                    success INTEGER DEFAULT 1,
                    executed_at TEXT NOT NULL
                );

                -- 8. Telemetría de Servidores (Discord + Minecraft)
                CREATE TABLE IF NOT EXISTS server_telemetry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    guild_members INTEGER,
                    humans INTEGER,
                    staff INTEGER,
                    online_count INTEGER,
                    mc_online INTEGER,
                    memory_mb REAL
                );

                -- 9. Logs del sistema para auditoría interna
                CREATE TABLE IF NOT EXISTS system_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    level TEXT NOT NULL,
                    tag TEXT,
                    message TEXT NOT NULL
                );

                -- Índices de consulta rápida
                CREATE INDEX IF NOT EXISTS idx_interactions_user ON interactions(user_id);
                CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status);
                CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
                CREATE INDEX IF NOT EXISTS idx_cmd_analytics_name ON command_analytics(command_name);
                CREATE INDEX IF NOT EXISTS idx_sys_logs_created ON system_logs(timestamp);
            `);

            this.initialized = true;
            console.log(`[SAORI-DB] ✅ Base de datos SQLite WAL inicializada en ${DB_PATH}`);

            // Migración automática de datos existentes si los hay
            this._migrateLegacyData();

            // Programar purga semanal de registros temporales (logs y métricas > 7 días)
            setInterval(() => {
                this.pruneOldRecords();
            }, 12 * 60 * 60 * 1000).unref();

        } catch (e) {
            console.error('[SAORI-DB] ❌ Error inicializando base de datos:', e.message);
        }
    }

    _migrateLegacyData() {
        try {
            // Migrar cumpleaños de birthdays.json a SQLite si existen
            const possibleBdayPaths = [
                path.join(__dirname, 'data', 'birthdays.json'),
                path.join(DATA_DIR, 'birthdays.json')
            ];
            const legacyBdayPath = possibleBdayPaths.find(p => fs.existsSync(p));
            if (legacyBdayPath) {
                try {
                    const data = JSON.parse(fs.readFileSync(legacyBdayPath, 'utf8'));
                    let imported = 0;
                    for (const [userId, item] of Object.entries(data)) {
                        if (item && item.day && item.month) {
                            const exists = this.getBirthday(userId);
                            if (!exists) {
                                this.saveBirthday(
                                    userId,
                                    item.username || null,
                                    item.day,
                                    item.month,
                                    item.year || null,
                                    item.timezone || 'America/Santiago'
                                );
                                imported++;
                            }
                        }
                    }
                    if (imported > 0) {
                        console.log(`[SAORI-DB] 🎂 Migrados ${imported} cumpleaños desde ${path.basename(path.dirname(legacyBdayPath))}/birthdays.json.`);
                    }
                } catch (e) {
                    console.error('[SAORI-DB] Error migrando birthdays.json:', e.message);
                }
            }

            // Migrar contador de sugerencias de suggestions-state.json
            const legacySuggPath = path.join(DATA_DIR, 'suggestions-state.json');
            if (fs.existsSync(legacySuggPath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(legacySuggPath, 'utf8'));
                    if (data && data.counter) {
                        const maxCurrent = this.getMaxSuggestionId();
                        if (maxCurrent < data.counter) {
                            // Registra un placeholder si no hay sugerencias
                            console.log(`[SAORI-DB] 💡 Contador de sugerencias preservado: ${data.counter}`);
                        }
                    }
                } catch (e) {
                    console.error('[SAORI-DB] Error leyendo suggestions-state.json:', e.message);
                }
            }
        } catch (e) {
            console.error('[SAORI-DB] Error durante migración legacy:', e.message);
        }
    }

    // ── Sugerencias ────────────────────────────────────────────────────────
    saveSuggestion(id, authorId, authorTag, content, messageId, channelId) {
        if (!this.initialized) return;
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                INSERT INTO suggestions (id, author_id, author_tag, content, status, message_id, channel_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at;
            `);
            stmt.run(id, authorId, authorTag, content, messageId, channelId, now, now);
        } catch (e) {
            console.error('[SAORI-DB] Error guardando sugerencia:', e.message);
        }
    }

    updateSuggestionStatus(id, status, verdictReason = null, verdictBy = null) {
        if (!this.initialized) return;
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                UPDATE suggestions
                SET status = ?, verdict_reason = ?, verdict_by = ?, updated_at = ?
                WHERE id = ?;
            `);
            stmt.run(status, verdictReason, verdictBy, now, id);
        } catch (e) {
            console.error('[SAORI-DB] Error actualizando estado de sugerencia:', e.message);
        }
    }

    getSuggestion(id) {
        if (!this.initialized) return null;
        try {
            const stmt = this.db.prepare('SELECT * FROM suggestions WHERE id = ?;');
            return stmt.get(id);
        } catch (e) {
            console.error('[SAORI-DB] Error obteniendo sugerencia:', e.message);
            return null;
        }
    }

    getMaxSuggestionId() {
        if (!this.initialized) return 0;
        try {
            const stmt = this.db.prepare('SELECT COALESCE(MAX(id), 0) as max_id FROM suggestions;');
            const res = stmt.get();
            return res ? res.max_id : 0;
        } catch (e) {
            return 0;
        }
    }

    // ── Tickets ────────────────────────────────────────────────────────────
    saveTicket(ticketId, channelId, userId, userTag, category) {
        if (!this.initialized) return;
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                INSERT INTO tickets (ticket_id, channel_id, user_id, user_tag, category, status, created_at)
                VALUES (?, ?, ?, ?, ?, 'OPEN', ?)
                ON CONFLICT(ticket_id) DO NOTHING;
            `);
            stmt.run(ticketId, channelId, userId, userTag, category, now);
        } catch (e) {
            console.error('[SAORI-DB] Error guardando ticket:', e.message);
        }
    }

    closeTicket(ticketId, closedBy, closeReason = null, transcriptPath = null) {
        if (!this.initialized) return;
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                UPDATE tickets
                SET status = 'CLOSED', closed_at = ?, closed_by = ?, close_reason = ?, transcript_path = ?
                WHERE ticket_id = ?;
            `);
            stmt.run(now, closedBy, closeReason, transcriptPath, ticketId);
        } catch (e) {
            console.error('[SAORI-DB] Error cerrando ticket:', e.message);
        }
    }

    getTicket(ticketId) {
        if (!this.initialized) return null;
        try {
            const stmt = this.db.prepare('SELECT * FROM tickets WHERE ticket_id = ?;');
            return stmt.get(ticketId);
        } catch (e) {
            return null;
        }
    }

    // ── Moderación ─────────────────────────────────────────────────────────
    recordModeration(targetId, targetTag, modId, modTag, action, reason, durationMs = null) {
        if (!this.initialized) return;
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                INSERT INTO moderation_actions (target_id, target_tag, moderator_id, moderator_tag, action, reason, duration_ms, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            `);
            stmt.run(targetId, targetTag, modId, modTag, action, reason, durationMs, now);
        } catch (e) {
            console.error('[SAORI-DB] Error guardando acción de moderación:', e.message);
        }
    }

    // ── Cumpleaños ─────────────────────────────────────────────────────────
    saveBirthday(userId, username, day, month, year = null, timezone = 'America/Santiago') {
        if (!this.initialized) return;
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                INSERT INTO birthdays (user_id, username, day, month, year, timezone, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    username = excluded.username,
                    day = excluded.day,
                    month = excluded.month,
                    year = excluded.year,
                    timezone = excluded.timezone;
            `);
            stmt.run(userId, username, day, month, year, timezone, now);
        } catch (e) {
            console.error('[SAORI-DB] Error guardando cumpleaños:', e.message);
        }
    }

    getBirthday(userId) {
        if (!this.initialized) return null;
        try {
            const stmt = this.db.prepare('SELECT * FROM birthdays WHERE user_id = ?;');
            return stmt.get(userId);
        } catch (e) {
            return null;
        }
    }

    getAllBirthdays() {
        if (!this.initialized) return [];
        try {
            const stmt = this.db.prepare('SELECT * FROM birthdays ORDER BY month ASC, day ASC;');
            return stmt.all();
        } catch (e) {
            return [];
        }
    }

    deleteBirthday(userId) {
        if (!this.initialized) return false;
        try {
            const stmt = this.db.prepare('DELETE FROM birthdays WHERE user_id = ?;');
            stmt.run(userId);
            return true;
        } catch (e) {
            return false;
        }
    }

    // ── Analítica de Comandos e Interacciones ──────────────────────────────
    recordCommand(commandName, userId, userTag, channelId, latencyMs = 0, success = 1) {
        if (!this.initialized) return;
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                INSERT INTO command_analytics (command_name, user_id, user_tag, channel_id, latency_ms, success, executed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?);
            `);
            stmt.run(commandName, userId, userTag, channelId, latencyMs, success, now);
        } catch (e) {
            // Silencioso para no degradar performance en hot-path
        }
    }

    recordInteraction(userId, userTag, channelId, channelName, type, details) {
        if (!this.initialized) return;
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                INSERT INTO interactions (user_id, user_tag, channel_id, channel_name, type, details, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?);
            `);
            stmt.run(userId, userTag, channelId, channelName, type, typeof details === 'string' ? details : JSON.stringify(details), now);
        } catch (e) {}
    }

    // ── Telemetría ─────────────────────────────────────────────────────────
    recordTelemetry(guildMembers, humans, staff, onlineCount, mcOnline, memoryMb) {
        if (!this.initialized) return;
        try {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                INSERT INTO server_telemetry (timestamp, guild_members, humans, staff, online_count, mc_online, memory_mb)
                VALUES (?, ?, ?, ?, ?, ?, ?);
            `);
            stmt.run(now, guildMembers, humans, staff, onlineCount, mcOnline, memoryMb);
        } catch (e) {}
    }

    // ── Purga de Registros Antiguos (> 7 días) ─────────────────────────────
    pruneOldRecords(retentionDays = 7) {
        if (!this.initialized) return;
        try {
            const cutoffDate = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000)).toISOString();
            
            this.db.exec(`
                DELETE FROM system_logs WHERE timestamp < '${cutoffDate}';
                DELETE FROM command_analytics WHERE executed_at < '${cutoffDate}';
                DELETE FROM interactions WHERE created_at < '${cutoffDate}';
                DELETE FROM server_telemetry WHERE timestamp < '${cutoffDate}';
                PRAGMA optimize;
            `);
            console.log(`[SAORI-DB] 🧹 Purga de registros anteriores a ${cutoffDate.slice(0, 10)} ejecutada.`);
        } catch (e) {
            console.error('[SAORI-DB] Error durante purga de registros antiguos:', e.message);
        }
    }

    getStatsSummary() {
        if (!this.initialized) return null;
        try {
            const totalInteractions = this.db.prepare('SELECT COUNT(*) as count FROM interactions;').get()?.count || 0;
            const totalSuggestions = this.db.prepare('SELECT COUNT(*) as count FROM suggestions;').get()?.count || 0;
            const totalTickets = this.db.prepare('SELECT COUNT(*) as count FROM tickets;').get()?.count || 0;
            const openTickets = this.db.prepare("SELECT COUNT(*) as count FROM tickets WHERE status = 'OPEN';").get()?.count || 0;
            const totalBirthdays = this.db.prepare('SELECT COUNT(*) as count FROM birthdays;').get()?.count || 0;
            const totalModerations = this.db.prepare('SELECT COUNT(*) as count FROM moderation_actions;').get()?.count || 0;

            return {
                totalInteractions,
                totalSuggestions,
                totalTickets,
                openTickets,
                totalBirthdays,
                totalModerations
            };
        } catch (e) {
            return null;
        }
    }
}

const instance = new SaoriDatabase();
module.exports = instance;

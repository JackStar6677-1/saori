// SAORI Discord Logger · Rotación Diaria y Retención Semanal (7 días)
const fs = require('fs');
const path = require('path');
const util = require('util');

const LOGS_DIR = path.resolve(__dirname, '..', 'logs');
const RETENTION_DAYS = 7;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Asegurar existencia del directorio de logs
if (!fs.existsSync(LOGS_DIR)) {
    try {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    } catch (e) {
        process.stderr.write(`[LOGGER-INIT] Error creando directorio ${LOGS_DIR}: ${e.message}\n`);
    }
}

function getLogFileName(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `saori-discord-${yyyy}-${mm}-${dd}.log`;
}

function stripAnsi(str) {
    if (typeof str !== 'string') return String(str);
    // Elimina códigos de escape ANSI de color
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

class SaoriLogger {
    constructor() {
        this.currentDateStr = null;
        this.currentStream = null;
        this._initRotation();
        this.pruneOldLogs();

        // Programar limpieza periódica de logs antiguos cada 12 horas
        setInterval(() => {
            this.pruneOldLogs();
        }, 12 * 60 * 60 * 1000).unref();
    }

    _initRotation() {
        const todayStr = getLogFileName();
        if (this.currentDateStr !== todayStr || !this.currentStream) {
            if (this.currentStream) {
                try { this.currentStream.end(); } catch (_) {}
            }
            this.currentDateStr = todayStr;
            const logFilePath = path.join(LOGS_DIR, todayStr);
            this.currentStream = fs.createWriteStream(logFilePath, { flags: 'a', encoding: 'utf8' });
        }
    }

    writeRaw(level, message) {
        this._initRotation();
        const now = new Date();
        const timestamp = now.toISOString().replace('T', ' ').replace('Z', '');
        const cleanMsg = stripAnsi(message);
        const line = `[${timestamp}] [${level}] ${cleanMsg}\n`;

        if (this.currentStream && !this.currentStream.destroyed) {
            this.currentStream.write(line);
        }
    }

    info(...args) {
        const msg = util.format(...args);
        process.stdout.write(msg + '\n');
        this.writeRaw('INFO', msg);
    }

    warn(...args) {
        const msg = util.format(...args);
        process.stdout.write(msg + '\n');
        this.writeRaw('WARN', msg);
    }

    error(...args) {
        const msg = util.format(...args);
        process.stderr.write(msg + '\n');
        this.writeRaw('ERROR', msg);
    }

    debug(...args) {
        const msg = util.format(...args);
        if (process.env.DEBUG === 'true' || process.env.SAORI_DEBUG === 'true') {
            process.stdout.write(msg + '\n');
            this.writeRaw('DEBUG', msg);
        }
    }

    audit(action, details = {}) {
        const msg = `[AUDIT] Action: ${action} | Details: ${JSON.stringify(details)}`;
        process.stdout.write(`🛡️ ${msg}\n`);
        this.writeRaw('AUDIT', msg);
    }

    /**
     * Elimina automáticamente cualquier archivo de log que tenga más de 7 días.
     * Esto evita que el disco se sature en Star o en producción.
     */
    pruneOldLogs() {
        try {
            if (!fs.existsSync(LOGS_DIR)) return;
            const files = fs.readdirSync(LOGS_DIR);
            const now = Date.now();
            let deletedCount = 0;

            for (const file of files) {
                if (!file.startsWith('saori-discord-') || !file.endsWith('.log')) continue;
                const filePath = path.join(LOGS_DIR, file);
                try {
                    const stats = fs.statSync(filePath);
                    const ageMs = now - stats.mtimeMs;
                    if (ageMs > RETENTION_MS) {
                        fs.unlinkSync(filePath);
                        deletedCount++;
                    }
                } catch (e) {
                    process.stderr.write(`[LOGGER-PRUNE] Error evaluando ${file}: ${e.message}\n`);
                }
            }

            if (deletedCount > 0) {
                const notice = `[LOGGER-PRUNE] 🧹 Eliminados ${deletedCount} archivos de log con más de ${RETENTION_DAYS} días de antigüedad.`;
                process.stdout.write(notice + '\n');
                this.writeRaw('SYSTEM', notice);
            }
        } catch (e) {
            process.stderr.write(`[LOGGER-PRUNE] Error durante limpieza de logs: ${e.message}\n`);
        }
    }

    /**
     * Intercepta console.log, console.warn y console.error para que queden
     * archivados en el log diario sin necesidad de reescribir llamadas existentes.
     */
    hookConsole() {
        const origLog = console.log.bind(console);
        const origWarn = console.warn.bind(console);
        const origError = console.error.bind(console);

        console.log = (...args) => {
            origLog(...args);
            const msg = util.format(...args);
            this.writeRaw('INFO', msg);
        };

        console.warn = (...args) => {
            origWarn(...args);
            const msg = util.format(...args);
            this.writeRaw('WARN', msg);
        };

        console.error = (...args) => {
            origError(...args);
            const msg = util.format(...args);
            this.writeRaw('ERROR', msg);
        };
    }
}

const instance = new SaoriLogger();
module.exports = instance;

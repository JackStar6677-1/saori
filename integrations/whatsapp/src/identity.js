// Identidad de remitentes de WhatsApp (LID <-> número).
// Lógica adaptada de OpenClaw (MIT): extensions/whatsapp/src/targets-runtime.ts, jidToE164 / readLidMapping.
//   https://github.com/openclaw/openclaw  (Copyright (c) OpenClaw contributors, licencia MIT)
// WhatsApp entrega a muchos remitentes como LID (<id>@lid) y no como número. Baileys >= 7 guarda en el directorio de autenticación
// `lid-mapping-<lid>_reverse.json` (LID -> teléfono) y añade `participantAlt`/`remoteJidAlt` a la clave del mensaje.
// Baileys 6.7.x (la versión actual del bot) no escribe esos archivos, por eso existe además `owner.json` con los LID del dueño:
// se aprenden una vez desde el log («Remitente LID sin número asociado: lid=») y se añaden a mano.
const fs = require('fs');
const path = require('path');

const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, '../data/auth_info');
const OWNER_FILE = process.env.WA_OWNER_FILE || path.join(__dirname, 'owner.json');
const RE_PN = /^(\d+)(?::\d+)?@(s\.whatsapp\.net|hosted)$/;
const RE_LID = /^(\d+)(?::\d+)?@(lid|hosted\.lid)$/;

/** Dígitos del teléfono de un JID de número, o de un LID si hay mapeo en disco. null si no se puede. */
function jidToPhone(jid, authDir = AUTH_DIR) {
    if (!jid) return null;
    const pn = String(jid).match(RE_PN);
    if (pn) return pn[1];
    const lid = String(jid).match(RE_LID);
    if (!lid) return null;
    try {
        const valor = JSON.parse(fs.readFileSync(path.join(authDir, `lid-mapping-${lid[1]}_reverse.json`), 'utf8'));
        if (valor !== null && valor !== undefined) {
            const digitos = String(valor).replace(/\D/g, '');
            if (digitos) return digitos;
        }
    } catch { /* sin archivo de mapeo */ }
    return null;
}

let cache = { t: 0, datos: { phone: '', lids: [] } };
/** Lee owner.json (teléfono del dueño y sus LID) con una caché corta; nunca lanza. */
function leerDueno() {
    if (Date.now() - cache.t < 15000) return cache.datos;
    let datos = { phone: '', lids: [] };
    try {
        const j = JSON.parse(fs.readFileSync(OWNER_FILE, 'utf8'));
        datos = { phone: String(j.phone || '').replace(/\D/g, ''), lids: (j.lids || []).map((x) => String(x).replace(/\D/g, '')).filter(Boolean) };
    } catch { /* sin archivo: no hay LID del dueño */ }
    cache = { t: Date.now(), datos };
    return datos;
}

/** ¿Este JID es un LID del dueño registrado en owner.json? */
function esLidDelDueno(jid) {
    const m = String(jid || '').match(RE_LID);
    return Boolean(m && leerDueno().lids.includes(m[1]));
}

/**
 * Resuelve el teléfono del remitente probando, en orden: el JID principal y los alternos de Baileys >= 7 (participantAlt, remoteJidAlt),
 * el mapeo LID->teléfono en disco y, por último, los LID del dueño. Devuelve { phone, via } o { phone: null, via: 'desconocido', lid }.
 */
function resolverRemitente(key) {
    const candidatos = [key && key.participant, key && key.participantAlt, key && key.remoteJid, key && key.remoteJidAlt].filter(Boolean);
    for (const jid of candidatos) {
        const phone = jidToPhone(jid);
        if (phone) return { phone, via: RE_LID.test(jid) ? 'mapeo-lid' : 'jid' };
    }
    for (const jid of candidatos) {
        if (esLidDelDueno(jid)) return { phone: leerDueno().phone || null, via: 'lid-del-dueno' };
    }
    const lid = candidatos.find((j) => RE_LID.test(j));
    return { phone: null, via: 'desconocido', lid: lid ? lid.split('@')[0] : null };
}

/**
 * Normaliza el destinatario para mensajes salientes.
 * Si el destinatario es Jack (por número o JID telefónico), resuelve a su LID registrado
 * en owner.json para asegurar compatibilidad criptográfica de Signal Protocol.
 */
function normalizarDestino(target) {
    if (!target) return target;
    let s = String(target).trim();
    if (s.endsWith('@g.us')) return s;
    if (s.endsWith('@lid') || s.endsWith('@hosted.lid')) return s;

    const dueno = leerDueno();
    const digits = s.replace(/\D/g, '');

    if (dueno.lids && dueno.lids.length > 0) {
        if (digits === dueno.phone || digits.endsWith('63477776') || s.includes(dueno.phone)) {
            return `${dueno.lids[0]}@lid`;
        }
    }

    if (!s.includes('@')) {
        return `${digits}@s.whatsapp.net`;
    }
    return s;
}

module.exports = { jidToPhone, leerDueno, esLidDelDueno, resolverRemitente, normalizarDestino };

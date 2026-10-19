// SAORI · Escudo comunitario: anti-flood/anti-spam y auto-etiquetado de foros.
// Aditivo y aislado: si algo falla, captura el error y NO interrumpe el bot.
const { PermissionFlagsBits } = require('discord.js');

// ── Anti-flood / anti-spam de imágenes ────────────────────────────────────
// Caso objetivo (reportado por Jack): varias imágenes en un solo mensaje sin
// texto (spam de cripto) y ráfagas de mensajes. Exime a staff por permisos.
const MAX_ADJUNTOS = 4;      // >= 4 imágenes en un mensaje
const LIMITE_TEXTO = 12;     // con < 12 chars de texto = flood de imágenes
const RAFAGA_MSGS = 6;       // 6 mensajes...
const RAFAGA_VENTANA = 7000; // ...en 7 segundos
const SILENCIO_MS = 5 * 60 * 1000; // timeout 5 min

const _ritmo = new Map(); // userId -> [timestamps]
// Limpieza periódica del mapa para no crecer sin límite.
setInterval(() => {
    const ahora = Date.now();
    for (const [k, arr] of _ritmo) {
        const vivos = arr.filter(t => ahora - t < RAFAGA_VENTANA);
        if (vivos.length) _ritmo.set(k, vivos); else _ritmo.delete(k);
    }
}, 60000).unref?.();

function _esStaff(member) {
    try {
        return member.permissions.has(PermissionFlagsBits.ManageMessages)
            || member.permissions.has(PermissionFlagsBits.ModerateMembers);
    } catch (e) { return false; }
}

// Devuelve true si bloqueó el mensaje (el caller debe hacer `return`).
async function antiFlood(message) {
    try {
        const member = message.member;
        if (!member) return false;
        if (_esStaff(member)) return false;

        let motivo = null;
        const nAtt = message.attachments?.size || 0;
        const textLen = (message.content || '').trim().length;
        if (nAtt >= MAX_ADJUNTOS && textLen < LIMITE_TEXTO) {
            motivo = `${nAtt} adjuntos sin texto`;
        }
        if (!motivo) {
            const ahora = Date.now();
            const arr = (_ritmo.get(message.author.id) || []).filter(t => ahora - t < RAFAGA_VENTANA);
            arr.push(ahora);
            _ritmo.set(message.author.id, arr);
            if (arr.length >= RAFAGA_MSGS) motivo = `${arr.length} mensajes en ${RAFAGA_VENTANA / 1000}s`;
        }
        if (!motivo) return false;

        await message.delete().catch(() => {});
        await member.timeout(SILENCIO_MS, `Saori anti-flood: ${motivo}`).catch(() => {});
        const aviso = await message.channel.send(
            `🛡️ ${message.author}, detecté **flood/spam** (${motivo}). Silencio de 5 min. Si fue error, avisa al staff.`
        ).catch(() => null);
        if (aviso) setTimeout(() => aviso.delete().catch(() => {}), 8000);
        console.log(`[SAORI-ANTIFLOOD] ${message.author.tag} en #${message.channel?.name}: ${motivo}`);
        return true;
    } catch (e) {
        console.error('[SAORI-ANTIFLOOD]', e.message);
        return false;
    }
}

// ── Auto-etiquetado del foro de reporte-de-bugs ───────────────────────────
const BUG_FORUM = process.env.CHANNEL_BUG_FORUM || '1539640716802662532';
const TAG = {
    INVESTIGACION: '1544914436442169350', // 🟡 En Investigación
    SLIMEFUN:      '1544914436467462285', // ⚡ Slimefun / Tech
    MODALIDAD:     '1544914436467462286', // 🏝 Modalidad / Mundo
};

async function autoTagForum(thread) {
    try {
        if (!thread || thread.parentId !== BUG_FORUM) return;
        if (Array.isArray(thread.appliedTags) && thread.appliedTags.length > 0) return;

        let texto = thread.name || '';
        for (let i = 0; i < 2; i++) {
            try {
                const sm = await thread.fetchStarterMessage();
                if (sm && sm.content) { texto += ' ' + sm.content; break; }
            } catch (e) { await new Promise(r => setTimeout(r, 1000)); }
        }
        texto = texto.toLowerCase();

        const tags = [];
        const esSlimefun = /(slimefun|m[aá]quina|machine|electric|core|reactor|android|geo|multiblock|infernal|exotic|network|energ[ií]a|automatiz|cargador|dust|ingot|smeltery)/.test(texto);
        const esModalidad = /(skyblock|oneblock|one block|survival|cl[aá]sico|clasico|modalidad|mundo|isla|bentobox|\/back|\/home|\/is|spawn)/.test(texto);
        if (esSlimefun) tags.push(TAG.SLIMEFUN);
        if (esModalidad) tags.push(TAG.MODALIDAD);
        tags.push(TAG.INVESTIGACION); // estado inicial por defecto

        const finales = [...new Set(tags)].slice(0, 5);
        await thread.setAppliedTags(finales, 'Saori: auto-etiquetado inicial').catch(e =>
            console.error('[SAORI-FORUMTAG] setAppliedTags:', e.message));
        console.log(`[SAORI-FORUMTAG] "${thread.name}" -> ${finales.length} tags`);
    } catch (e) {
        console.error('[SAORI-FORUMTAG]', e.message);
    }
}

module.exports = { antiFlood, autoTagForum, BUG_FORUM };

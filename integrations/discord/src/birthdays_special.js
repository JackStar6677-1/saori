// ==============================================================================
// 🎂 Celebraciones especiales (pedido de Jack, 2026-10-12)
// Secuencia de mensajes SOLO en el canal de cumpleaños, tras el embed normal.
// Se aplica una vez por usuario y año (`anio`); despues el cumpleaños vuelve al formato normal.
// ==============================================================================
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const COLORES = [0xF1C40F, 0x9B59B6, 0x3498DB, 0xE67E22, 0xE91E63];

function anioSantiago() {
    return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric' }).format(new Date()));
}

// Mensajes generados por IA (scripts/saori_cumple_mensajes.py en Star); distintos cada vez.
function cargarGenerados(userId, nombre) {
    try {
        const f = path.join(__dirname, 'data', `cumple-${userId}-${anioSantiago()}.json`);
        const d = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (!Array.isArray(d.mensajes) || d.mensajes.length < 3) return null;
        const sub = (s) => String(s).replace(/\{nombre\}/g, nombre).replace(/\{mencion\}/g, `<@${userId}>`).slice(0, 3900);
        return d.mensajes.map((m, i) => ({ color: COLORES[i % COLORES.length], titulo: sub(m.titulo).slice(0, 250), texto: sub(m.texto), _ia: d.proveedor || 'ia' }));
    } catch (_) {
        return null;
    }
}

const ESPECIALES = {
    // drgr89. (Nix) - cumple 12/10
    '1143658959815856129': {
        pausaMs: 35 * 1000,
        mensajes: (id, nombre) => [
            {
                color: 0xF1C40F,
                titulo: '✨ Un momento, por favor…',
                texto: `Antes de que sigan los pasteles y los chistes, la comunidad quiere detenerse un instante para decirle algo importante a <@${id}>.`
            },
            {
                color: 0x9B59B6,
                titulo: `💎 ${nombre}, eres una persona valiosa`,
                texto: `Vales mucho aquí, y no por lo que construyes o consigues en el servidor, sino por cómo eres. ` +
                    `Tu presencia, tu forma de aparecer, las veces que ayudaste sin que nadie lo pidiera… dejan huella en esta comunidad, ` +
                    `aunque a veces no te lo digamos lo suficiente.`
            },
            {
                color: 0x3498DB,
                titulo: '🫂 No estás solo',
                texto: `Sabemos que hay días buenos y días que pesan. Si alguna vez te has sentido mal, sin fuerzas, sin rumbo o sin ganas de nada, ` +
                    `queremos que sepas algo: **no estás solo**. Aquí en DrakesCraft hay gente que te aprecia de verdad ` +
                    `y que te va a apoyar cuando lo necesites. Pedir ayuda no es una debilidad; es de las cosas más valientes que se pueden hacer. ` +
                    `Siempre tendrás un lugar y alguien con quien hablar.`
            },
            {
                color: 0xE67E22,
                titulo: '🎁 Regalos oficiales del Olimpo',
                texto: `• 🍰 Tarta infinita, sin calorías y sin Creepers.\n` +
                    `• 🫂 Abrazos virtuales ilimitados, canjeables en cualquier momento.\n` +
                    `• 🛡️ Bendición de Atenea para que este año sea mucho más amable contigo.\n` +
                    `• 🥔 Por hoy, tus papas valen netherita (decreto de la Papatrueque).`
            },
            {
                color: 0xE91E63,
                titulo: `💛 Feliz cumpleaños, ${nombre}`,
                texto: `Gracias por estar aquí y por ser parte de esta familia. Que este nuevo año te traiga calma cuando la necesites, ` +
                    `alegría de la buena y gente que te quiera siempre cerca.\n\n` +
                    `Con cariño de todo el staff y de la comunidad de DrakesCraft.\n` +
                    `*— SAORI (una IA, sí, pero este mensaje lo firma toda la comunidad)*`
            }
        ]
    }
};

function especialPara(userId, _anio) {
    return ESPECIALES[userId] || null;   // aplica cada anio; el contenido lo genera la IA y cae a los textos fijos si falla
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function ejecutarSecuencia(channel, userId, displayName, avatarUrl, e, opts = {}) {
    const pausa = opts.pausaMs ?? e.pausaMs;
    const gen = cargarGenerados(userId, displayName);
    const lista = gen || e.mensajes(userId, displayName);
    console.log(`[BIRTHDAYS] secuencia especial: ${gen ? 'mensajes IA (' + gen[0]._ia + ')' : 'textos fijos (sin archivo IA)'}`);
    let ultimo = null;
    for (let i = 0; i < lista.length; i++) {
        const m = lista[i];
        await esperar(pausa);
        try { await channel.sendTyping?.(); } catch (_) { /* opcional */ }
        await esperar(Math.min(4000, pausa));
        const emb = new EmbedBuilder().setColor(m.color).setTitle(m.titulo).setDescription(m.texto);
        if (i === lista.length - 1) {
            if (avatarUrl) emb.setThumbnail(avatarUrl);
            emb.setFooter({ text: '🎂 DrakesCraft Network · Con cariño' }).setTimestamp();
        }
        ultimo = await channel.send({ embeds: [emb], allowedMentions: { users: [userId] } });
    }
    if (ultimo) {
        for (const em of ['💛', '🫂', '🎂', '🎉']) {
            await ultimo.react(em).catch(() => {});
        }
    }
    return lista.length;
}

module.exports = { especialPara, ejecutarSecuencia, ESPECIALES };

// SAORI · Puente de traducción sobre LibreTranslate (self-hosted en Star).
// Requiere API key (LT_API_KEYS=true). Falla en silencio devolviendo null.
const fetch = require('node-fetch');
const LT_URL = process.env.LIBRETRANSLATE_URL || 'http://127.0.0.1:5001';
const LT_KEY = process.env.LIBRETRANSLATE_API_KEY || '';

// Palabras o patrones inequívocamente españoles / chilenos frecuentes en DrakesCraft
const SPANISH_INDICATORS = /\b(entonces|usas?|usar|usando|utilizar|hola|como|c[oó]mo|est[aá]s?|por\s*qu[eé]|porque|por|para|buen[oa]s?|gracias|tambi[eé]n|donde|d[oó]nde|cuando|cu[aá]ndo|quien(?:es)?|qui[eé]n(?:es)?|tien[eé]s?|tengo|hacer|hago|hace|haces|pued[oe]s?|jugar|servidor|pero|muy|bien|mal|creo|nada|nadie|tod[oa]s?|chicos?|gente|pana|weon|wn|po|ctm|lawea|wea|bacan|bac[aá]n|dale|plata|luca|lucas|amig[oa]s?|cosa|cosas|aqu[ií]|ac[aá]|ah[ií]|all[ií]|si|estoy|estan|est[aá]n|somos|eres|estaba|progama|programas?|deja|dejaste|cagada|manda|primera|vez|advertencia|kickea|kick|baneo|desbaneo|rango|dinero|tienda|comunicado|equipo|salud|reposo|ausente|licencia)\b|[ñ¿¡áéíóú]/i;

// Palabras exclusivas de portugués que no existen en español
const PORTUGUESE_INDICATORS = /\b(voc[eê]s?|n[aã]o|obrigad[oa]|muito|tamb[eé]m|fazer|legal|tudo|estou|ent[aã]o|com\s+certeza)\b|[ãõç]/i;

const AI_DAEMON_CHAT_URL = process.env.AI_DAEMON_URL || 'http://127.0.0.1:8089/chat';

// Consulta atómica a LibreTranslate
async function queryLibreTranslate(text, source, target) {
    if (!text || !text.trim()) return null;
    try {
        const r = await fetch(LT_URL + '/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                q: text,
                source: source,
                target: target,
                format: 'text',
                api_key: LT_KEY,
            }),
            timeout: 12000,
        });
        if (!r.ok) return null;
        return await r.json();
    } catch (e) {
        console.error('[SAORI-TRANSLATE-QUERY]', e.message);
        return null;
    }
}

// Enriquece solo mensajes breves (< 250 caracteres) con jerga gamer / modismos mediante LLM
// REGLA CRÍTICA: Mensajes largos o comunicados (> 250 caracteres) NUNCA se pasan por Luna
// para evitar que el LLM resuma, invente, corte o altere el texto oficial.
async function enriquecerConLuna(textoOriginal, traduccionBase, destino) {
    if (!textoOriginal || !textoOriginal.trim() || textoOriginal.trim().length < 3) return traduccionBase;
    if (textoOriginal.length > 250) return traduccionBase;

    try {
        const isToEnglish = destino === 'en';
        const prompt = isToEnglish
            ? `Act as an expert bilingual translator for a gaming community. Polish this short gaming text from Spanish to English into natural, fluent gamer English. Translate accurately. Output ONLY the polished English text without quotes:\n\n${textoOriginal}`
            : `Actúa como traductor bilingüe experto para una comunidad gamer. Pule este texto gamer del inglés al español latino natural. Devuelve ÚNICAMENTE la traducción sin comillas:\n\n${textoOriginal}`;

        const res = await fetch(AI_DAEMON_CHAT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, sender: 'SaoriTranslate' }),
            timeout: 5000
        });

        if (res.ok) {
            const data = await res.json();
            let aiText = (data.response || '').trim();
            aiText = aiText.replace(/^["'«“](.*)["'»”]$/s, '$1').trim();
            if (aiText && aiText.length >= 2 && !aiText.toLowerCase().includes('mis núcleos cognitivos')) {
                return aiText;
            }
        }
    } catch (_) {}
    return traduccionBase;
}

// Traduce textos multi-párrafo / comunicados completos dividiendo por párrafos
// para garantizar que LibreTranslate traduzca el 100% del texto sin cortar párrafos ni omitir secciones.
async function traducirTextoPorParrafos(texto, destino, origen = 'auto') {
    const rawParagraphs = texto.split(/\n{2,}/);
    const translatedParagraphs = [];
    let detectedLang = origen;

    for (const para of rawParagraphs) {
        const trimmed = para.trim();
        if (!trimmed) {
            translatedParagraphs.push('');
            continue;
        }

        // Preservar separadores markdown intactos (---, ___, ***)
        if (/^[-*_]{3,}$/.test(trimmed)) {
            translatedParagraphs.push('---');
            continue;
        }

        // Preservar encabezados de markdown (# Título, ## Subtítulo)
        let prefix = '';
        let contentToTranslate = trimmed;
        const headerMatch = trimmed.match(/^(#{1,6}\s+)/);
        if (headerMatch) {
            prefix = headerMatch[1];
            contentToTranslate = trimmed.slice(prefix.length).trim();
        }

        // Si el párrafo aún es largo (> 1200 chars), subdividir por oraciones o líneas
        if (contentToTranslate.length > 1200) {
            const lines = contentToTranslate.split('\n');
            const transLines = [];
            for (const line of lines) {
                const trLine = line.trim();
                if (!trLine) {
                    transLines.push('');
                    continue;
                }
                const res = await queryLibreTranslate(trLine, origen, destino);
                if (res && res.translatedText) {
                    if (res.detectedLanguage && res.detectedLanguage.language) {
                        detectedLang = res.detectedLanguage.language;
                    }
                    transLines.push(res.translatedText);
                } else {
                    transLines.push(line);
                }
            }
            translatedParagraphs.push(prefix + transLines.join('\n'));
        } else {
            const res = await queryLibreTranslate(contentToTranslate, origen, destino);
            if (res && res.translatedText) {
                if (res.detectedLanguage && res.detectedLanguage.language) {
                    detectedLang = res.detectedLanguage.language;
                }
                translatedParagraphs.push(prefix + res.translatedText);
            } else {
                translatedParagraphs.push(para);
            }
        }
    }

    return { texto: translatedParagraphs.join('\n\n'), origen: detectedLang };
}

// Traduce y detecta en una sola llamada. Devuelve {texto, origen} o null.
async function traducir(texto, destino, origen = 'auto', enriquecerConIA = true) {
    try {
        if (!texto || !texto.trim()) return null;
        let sourceLang = origen;

        // Heurística pre-flight: Si es 'auto' y tiene patrones claros españoles sin marcas de portugués, forzar 'es'
        if (sourceLang === 'auto') {
            if (SPANISH_INDICATORS.test(texto) && !PORTUGUESE_INDICATORS.test(texto)) {
                sourceLang = 'es';
            }
        }

        // Si el texto contiene saltos de línea (\n) o supera los 350 caracteres,
        // traducir por párrafos para preservar el 100% del documento sin cortes ni truncamiento.
        if (texto.includes('\n') || texto.length > 350) {
            return await traducirTextoPorParrafos(texto, destino, sourceLang);
        }

        // Mensajes cortos de una sola línea:
        let j = await queryLibreTranslate(texto, sourceLang, destino);
        if (!j || !j.translatedText) return null;

        let detected = j.detectedLanguage?.language || sourceLang;

        // Post-flight sanity check: Si LibreTranslate detectó 'pt'/'gl' pero no hay vocabulario portugués real
        // y el servidor es primariamente hispanohablante, reintentar forzando 'es'
        if ((detected === 'pt' || detected === 'gl') && sourceLang === 'auto' && !PORTUGUESE_INDICATORS.test(texto)) {
            const retry = await queryLibreTranslate(texto, 'es', destino);
            if (retry && retry.translatedText) {
                j = retry;
                detected = 'es';
            }
        }

        let finalText = j.translatedText;
        if (enriquecerConIA && detected !== destino && texto.length <= 250) {
            finalText = await enriquecerConLuna(texto, finalText, destino);
        }

        return { texto: finalText, origen: detected };
    } catch (e) {
        console.error('[SAORI-TRANSLATE]', e.message);
        return null;
    }
}

// Traduce bloques de Markdown preservando párrafos, encabezados (#, ##, ###) y viñetas (*, -)
async function traducirMarkdown(texto, destino, origen = 'auto') {
    if (!texto || !texto.trim()) return texto;
    // Utilizar la traducción completa por párrafos directamente
    const res = await traducirTextoPorParrafos(texto, destino, origen);
    return res && res.texto ? res.texto : texto;
}

// Traduce un Discord Embed completo (título, descripción, campos) preservando estructura visual
async function traducirEmbed(rawEmbed, destino = 'en') {
    try {
        const { EmbedBuilder } = require('discord.js');
        const embData = rawEmbed.data || rawEmbed;
        const builder = new EmbedBuilder();

        let sourceLang = 'auto';

        // Muestrear título y descripción para detectar idioma de origen
        const sample = ((embData.title || '') + ' ' + (embData.description || '')).trim();
        if (sample) {
            const testRes = await traducir(sample.slice(0, 300), destino, 'auto', false);
            if (testRes && testRes.origen) {
                sourceLang = testRes.origen;
                if (sourceLang === destino) {
                    destino = (sourceLang === 'es' ? 'en' : 'es');
                }
            }
        }

        // Título
        if (embData.title) {
            const trTitle = await traducir(embData.title, destino, sourceLang, false);
            builder.setTitle(trTitle?.texto || embData.title);
        }

        // Descripción con markdown preservado
        if (embData.description) {
            const trDesc = await traducirMarkdown(embData.description, destino, sourceLang);
            builder.setDescription(trDesc || embData.description);
        }

        // Campos
        if (embData.fields && Array.isArray(embData.fields)) {
            for (const f of embData.fields) {
                const trName = await traducir(f.name, destino, sourceLang, false);
                const trVal = await traducirMarkdown(f.value, destino, sourceLang);
                builder.addFields({
                    name: trName?.texto || f.name,
                    value: trVal || f.value,
                    inline: !!f.inline
                });
            }
        }

        // Metadatos y diseño
        if (embData.url) builder.setURL(embData.url);
        builder.setColor(embData.color || 0x3498DB);
        if (embData.thumbnail?.url) builder.setThumbnail(embData.thumbnail.url);
        if (embData.image?.url) builder.setImage(embData.image.url);

        const isToEnglish = destino === 'en';
        builder.setFooter({
            text: isToEnglish
                ? '🌐 Official English Translation · Saori Multi-Language Bridge'
                : '🌐 Traducción Oficial al Español · Saori Multi-Language Bridge'
        });
        builder.setTimestamp(embData.timestamp ? new Date(embData.timestamp) : new Date());

        return { embed: builder, targetLang: destino, sourceLang };
    } catch (e) {
        console.error('[SAORI-TRANSLATE-EMBED]', e.message);
        return null;
    }
}

module.exports = { traducir, traducirMarkdown, traducirEmbed, LT_URL };

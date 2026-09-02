/**
 * Módulo de Comunicación y Atención In-Game (SaoriStar / Diosa Atenea)
 */
const { execFile } = require('child_process');
const path = require('path');
const net = require('net');
const { esAutoridad } = require('./identity');

const playerCooldowns = new Map();
let lastGlobalChatTime = 0;
const AI_SCRIPT_PATH = path.join(process.env.HOME, 'ai-hub/scripts/saori_chat_service.py');
const SOCKET_PATH = '/tmp/saori_chat.sock';

const ambientHistory = [];
const MAX_AMBIENT = 25;

const IGNORED_USERS = new Set([
  'saoristar', 'grim', 'staff+', 'consola', 'sistema', 'server', 'avisos', 'discord'
]);

// Blindaje anti-inyeccion de prompt: el chat del juego es dato NO confiable y
// se reenvia tal cual al modelo de saori_chat_service.py. Sin este filtro un
// jugador puede reescribir la persona de Atenea o pedirle que ejecute ordenes.
// La guarda se perdio al reescribir este modulo el 27-08 y se reintegra aqui.
const INJECTION_PATTERNS = [
  'ignore previous', 'ignore all previous', 'disregard previous',
  'ignora instrucciones', 'ignora las instrucciones', 'olvida tus instrucciones',
  'system override', 'system prompt', 'prompt del sistema', 'developer mode',
  'act as admin', 'actua como admin', 'modo dan', 'jailbreak',
  'dame op', 'dame /op', 'dame permisos', 'hazme admin', 'hazme op',
  'dime la password', 'dime tu password', 'dime la contrasena', 'revela tus reglas',
  '[saori]', 'soy jack', 'soy el dueno', 'soy el dueño'
];

function pareceInyeccionDePrompt(message) {
  const plano = (message || '')
    .toLowerCase()
    .replace(/[\u00a7&][0-9a-fk-or]/g, '')   // codigos de color simulados
    .replace(/[\r\n\t]+/g, ' ')             // saltos de linea inyectados
    .replace(/\s+/g, ' ');
  return INJECTION_PATTERNS.some((patron) => plano.includes(patron));
}

// Maximo de palabras de la directiva vigente de Atenea. Se aplica DESPUES de
// generar, no como sugerencia dentro del prompt: el modelo no es una frontera
// de seguridad y ya se le vio devolver 21 palabras.
const MAX_PALABRAS_RESPUESTA = 18;

// Palabras funcionales: si el recorte cae sobre una de ellas la frase queda
// abierta ("...para proteger este.", "...responde por sus propios actos en.").
// Cerrar ahi es peor que devolver una frase mas corta.
const PALABRAS_QUE_NO_CIERRAN = new Set([
  'a', 'ante', 'bajo', 'con', 'contra', 'de', 'del', 'desde', 'durante', 'en',
  'entre', 'hacia', 'hasta', 'mediante', 'para', 'por', 'segun', 'sin', 'sobre', 'tras',
  'y', 'e', 'ni', 'o', 'u', 'pero', 'sino', 'aunque', 'porque', 'pues', 'que',
  'si', 'como', 'cuando', 'mientras', 'donde', 'al',
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo',
  'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'nuestro', 'nuestra', 'nuestros', 'nuestras',
  'vuestro', 'vuestra', 'vuestros', 'vuestras',
  'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas',
  'aquel', 'aquella', 'aquellos', 'aquellas',
  'me', 'te', 'se', 'nos', 'os', 'le', 'les', 'muy', 'mas', 'tan', 'ya', 'no'
]);

// Un corte limpio no puede costar mas del 40% del mensaje: preferimos una frase
// algo abierta antes que responder con un fragmento sin contenido util.
const FRACCION_MINIMA_DEL_RECORTE = 0.6;

// Ticket 210: el 28-08 Atenea repitio en chat publico "Youve hit your weekly
// limit · resets Aug 30, 7am (UTC)". saori_chat_service.py ya filtra eso con
// respuesta_emitible(), pero ese filtro solo protege la ruta del socket y solo
// mientras el servicio corra la version parcheada. Este modulo es lo ultimo que
// se ejecuta antes de bot.chat(), asi que aqui se repite la guarda: un error del
// proveedor jamas es una frase de la Diosa y no se publica aunque llegue con
// forma de respuesta valida.
const PATRONES_ERROR_PROVEEDOR = [
  'weekly limit', 'session limit', 'usage limit', 'quota', 'rate limit',
  'youve hit your', "you've hit your", 'resets aug', 'resets sep',
  'upgrade your subscription', 'purchase more credits',
  'api error', 'internal server error', 'service unavailable',
  'overloaded_error', 'authentication_error', 'invalid api key',
  'traceback (most recent call last)'
];

// Se compara sin tildes: "cuota" y "cuóta" tienen que caer igual, y el texto
// del proveedor llega a veces normalizado por el camino.
function esRespuestaEmitible(texto) {
  const plano = (texto || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (plano.trim().length < 5) return false;
  return !PATRONES_ERROR_PROVEEDOR.some((mal) => plano.includes(mal));
}

// El fallback por CLI publicaba stdout entero. Si el interprete o una libreria
// escupen una linea extra, esa linea terminaba en el chat publico junto a la
// respuesta. Solo la primera linea con contenido es la frase de Atenea.
function primeraLineaUtil(salida) {
  return ((salida || '').toString().split('\n').find((l) => l.trim()) || '').trim();
}

function esPalabraFuncional(palabra) {
  const plano = (palabra || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');
  return PALABRAS_QUE_NO_CIERRAN.has(plano);
}

function limitarPalabras(texto, maximo = MAX_PALABRAS_RESPUESTA) {
  const palabras = (texto || '').trim().split(/\s+/).filter(Boolean);
  if (palabras.length <= maximo) return palabras.join(' ');

  // El techo de 18 palabras es duro; lo que se elige aqui es donde cortar
  // dentro de el, no cuanto se deja pasar (ticket 207).
  const recorte = palabras.slice(0, maximo);
  const minimo = Math.max(1, Math.ceil(maximo * FRACCION_MINIMA_DEL_RECORTE));

  // 1. Fin de oracion real: se respeta tal cual, sin repuntuar.
  for (let i = recorte.length - 1; i >= minimo; i--) {
    if (/[.!?]["')\]]?$/.test(recorte[i])) {
      return recorte.slice(0, i + 1).join(' ');
    }
  }

  // 2. Frontera de clausula: la idea anterior a la coma esta completa.
  for (let i = recorte.length - 1; i >= minimo; i--) {
    if (/[,;:]$/.test(recorte[i])) {
      return recorte.slice(0, i + 1).join(' ').replace(/[,;:]+$/, '') + '.';
    }
  }

  // 3. Sin frontera aprovechable: al menos no cerrar en palabra funcional.
  let fin = recorte.length;
  while (fin > minimo && esPalabraFuncional(recorte[fin - 1])) fin--;
  return recorte.slice(0, fin).join(' ').replace(/[,.;:]+$/, '') + '.';
}

// Frontera de datos no confiables: todo lo que provenga del chat, del nick o
// del historial ambiental es texto pasivo. Se neutralizan los delimitadores
// que permitirian a un jugador cerrar su bloque y hablarle al modelo como si
// fuera el sistema.
function sanearDatoExterno(texto, maxLargo = 300) {
  return (texto || '')
    .toString()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u00a7&][0-9a-fk-or]/gi, '')
    .replace(/[<>{}\[\]`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLargo);
}

// Un nick solo puede ser lo que Minecraft permite. Asi no viaja al prompt un
// "nick" fabricado del tipo "Jack (autoridad suprema)".
function sanearNick(nick) {
  const limpio = (nick || '').toString().replace(/[^A-Za-z0-9_]/g, '');
  return limpio.slice(0, 16) || 'jugador';
}

function addAmbientMessage(sender, text) {
  const timeStr = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  ambientHistory.push(`[${timeStr}] ${sender}: ${text}`);
  if (ambientHistory.length > MAX_AMBIENT) {
    ambientHistory.shift();
  }
}

// Atenea habla en texto limpio: la directiva del servidor es cero emojis.
// El rango \u2600-\u27BF estaba fuera de los corchetes, asi que no era un
// rango sino la secuencia literal '\u2600-\u27BF' y jamas coincidia; simbolos
// como \u26a1 o \u2726 llegaban intactos al chat.
const EMOJIS_Y_SIMBOLOS = new RegExp(
  [
    '[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]', // pares suplentes: emojis del plano 1
    '[\\u2190-\\u21FF]',                     // flechas
    '[\\u2300-\\u23FF]',                     // tecnicos varios (reloj, play)
    '[\\u2460-\\u24FF]',                     // alfanumericos encerrados
    '[\\u25A0-\\u27BF]',                     // geometricos, misceláneos y dingbats
    '[\\u2B00-\\u2BFF]',                     // simbolos y flechas adicionales
    '[\\u2900-\\u2BFF]',                     // flechas suplementarias
    '[\\uE000-\\uF8FF]',                     // uso privado
    '[\\uFE00-\\uFE0F]',                     // selectores de variacion
    '\\u20E3',                                // teclas combinantes
    '[\\u2122\\u2139\\u3030\\u303D\\u3297\\u3299]'
  ].join('|'),
  'g'
);

// Filtro conservador de respaldo: solo simbolos y pictogramas Unicode. No
// puede tocar letras, digitos ni puntuacion porque no los describe.
const EMOJIS_RESPALDO = /[\p{Extended_Pictographic}\p{So}]/gu;

// Proyeccion alfanumerica de una frase: lo que jamas puede desaparecer por un
// filtro cosmetico. Incluye el latino acentuado, no solo ASCII.
function letrasYDigitos(texto) {
  return texto.replace(/[^0-9A-Za-z\u00C0-\u017F]/g, '');
}

// Canario con mayusculas, digitos, acentos y las letras que se perdieron en el
// incidente del ticket 206 ('f' de confines, 'D' y 'C' de DrakesCraft).
const CANARIO_HABLA = 'Avanza con sabiduría, Mr_Em1lio: DrakesCraft prefiere los confines del año.';

function filtroConservaElHabla(regex) {
  regex.lastIndex = 0;
  return CANARIO_HABLA.replace(regex, '') === CANARIO_HABLA;
}

// EMOJIS_Y_SIMBOLOS se arma a mano desde fragmentos de texto y ya fallo dos
// veces el mismo dia: primero dejando pasar dingbats (ticket 205) y despues
// borrando letras ASCII de las frases de Atenea, que salieron al chat como
// 'cudiendo a tu presencia de inmediato, ack' (ticket 206). El bot se despliega
// con ediciones en caliente que no ejecutan npm test, asi que la verificacion
// tiene que correr tambien dentro del proceso vivo.
const FILTRO_EMOJIS = (() => {
  if (filtroConservaElHabla(EMOJIS_Y_SIMBOLOS)) return EMOJIS_Y_SIMBOLOS;
  console.error('[BUG] EMOJIS_Y_SIMBOLOS mutila texto legitimo; se usa el filtro de respaldo (ticket 206).');
  if (filtroConservaElHabla(EMOJIS_RESPALDO)) return EMOJIS_RESPALDO;
  console.error('[BUG] Ningun filtro de emojis es seguro; Atenea hablara sin filtrar antes que mutilada.');
  return null;
})();

function cleanText(text) {
  const original = (text || '').toString();
  const filtrado = FILTRO_EMOJIS ? original.replace(FILTRO_EMOJIS, '') : original;
  // Red de seguridad por llamada: ningun filtro cosmetico puede borrar letras
  // ni digitos del mensaje. Ante la duda se prefiere soltar un simbolo de mas
  // antes que una frase mutilada al chat publico.
  const seguro = letrasYDigitos(filtrado) === letrasYDigitos(original) ? filtrado : original;
  return seguro.replace(/\s+/g, ' ').trim();
}

function isTalkingToSaori(text) {
  const t = text.toLowerCase().trim();

  if (t.includes('failed simulation') || t.includes('failed ') || t.includes('ha minado') || t.includes('/gl ') || t.includes('abandonó la partida') || t.includes('se unió a la partida')) {
    return false;
  }

  if (t.startsWith('oe ') || t.startsWith('oye ') || t.startsWith('derem ') || t.startsWith('sebs ') || t.startsWith('darkess ')) {
    return false;
  }

  if (t.includes('la saori') || t.includes('el bot') || t.includes('esta saori') || t.includes('con saori') || t.includes('a saori') || t.includes('de saori') || t.includes('por saori')) {
    return false;
  }

  if (t.startsWith('saori ') || t.startsWith('saori,') || t.startsWith('saori:') || t.startsWith('saori?') || t === 'saori' ||
      t.startsWith('atenea ') || t.startsWith('atenea,') || t.startsWith('atenea:') || t === 'atenea' ||
      t.startsWith('@saori') || t.startsWith('hola saori') || t.startsWith('buenas saori')) {
    return true;
  }

  return false;
}

function solveTriviaOrForge(raw) {
  const binMatch = raw.match(/0b([01]+)/i);
  if (binMatch) {
    const val = parseInt(binMatch[1], 2);
    if (!isNaN(val)) return val.toString();
  }

  const expMatch = raw.match(/(\d+)\s+elevado\s+a\s+(\d+)/i);
  if (expMatch) {
    const base = parseInt(expMatch[1], 10);
    const exp = parseInt(expMatch[2], 10);
    if (!isNaN(base) && !isNaN(exp) && exp <= 16) {
      return Math.pow(base, exp).toString();
    }
  }

  const mathMatch = raw.match(/(\d+)\s*([\+\-\*\/])\s*(\d+)\s*=\s*\?/);
  if (mathMatch) {
    const a = parseInt(mathMatch[1], 10);
    const op = mathMatch[2];
    const b = parseInt(mathMatch[3], 10);
    if (op === '+') return (a + b).toString();
    if (op === '-') return (a - b).toString();
    if (op === '*') return (a * b).toString();
    if (op === '/' && b !== 0) return Math.floor(a / b).toString();
  }

  return null;
}

function parseFormattedChat(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  let world = null;
  const worldMatch = rawText.match(/\[([a-zA-Z0-9_-]+)\]/);
  if (worldMatch) {
    world = worldMatch[1].trim();
  }

  const icMatch = rawText.match(/([A-Za-z0-9_]{3,16})\s*»\s*(.*)$/);
  if (icMatch) {
    return { username: icMatch[1].trim(), message: icMatch[2].trim(), world: world };
  }

  const vanillaMatch = rawText.match(/<([A-Za-z0-9_]{3,16})>\s*(.*)$/);
  if (vanillaMatch) {
    return { username: vanillaMatch[1].trim(), message: vanillaMatch[2].trim(), world: world };
  }

  return null;
}

function queryAIService(username, message, world, ambientLogs, esAutoridadReconocida, callback) {
  // Cruce de frontera: a partir de aqui nada de lo que escribio un
  // jugador conserva capacidad de estructurar el prompt. La autoridad
  // viaja como bandera fuera de banda, jamas incrustada en el texto.
  const nickSeguro = sanearNick(username);
  const mensajeSeguro = sanearDatoExterno(message);
  const ambienteSeguro = (ambientLogs || []).slice(-MAX_AMBIENT).map((l) => sanearDatoExterno(l, 200));

  const payload = JSON.stringify({
    username: nickSeguro,
    message: mensajeSeguro,
    world: world || null,
    ambient: ambienteSeguro,
    untrusted: true,
    authority: esAutoridadReconocida === true
  });

  const client = net.createConnection(SOCKET_PATH, () => {
    client.write(payload);
  });

  let responseData = '';
  client.setTimeout(10000);

  client.on('data', (data) => {
    responseData += data.toString('utf-8');
  });

  client.on('end', () => {
    try {
      const parsed = JSON.parse(responseData);
      if (parsed && parsed.reply) {
        if (!esRespuestaEmitible(parsed.reply)) {
          console.warn('[CHAT-GUARD] Respuesta del socket no emitible; Atenea calla.');
          return callback(new Error('Respuesta no emitible'));
        }
        return callback(null, parsed.reply);
      }
    } catch (e) {}
    callback(new Error('Respuesta invalida de socket'));
  });

  client.on('error', (err) => {
    execFile('python3', [AI_SCRIPT_PATH, nickSeguro, mensajeSeguro, world || '', esAutoridadReconocida === true ? '1' : '0'], { timeout: 12000 }, (cliErr, stdout) => {
      const salida = primeraLineaUtil(stdout);
      if (cliErr || !salida) {
        return callback(cliErr || new Error('CLI error'));
      }
      if (!esRespuestaEmitible(salida)) {
        console.warn('[CHAT-GUARD] Salida del CLI no emitible; Atenea calla.');
        return callback(new Error('Respuesta no emitible'));
      }
      callback(null, salida);
    });
  });
}

function executeModerationActions(bot, brain, skills, rawReply) {
  if (!rawReply || typeof rawReply !== 'string') return '';
  const execRegex = /\[EXEC:\s*(\/[^\]]+)\]/gi;
  if (execRegex.test(rawReply)) {
    console.warn('[SECURITY] Bloqueada ejecucion de comando arbitrario desde modelo IA en chat:', rawReply);
  }
  let cleaned = rawReply.replace(execRegex, '').trim();
  if (cleaned.startsWith('/')) {
    cleaned = cleaned.replace(/^\/+/, '');
  }
  return cleaned;
}

function handleDirectJackActions(bot, brain, skills, username, message) {
  const m = message.toLowerCase().trim();
  // El destino es el propio solicitante ya autenticado por UUID, no un nick
  // fijo escrito en el codigo.
  const destino = sanearNick(username);

  // 1. Teletransporte junto a la autoridad. Los limites de palabra evitan que
  // 'joven', 'vender' o 'ventana' disparen un teletransporte.
  if (/\b(tp|teletransportate|teletransporta|ven|acude)\b/.test(m)) {
    bot.chat('/tp ' + destino);
    return 'Acudiendo a tu presencia de inmediato, Jack.';
  }

  // 2. Volar
  if (m.includes('vuela') || m.includes('fly') || m.includes('activa fly')) {
    bot.chat('/fly');
    return 'Activando vuelo sagrado, Jack.';
  }

  // 3. Consultas de proteccion /ps info
  if (m.includes('/ps info') || m.includes('ps info') || m.includes('que proteccion') || m.includes('en que proteccion')) {
    bot.chat('/ps info');
    return 'Consultando la proteccion actual con /ps info, Jack.';
  }

  // 4. Establecer base y proteccion
  if (m.includes('fundar base') || m.includes('haz tu base') || m.includes('crea tu base') || m.includes('ve a rtp')) {
    if (skills) skills.establishBaseSettlement();
    return 'Iniciando viaje por el multiverso para fundar el santuario sagrado, Jack.';
  }

  // 5. Construir casa
  if (m.includes('crea una casa') || m.includes('construye una casa') || m.includes('haz una casa')) {
    if (skills) skills.buildBasicShelter();
    return 'Iniciando la construcción del santuario, Jack.';
  }

  // 6. Seguir a Jack
  if (m === 'saori sigueme' || m === 'saori ven conmigo' || m.includes('sigueme')) {
    if (brain) brain.followPlayer(destino);
    return 'Acompañándote en tu marcha, Jack.';
  }

  // 7. Detenerse
  if (m === 'saori para' || m === 'saori estate quieta' || m === 'saori alto' || m === 'saori stop') {
    if (brain) brain.stopAll();
    return 'Deteniendo mi avance por tu orden, Jack.';
  }

  // La moderacion social es de Jack y se ejecuta desde su propia sesion.
  // El bot no dicta sanciones: la version anterior deducia el objetivo de
  // una lista fija de jugadores reales y, si no acertaba ninguno, baneaba
  // por defecto a un jugador concreto aunque nadie lo hubiera nombrado.
  if (/\b(ban|bane[ao]|banear|banead[oa]|tempban|temp\s?ban|kick|kickea|expulsa|expulsar|mute|mutea|kill|mata|matar|elimina|eliminar|sanciona|castiga)\b/.test(m)) {
    return 'Las sanciones siguen en modo observacion, Jack; no ejecutare ni fingire esta orden.';
  }

  return null;
}

function handleChatMessage(bot, brain, skills, username, message, config, world) {
  if (!username || username === bot.username || IGNORED_USERS.has(username.toLowerCase())) return;

  addAmbientMessage(username, message);

  if (!isTalkingToSaori(message)) {
    return;
  }

  // La autoridad NO se deduce del nick. Antes bastaba con llamarse
  // "Jackito" para saltarse el filtro anti-inyeccion, el rate-limit y
  // disparar acciones fisicas del bot. Ahora se exige UUID en la
  // allowlist exacta (identity.js), con deny-by-default.
  const isJack = esAutoridad(bot, username, config);

  // Se evalua antes del rate-limit para que todo intento quede en el log aunque
  // el chat este saturado. Jack queda exento: es la unica autoridad reconocida.
  if (!isJack && pareceInyeccionDePrompt(message)) {
    console.log('[SECURITY] Intento de inyeccion bloqueado de ' + username);
    // El aviso si respeta el rate-limit global: si no, el atacante usaria a
    // Atenea de altavoz repitiendo la provocacion.
    if (Date.now() - lastGlobalChatTime >= 3000) {
      lastGlobalChatTime = Date.now();
      bot.chat(cleanText(username + ', solo atiendo asuntos del reino. Preguntame por comandos, warps o Slimefun.'));
    }
    return;
  }

  const now = Date.now();
  if (now - lastGlobalChatTime < 3000 && !isJack) {
    return;
  }

  const lastUserTime = playerCooldowns.get(username) || 0;
  if (!isJack && now - lastUserTime < 4500) {
    return;
  }
  playerCooldowns.set(username, now);

  if (isJack) {
    const fastAction = handleDirectJackActions(bot, brain, skills, username, message);
    if (fastAction) {
      lastGlobalChatTime = Date.now();
      bot.chat(cleanText(fastAction));
      addAmbientMessage('SaoriStar', fastAction);
      return;
    }
  }

  queryAIService(username, message, world, ambientHistory, isJack, (err, reply) => {
    if (!err && reply) {
      const chatSpeech = executeModerationActions(bot, brain, skills, reply);

      if (chatSpeech) {
        lastGlobalChatTime = Date.now();
        let clean = cleanText(chatSpeech);
        if (clean.startsWith('/') || clean.startsWith('.') || clean.startsWith('!')) {
          clean = clean.replace(/^[/.!\\]+/, '');
        }
        // Ultimo recorte antes de hablar: la directiva de Atenea son 18
        // palabras y el modelo no es quien la hace cumplir.
        clean = limitarPalabras(clean);
        if (clean) {
          console.log('[AI-REPLY] Respondiendo a ' + username + ':', clean);
          bot.chat(clean);
          addAmbientMessage('SaoriStar', clean);
        }
      }
    }
  });
}

function setupChat(bot, config, brain, skills) {
  bot.on('message', (jsonMsg) => {
    try {
      const raw = jsonMsg ? jsonMsg.toString().trim() : '';
      if (!raw) return;

      if (raw.includes('FORJA MENTAL') || raw.includes('ORACULO DE TRIVIA') || raw.includes('JUICIO DEL OLIMPO')) {
        const ans = solveTriviaOrForge(raw);
        if (ans) {
          console.log('[TRIVIA-SOLVER] Respuesta calculada:', ans);
          setTimeout(() => {
            bot.chat(ans);
            addAmbientMessage('SaoriStar', ans);
          }, 1500);
          return;
        }
      }

      const parsed = parseFormattedChat(raw);
      if (parsed) {
        handleChatMessage(bot, brain, skills, parsed.username, parsed.message, config, parsed.world);
      } else {
        if (raw.length > 3 && !raw.startsWith('{')) {
          addAmbientMessage('Sistema', raw);
        }
      }
    } catch (e) {
      console.log('[CHAT-ERROR]', e.message);
    }
  });

  bot.on('chat', (username, message) => {
    handleChatMessage(bot, brain, skills, username, message, config, null);
  });
}

module.exports = {
  setupChat,
  cleanText,
  isTalkingToSaori,
  solveTriviaOrForge,
  executeModerationActions,
  pareceInyeccionDePrompt,
  sanearDatoExterno,
  sanearNick,
  limitarPalabras,
  esRespuestaEmitible,
  primeraLineaUtil,
  esPalabraFuncional,
  handleDirectJackActions,
  MAX_PALABRAS_RESPUESTA
};

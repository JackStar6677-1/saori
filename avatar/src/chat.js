/**
 * Módulo de Comunicación y Atención In-Game (SaoriStar / Diosa Atenea)
 */
const { execFile } = require('child_process');
const path = require('path');
const net = require('net');

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

function addAmbientMessage(sender, text) {
  const timeStr = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  ambientHistory.push(`[${timeStr}] ${sender}: ${text}`);
  if (ambientHistory.length > MAX_AMBIENT) {
    ambientHistory.shift();
  }
}

function cleanText(text) {
  return text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|\u2600-\u27BF|[\uE000-\uF8FF]/g, '').trim();
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

  const icMatch = rawText.match(/([A-Za-z0-9_]{3,16})\s*»\s*(.*)$/);
  if (icMatch) {
    return { username: icMatch[1].trim(), message: icMatch[2].trim() };
  }

  const vanillaMatch = rawText.match(/<([A-Za-z0-9_]{3,16})>\s*(.*)$/);
  if (vanillaMatch) {
    return { username: vanillaMatch[1].trim(), message: vanillaMatch[2].trim() };
  }

  return null;
}

function queryAIService(username, message, ambientLogs, callback) {
  const payload = JSON.stringify({
    username: username,
    message: message,
    ambient: ambientLogs
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
        return callback(null, parsed.reply);
      }
    } catch (e) {}
    callback(new Error('Respuesta invalida de socket'));
  });

  client.on('error', (err) => {
    execFile('python3', [AI_SCRIPT_PATH, username, message], { timeout: 12000 }, (cliErr, stdout) => {
      if (!cliErr && stdout && stdout.trim()) {
        callback(null, stdout.trim());
      } else {
        callback(cliErr || new Error('CLI error'));
      }
    });
  });
}

function executeModerationActions(bot, brain, skills, rawReply) {
  let cleaned = rawReply;
  const execRegex = /\[EXEC:\s*(\/[^\]]+)\]/gi;
  let match;

  while ((match = execRegex.exec(rawReply)) !== null) {
    const cmd = match[1].trim();
    console.log('[MODERATION-EXEC] Ejecutando comando:', cmd);
    bot.chat(cmd);
  }

  cleaned = cleaned.replace(execRegex, '').trim();
  return cleaned;
}

function handleDirectJackActions(bot, brain, skills, message) {
  const m = message.toLowerCase().trim();

  // 1. Teletransporte directo a Jack
  if (m.includes('tp') || m.includes('teletransport') || m.includes('ven') || m.includes('acude')) {
    bot.chat('/tp Jack');
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
    if (brain) brain.followPlayer('Jack');
    return 'Acompañándote en tu marcha, Jack.';
  }

  // 7. Detenerse
  if (m === 'saori para' || m === 'saori estate quieta' || m === 'saori alto' || m === 'saori stop') {
    if (brain) brain.stopAll();
    return 'Deteniendo mi avance por tu orden, Jack.';
  }

  // 8. Moderación
  if (m.includes('temp ban') || m.includes('tempban') || m.includes('tirale ban') || m.includes('banea a')) {
    const words = message.split(/\s+/);
    let target = 'Pasiente';
    for (const w of words) {
      if (['pasiente', 'make_zx', 'dival830', 'luisito', 'macacra334'].some(p => w.toLowerCase().includes(p))) {
        target = w;
        break;
      }
    }
    bot.chat('/tempban ' + target + ' 1m Orden directa de Jack');
    return target + ' ha sido sancionado temporalmente por 1 minuto según tu orden, Jack.';
  }

  return null;
}

function handleChatMessage(bot, brain, skills, username, message, config) {
  if (!username || username === bot.username || IGNORED_USERS.has(username.toLowerCase())) return;

  addAmbientMessage(username, message);

  if (!isTalkingToSaori(message)) {
    return;
  }

  const isJack = ['jack', 'dueño', 'dueno', 'ownerhusband', 'jackstar'].some(k => username.toLowerCase().includes(k));

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
    const fastAction = handleDirectJackActions(bot, brain, skills, message);
    if (fastAction) {
      lastGlobalChatTime = Date.now();
      bot.chat(cleanText(fastAction));
      addAmbientMessage('SaoriStar', fastAction);
      return;
    }
  }

  queryAIService(username, message, ambientHistory, (err, reply) => {
    if (!err && reply) {
      const chatSpeech = executeModerationActions(bot, brain, skills, reply);
      
      if (chatSpeech) {
        lastGlobalChatTime = Date.now();
        const clean = cleanText(chatSpeech);
        console.log('[AI-REPLY] Respondiendo a ' + username + ':', clean);
        bot.chat(clean);
        addAmbientMessage('SaoriStar', clean);
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
        handleChatMessage(bot, brain, skills, parsed.username, parsed.message, config);
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
    handleChatMessage(bot, brain, skills, username, message, config);
  });
}

module.exports = { setupChat, cleanText, isTalkingToSaori, solveTriviaOrForge };

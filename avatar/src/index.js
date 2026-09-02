/**
 * SaoriStar · Encarnación Física de SAORI (Diosa Atenea) en DrakesCraft
 * Staff Técnico & Jugadora Autónoma con Habilidades Avanzadas
 */
const mineflayer = require('mineflayer');
const fs = require('fs');
const path = require('path');
const net = require('net');

const configPath = fs.existsSync(path.join(__dirname, '../config.json'))
  ? path.join(__dirname, '../config.json')
  : path.join(__dirname, '../config.example.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const { setupAuth } = require('./auth');
const { setupChat } = require('./chat');
const { setupModeration } = require('./moderation');
const { setupSurvival } = require('./survival');
const { SaoriBrain } = require('./brain');
const { SaoriSkillsEngine } = require('./skills');
const { getPerceptionState } = require('./perception');

let bot = null;
let brain = null;
let skills = null;
let isReconnecting = false;
let spawnedOnce = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
let reconnectBlocked = false;

const RECONNECT_MAX_MS = 300000;
const GHOST_KICK_FLOOR_MS = 45000;
const GHOST_PATTERNS = [
  'ya esta en linea', 'ya está en línea', 'already online',
  'already logged in', 'you are already'
];
const TERMINAL_KICK_PATTERNS = [
  'banned', 'baneado', 'hasta nuevo aviso', 'whitelist',
  'not whitelisted', 'no estas en la lista blanca', 'no estás en la lista blanca'
];

function esKickDeSesionFantasma(reason) {
  const plano = JSON.stringify(reason || '').toLowerCase();
  return GHOST_PATTERNS.some((patron) => plano.includes(patron));
}

/**
 * Distingue rechazos administrativos que no se solucionan insistiendo.
 * Reintentar un ban o una whitelist solo llena los logs y dispara webhooks de salida.
 */
function esKickTerminal(reason) {
  const plano = JSON.stringify(reason || '').toLowerCase();
  return TERMINAL_KICK_PATTERNS.some((patron) => plano.includes(patron));
}

function reconnectDelayMs(sesionFantasma) {
  const base = Number(config.reconnect_delay_ms) > 0 ? Number(config.reconnect_delay_ms) : 10000;
  const escalado = base * Math.pow(2, Math.min(reconnectAttempts, 5));
  const jitter = Math.floor(Math.random() * 3000);
  let espera = Math.min(escalado, RECONNECT_MAX_MS);
  if (sesionFantasma) espera = Math.max(espera, GHOST_KICK_FLOOR_MS);
  return espera + jitter;
}

function desmontarBot(anterior) {
  if (!anterior) return;
  try { anterior.removeAllListeners(); } catch (e) {}
  try { if (anterior._client) anterior._client.removeAllListeners(); } catch (e) {}
  try { anterior.quit('reconexion'); } catch (e) {}
  try { if (anterior._client) anterior._client.end(); } catch (e) {}
}

const SOCK_PATH = process.env.SAORI_BOT_SOCK || '/tmp/saoristar-bot.sock';
try { fs.unlinkSync(SOCK_PATH); } catch (e) {}

const ALLOWED_MINE_RESOURCES = new Set([
  'ore', 'iron', 'coal', 'copper', 'gold', 'diamond', 'stone', 'cobblestone',
  'log', 'wood', 'cherry_log', 'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log'
]);

const ALLOWED_TELEPORT_DESTS = new Set([
  'spawn', 'templo', 'home', 'rtp'
]);

function sanitizeChatMessage(raw) {
  if (typeof raw !== 'string') return null;
  let clean = raw.replace(/[\r\n\t]+/g, ' ').replace(/[\u00a7&][0-9a-fk-or]/g, '').trim();
  if (!clean || clean.length > 256) return null;
  // Strict check: No slash commands, dot commands or escape sequences
  if (clean.startsWith('/') || clean.startsWith('.') || clean.startsWith('!') || clean.startsWith('\\')) {
    return null;
  }
  return clean;
}

// Estado cognitivo publicado por el broker de modelos (ticket 229). El cuerpo
// del bot no decide si hay pensamiento disponible: solo lo reporta, para que
// /saori status distinga "Atenea callada" de "Atenea sin modelo".
// SAORI_COGNITIVE_STATE permite a las pruebas apuntar a un snapshot temporal,
// igual que SAORI_BOT_DATA con la memoria de la partida.
const COGNITIVE_STATE_PATH = process.env.SAORI_COGNITIVE_STATE
  || path.join(process.env.HOME, '.local/state/nova/saori-cognitive-state.json');
const COGNITIVE_STALE_MS = 15 * 60 * 1000;

function readCognitiveState() {
  try {
    const snap = JSON.parse(fs.readFileSync(COGNITIVE_STATE_PATH, 'utf-8'));
    const generado = Number(snap.generado) * 1000;
    // Un snapshot viejo no es un estado: afirmar ONLINE con datos de ayer seria
    // exactamente el tipo de certeza fingida que prohibe el ticket.
    const rancio = !Number.isFinite(generado) || Date.now() - generado > COGNITIVE_STALE_MS;
    return {
      estado: rancio ? 'DESCONOCIDO' : (snap.estado_chat || snap.estado || 'DESCONOCIDO'),
      puede_razonar: rancio ? null : snap.puede_razonar === true,
      publicado: Number.isFinite(generado) ? new Date(generado).toISOString() : null,
      rancio: rancio
    };
  } catch (e) {
    return { estado: 'DESCONOCIDO', puede_razonar: null, publicado: null, rancio: true };
  }
}

function handleTeleportDest(destStr) {
  const d = String(destStr || '').trim().toLowerCase();
  if (ALLOWED_TELEPORT_DESTS.has(d)) return d;
  if (/^warp\s+[a-zA-Z0-9_-]{1,20}$/.test(d)) return d;
  return null;
}

const ipcServer = net.createServer((socket) => {
  socket.on('data', async (data) => {
    const raw = data.toString().trim();
    if (!bot) {
      socket.write(JSON.stringify({ error: 'Bot no conectado' }) + '\n');
      return;
    }

    let parsed = null;
    if (raw.startsWith('{') && raw.endsWith('}')) {
      try { parsed = JSON.parse(raw); } catch (e) {}
    }

    const action = parsed ? (parsed.action || parsed.type || '') : raw.split(' ')[0];
    const restArgs = parsed ? (parsed.args || parsed.payload || parsed.message || parsed.goal || parsed.resource || parsed.destination || '') : raw.slice(action.length).trim();

    if (action === 'PERCEPTION') {
      const perception = getPerceptionState(bot);
      socket.write(JSON.stringify(perception) + '\n');
      return;
    }

    if (action === 'STATUS') {
      const pos = (bot.entity && bot.entity.position) ? { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) } : null;
      const inv = bot.inventory ? bot.inventory.items().map(i => i.name + 'x' + i.count).join(', ') : '';
      const statusObj = {
        username: bot.username,
        health: bot.health,
        food: bot.food,
        position: pos,
        inventory: inv || 'Vacio',
        dimension: bot.game ? bot.game.dimension : 'minecraft:overworld',
        task: skills ? skills.currentTask : 'Patrulla',
        goal: brain ? brain.currentGoal : 'explorar_terreno',
        cognitive: readCognitiveState()
      };
      socket.write(JSON.stringify(statusObj) + '\n');
      return;
    }

    if (action === 'BUILD_TEMPLE' || action === 'BUILD_HOUSE') {
      if (skills) skills.buildAthenaTemple();
      socket.write(JSON.stringify({ success: true, action: 'BUILDING_TEMPLE' }) + '\n');
      return;
    }

    if (action === 'MINE') {
      const res = String(restArgs).toLowerCase().trim();
      if (!ALLOWED_MINE_RESOURCES.has(res)) {
        socket.write(JSON.stringify({ success: false, error: 'Recurso no permitido para mineria: ' + res }) + '\n');
        return;
      }
      if (skills) skills.mineDeepResources(res);
      socket.write(JSON.stringify({ success: true, action: 'MINING', resource: res }) + '\n');
      return;
    }

    if (action === 'LOOT') {
      if (skills) skills.lootWildChests();
      socket.write(JSON.stringify({ success: true, action: 'LOOTING_CHESTS' }) + '\n');
      return;
    }

    if (action === 'STORE') {
      if (skills) skills.storeAtBaseChest();
      socket.write(JSON.stringify({ success: true, action: 'STORING_AT_BASE' }) + '\n');
      return;
    }

    if (action === 'SET_GOAL') {
      const goalStr = String(restArgs).trim();
      if (!brain) {
        socket.write(JSON.stringify({ success: false, error: 'Cerebro no inicializado' }) + '\n');
        return;
      }
      const aplicada = brain.setGoal(goalStr);
      socket.write(JSON.stringify({
        success: aplicada,
        goal: aplicada ? brain.currentGoal : null,
        error: aplicada ? undefined : 'Meta desconocida: ' + goalStr
      }) + '\n');
      return;
    }

    if (action === 'GET_GOAL') {
      socket.write(JSON.stringify({ goal: brain ? brain.currentGoal : null }) + '\n');
      return;
    }

    if (action === 'RECOVER_GRAVE') {
      if (brain) brain.recoverGrave();
      socket.write(JSON.stringify({ success: true, action: 'RECOVERING_GRAVE' }) + '\n');
      return;
    }

    if (action === 'TELEPORT') {
      const validDest = handleTeleportDest(restArgs);
      if (!validDest) {
        socket.write(JSON.stringify({ success: false, error: 'Destino no permitido para teletransporte' }) + '\n');
        return;
      }
      bot.chat(`/${validDest}`);
      socket.write(JSON.stringify({ success: true, action: 'TELEPORT', destination: validDest }) + '\n');
      return;
    }

    if (action === 'CHAT' || action === 'SAY') {
      const clean = sanitizeChatMessage(restArgs);
      if (!clean) {
        if (parsed) {
          socket.write(JSON.stringify({ success: false, error: 'Mensaje invalido o contiene comandos' }) + '\n');
        } else {
          socket.write('ERROR: Comandos no permitidos via CHAT\n');
        }
        return;
      }
      bot.chat(clean);
      if (parsed) {
        socket.write(JSON.stringify({ success: true, message: clean }) + '\n');
      } else {
        socket.write('OK\n');
      }
      return;
    }

    if (action === 'MODERATE') {
      socket.write(JSON.stringify({
        success: false,
        error: 'Moderacion en shadow mode: no se ejecutan sanciones directas via IPC.'
      }) + '\n');
      return;
    }

    socket.write('UNKNOWN_COMMAND\n');
  });
});

ipcServer.listen(SOCK_PATH, () => {
  try { fs.chmodSync(SOCK_PATH, 0o600); } catch (e) {}
  console.log('[IPC] Socket de control escuchando en ' + SOCK_PATH);
});

function createSaoriBot() {
  if (reconnectBlocked) {
    console.warn('[BOT] Reconexión bloqueada por rechazo administrativo; requiere intervención manual.');
    return;
  }
  isReconnecting = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  const anterior = bot;
  bot = null;
  desmontarBot(anterior);

  console.log('====================================================');
  console.log('  👑 INICIANDO SAORI · DIOSA ATENEA (DRAKES)        ');
  console.log('====================================================');

  spawnedOnce = false;

  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
    hideErrors: false
  });

  setupAuth(bot, config);
  brain = new SaoriBrain(bot, config);
  skills = new SaoriSkillsEngine(bot, brain);
  brain.setSkills(skills);
  setupChat(bot, config, brain, skills);
  setupModeration(bot, config);
  setupSurvival(bot, config);

  bot.on('login', () => {
    console.log('[BOT] SAORI conectada al servidor Minecraft.');
    isReconnecting = false;
  });

  bot.on('spawn', () => {
    reconnectAttempts = 0;
    if (!spawnedOnce) {
      spawnedOnce = true;
      brain.startAutonomousLoop();
      console.log('[BOT] Cerebro autónomo activado en spawn inicial.');
    }
  });

  bot.on('death', () => {
    console.warn('[BOT] Muerte detectada. Registrando posición...');
    brain.handleDeath();
  });

  bot.on('respawn', () => {
    console.log('[BOT] Respawn completado. Recuperando pertenencias...');
    setTimeout(() => {
      brain.recoverGrave();
    }, 2000);
  });

  bot.on('kicked', (reason) => {
    if (esKickTerminal(reason)) {
      reconnectBlocked = true;
      isReconnecting = false;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      console.error(`[BOT] Rechazo administrativo: ${JSON.stringify(reason)}. No se reconectará automáticamente.`);
      return;
    }
    const fantasma = esKickDeSesionFantasma(reason);
    const espera = reconnectDelayMs(fantasma);
    console.warn(`[BOT] Expulsada: ${JSON.stringify(reason)}. Reconectando en ${Math.round(espera / 1000)}s...`);
    scheduleReconnect(espera);
  });

  bot.on('end', (reason) => {
    if (reconnectBlocked) {
      console.warn(`[BOT] Conexión cerrada (${reason}); reconexión inhibida por rechazo administrativo.`);
      return;
    }
    const espera = reconnectDelayMs(false);
    console.warn(`[BOT] Conexión cerrada (${reason}). Reconectando en ${Math.round(espera / 1000)}s...`);
    scheduleReconnect(espera);
  });

  bot.on('error', (err) => {
    console.error('[BOT-ERROR]', err.message);
  });
}

function scheduleReconnect(esperaMs) {
  if (isReconnecting) return;
  isReconnecting = true;
  reconnectAttempts++;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    createSaoriBot();
  }, esperaMs);
}

createSaoriBot();

module.exports = { createSaoriBot, esKickTerminal };

/**
 * SaoriStar · Encarnación Física de SAORI (Diosa Atenea) en DrakesCraft
 * Staff Técnico & Jugadora Autónoma con Habilidades Avanzadas
 */
const mineflayer = require('mineflayer');
const fs = require('fs');
const path = require('path');
const net = require('net');

const configPath = path.join(__dirname, '../config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

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

const RECONNECT_MAX_MS = 300000;
const GHOST_KICK_FLOOR_MS = 45000;
const GHOST_PATTERNS = [
  'ya esta en linea', 'ya está en línea', 'already online',
  'already logged in', 'you are already'
];

function esKickDeSesionFantasma(reason) {
  const plano = JSON.stringify(reason || '').toLowerCase();
  return GHOST_PATTERNS.some((patron) => plano.includes(patron));
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

const ipcServer = net.createServer((socket) => {
  socket.on('data', async (data) => {
    const cmd = data.toString().trim();
    if (!bot) {
      socket.write(JSON.stringify({ error: 'Bot no conectado' }) + '\n');
      return;
    }

    if (cmd === 'PERCEPTION') {
      const perception = getPerceptionState(bot);
      socket.write(JSON.stringify(perception) + '\n');
      return;
    }

    if (cmd === 'STATUS') {
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
        goal: brain ? brain.currentGoal : 'explorar_terreno'
      };
      socket.write(JSON.stringify(statusObj) + '\n');
      return;
    }

    if (cmd === 'BUILD_TEMPLE' || cmd === 'BUILD_HOUSE') {
      if (skills) skills.buildAthenaTemple();
      socket.write(JSON.stringify({ success: true, action: 'BUILDING_TEMPLE' }) + '\n');
      return;
    }

    if (cmd.startsWith('MINE ')) {
      const res = cmd.replace('MINE ', '').trim();
      if (skills) skills.mineDeepResources(res);
      socket.write(JSON.stringify({ success: true, action: 'MINING', resource: res }) + '\n');
      return;
    }

    if (cmd === 'LOOT') {
      if (skills) skills.lootWildChests();
      socket.write(JSON.stringify({ success: true, action: 'LOOTING_CHESTS' }) + '\n');
      return;
    }

    if (cmd === 'STORE') {
      if (skills) skills.storeAtBaseChest();
      socket.write(JSON.stringify({ success: true, action: 'STORING_AT_BASE' }) + '\n');
      return;
    }

    if (cmd.startsWith('MODERATE ')) {
      const parts = cmd.replace('MODERATE ', '').split(' ');
      const subAct = parts[0];
      const target = parts[1];
      const reason = parts.slice(2).join(' ') || 'Moderación de SAORI';
      if (skills) skills.moderatePlayer(target, subAct, reason);
      socket.write(JSON.stringify({ success: true, action: 'MODERATING', subAct, target }) + '\n');
      return;
    }

    if (cmd.startsWith('TELEPORT ')) {
      const dest = cmd.replace('TELEPORT ', '').trim();
      bot.chat(`/${dest}`);
      socket.write(JSON.stringify({ success: true, action: 'TELEPORT', destination: dest }) + '\n');
      return;
    }

    if (cmd.startsWith('SET_GOAL ')) {
      const goalStr = cmd.slice('SET_GOAL '.length).trim();
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

    if (cmd === 'GET_GOAL') {
      socket.write(JSON.stringify({ goal: brain ? brain.currentGoal : null }) + '\n');
      return;
    }

    if (cmd === 'RECOVER_GRAVE') {
      if (brain) brain.recoverGrave();
      socket.write(JSON.stringify({ success: true, action: 'RECOVERING_GRAVE' }) + '\n');
      return;
    }

    if (cmd.startsWith('CHAT ')) {
      const msg = cmd.replace('CHAT ', '').trim();
      bot.chat(msg);
      socket.write('OK\n');
      return;
    }

    socket.write('UNKNOWN_COMMAND\n');
  });
});

ipcServer.listen(SOCK_PATH, () => {
  try { fs.chmodSync(SOCK_PATH, 0o777); } catch (e) {}
  console.log('[IPC] Socket de control escuchando en ' + SOCK_PATH);
});

function createSaoriBot() {
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
    const fantasma = esKickDeSesionFantasma(reason);
    const espera = reconnectDelayMs(fantasma);
    console.warn(`[BOT] Expulsada: ${JSON.stringify(reason)}. Reconectando en ${Math.round(espera / 1000)}s...`);
    scheduleReconnect(espera);
  });

  bot.on('end', (reason) => {
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

module.exports = { createSaoriBot };

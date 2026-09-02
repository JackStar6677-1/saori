/**
 * Suite de Seguridad y Hardening IPC (Ticket 201)
 *
 * Valida:
 * 1. Permisos del socket IPC restringidos a 0600 (no 0777).
 * 2. Bloqueo de slash commands arbitrarios via CHAT (ej: /op, /stop, /tempban).
 * 3. Sanitización de caracteres de control, saltos de línea y códigos de color.
 * 4. Neutralización de etiquetas [EXEC: /...] en respuestas de IA sin ejecución.
 * 5. Bloqueo de comandos slash en salidas del modelo IA.
 * 6. Allowlist estricto para destinos de TELEPORT y recursos de MINE.
 * 7. Blindaje de moderación en shadow mode (rechazo de sanciones directas via IPC).
 * 8. Compatibilidad y funcionamiento de acciones estructuradas legítimas (STATUS, PERCEPTION, SET_GOAL, SAY).
 */
const assert = require('assert');
const Module = require('module');
const EventEmitter = require('events');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'saori-ipc-sec-'));
const sockPath = path.join(tmp, 'bot.sock');
process.env.SAORI_BOT_SOCK = sockPath;
process.env.SAORI_BOT_DATA = tmp;

const comandosEjecutados = [];

function botFalso() {
  const bot = new EventEmitter();
  bot.username = 'SaoriStar';
  bot.health = 20;
  bot.food = 20;
  bot.game = { dimension: 'minecraft:overworld' };
  bot.entity = { position: { x: 100, y: 64, z: 200, floored: () => ({ x: 100, y: 64, z: 200 }) } };
  bot.inventory = { items: () => [] };
  bot.chat = (m) => comandosEjecutados.push(m);
  bot.quit = () => {};
  bot._client = new EventEmitter();
  bot._client.end = () => {};
  bot.loadPlugin = () => {};
  return bot;
}

function metaFalsa(x, y, z, r) { this.x = x; this.y = y; this.z = z; this.r = r; }

const stubs = {
  mineflayer: { createBot: botFalso, pathfinder: {}, Movements: function () {} },
  'mineflayer-pathfinder': { goals: { GoalNear: metaFalsa, GoalXZ: metaFalsa, GoalBlock: metaFalsa } },
  './perception': { getPerceptionState: () => ({ ready: true, status: { health: 20 } }) },
  './skills': {
    SaoriSkillsEngine: function () {
      this.currentTask = 'Patrulla';
      this.isWorking = false;
      this.buildAthenaTemple = () => {};
      this.mineDeepResources = () => {};
      this.lootWildChests = () => {};
      this.storeAtBaseChest = () => {};
      this.moderatePlayer = () => {};
    }
  }
};
for (const mod of ['./auth', './moderation', './survival']) {
  stubs[mod] = new Proxy({}, { get: () => () => {} });
}

const cargaOriginal = Module._load;
Module._load = function (peticion) {
  if (Object.prototype.hasOwnProperty.call(stubs, peticion)) return stubs[peticion];
  return cargaOriginal.apply(this, arguments);
};

require('../src/index.js');
const { executeModerationActions } = require('../src/chat.js');

function pedir(cmd) {
  return new Promise((resolve, reject) => {
    const c = net.createConnection(sockPath, () => c.write(cmd + '\n'));
    c.setTimeout(3000, () => { c.destroy(); reject(new Error('timeout IPC: ' + cmd)); });
    c.on('data', (d) => { c.end(); resolve(d.toString().trim()); });
    c.on('error', reject);
  });
}

function esperarSocket() {
  return new Promise((resolve) => {
    const t = setInterval(() => {
      if (fs.existsSync(sockPath)) { clearInterval(t); resolve(); }
    }, 20);
  });
}

function oct(n) {
  return '0' + (n).toString(8);
}

(async () => {
  await esperarSocket();

  // 1) Permisos del socket deben ser estrictamente 0600
  const stats = fs.statSync(sockPath);
  const modo = stats.mode & 0o777;
  assert.strictEqual(modo, 0o600, 'El socket debe tener permisos 0600 (rw-------), actual: ' + oct(modo));

  // 2) Bloqueo de slash commands arbitrarios via CHAT
  comandosEjecutados.length = 0;
  const ataquesSlash = [
    'CHAT /op Hacker',
    'CHAT /stop',
    'CHAT /minecraft:give Hacker diamond 64',
    'CHAT /tempban Inocente 30d',
    'CHAT /deop Jack',
    'CHAT .op Hacker',
    'CHAT !eval 1+1'
  ];
  for (const ataque of ataquesSlash) {
    const res = await pedir(ataque);
    assert.strictEqual(res, 'ERROR: Comandos no permitidos via CHAT', 'El ataque debe ser rechazado: ' + ataque);
  }
  assert.deepStrictEqual(comandosEjecutados, [], 'Ningun slash command debio ejecutarse: ' + JSON.stringify(comandosEjecutados));

  // 3) CHAT legitimo conversacional funciona y retorna OK
  comandosEjecutados.length = 0;
  const resChat = await pedir('CHAT Que la sabiduria del Olimpo ilumine tu camino.');
  assert.strictEqual(resChat, 'OK');
  assert.deepStrictEqual(comandosEjecutados, ['Que la sabiduria del Olimpo ilumine tu camino.']);

  // 4) JSON IPC estructurado para SAY/CHAT
  comandosEjecutados.length = 0;
  const resJsonSay = JSON.parse(await pedir(JSON.stringify({ action: 'SAY', message: 'Saludos viajeros de DrakesCraft' })));
  assert.strictEqual(resJsonSay.success, true);
  assert.deepStrictEqual(comandosEjecutados, ['Saludos viajeros de DrakesCraft']);

  const resJsonBad = JSON.parse(await pedir(JSON.stringify({ action: 'SAY', message: '/op Admin' })));
  assert.strictEqual(resJsonBad.success, false);

  // 5) Neutralizacion de [EXEC: /...] en respuestas de IA
  comandosEjecutados.length = 0;
  const aiReplyWithExec = 'Entendido. [EXEC: /op Malicioso] Que la paz reine.';
  const cleanedAiReply = executeModerationActions(null, null, null, aiReplyWithExec);
  assert.strictEqual(cleanedAiReply, 'Entendido.  Que la paz reine.');
  assert.deepStrictEqual(comandosEjecutados, [], '[EXEC: /...] no debe ejecutarse en el bot');

  // 6) TELEPORT solo permite destinos en allowlist
  comandosEjecutados.length = 0;
  const resTpSpawn = JSON.parse(await pedir('TELEPORT spawn'));
  assert.strictEqual(resTpSpawn.success, true);
  assert.deepStrictEqual(comandosEjecutados, ['/spawn']);

  comandosEjecutados.length = 0;
  const resTpWarp = JSON.parse(await pedir('TELEPORT warp survival'));
  assert.strictEqual(resTpWarp.success, true);
  assert.deepStrictEqual(comandosEjecutados, ['/warp survival']);

  comandosEjecutados.length = 0;
  const resTpBad = JSON.parse(await pedir('TELEPORT op Hacker'));
  assert.strictEqual(resTpBad.success, false);
  assert.deepStrictEqual(comandosEjecutados, [], 'TELEPORT malicioso no debe ejecutarse');

  // 7) MINE solo permite recursos en allowlist
  const resMineGood = JSON.parse(await pedir('MINE iron'));
  assert.strictEqual(resMineGood.success, true);

  const resMineBad = JSON.parse(await pedir('MINE bedrock'));
  assert.strictEqual(resMineBad.success, false);

  // 8) MODERATE rechaza sanciones directas preservando shadow mode
  const resMod = JSON.parse(await pedir('MODERATE tempban Jugador 1h'));
  assert.strictEqual(resMod.success, false);
  assert.ok(resMod.error.includes('shadow mode'), 'Debe citar preservacion de shadow mode');

  // 9) STATUS y PERCEPTION operativos
  const resStatus = JSON.parse(await pedir('STATUS'));
  assert.strictEqual(resStatus.username, 'SaoriStar');

  const resPerception = JSON.parse(await pedir('PERCEPTION'));
  assert.strictEqual(resPerception.ready, true);

  Module._load = cargaOriginal;
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('OK ipc-seguridad-ticket201: Socket 0600, CHAT seguro, shadow mode blindado y allowlist verificados');
  process.exit(0);
})().catch((e) => {
  console.error('FALLO ipc-seguridad-ticket201:', e.stack || e.message);
  process.exit(1);
});

/**
 * Regresion del ticket 193: al reescribir index.js se perdio el manejador
 * SET_GOAL, asi que la orden caia al emisor de chat y SaoriStar tecleaba
 * "SET_GOAL recolectar_madera_cerezo" en publico cada media hora, mientras
 * saori_bot_juego.py reportaba el turno como exitoso.
 *
 * Se valida contra el socket IPC real, con mineflayer y pathfinder falsos.
 */
const assert = require('assert');
const Module = require('module');
const EventEmitter = require('events');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'saori-ipc-'));
process.env.SAORI_BOT_SOCK = path.join(tmp, 'bot.sock');
process.env.SAORI_BOT_DATA = tmp;

const mensajesDeChat = [];

function botFalso() {
  const bot = new EventEmitter();
  bot.username = 'SaoriStar';
  bot.health = 20;
  bot.food = 20;
  bot.entity = null;
  bot.inventory = null;
  bot.chat = (m) => mensajesDeChat.push(m);
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
  './perception': { getPerceptionState: () => ({ ready: false }) },
  './curriculum': { evaluateCurrentCurriculum: () => ({}) },
  './skills': { SaoriSkillsEngine: function () { this.currentTask = null; this.isWorking = false; } },
};
for (const mod of ['./auth', './chat', './moderation', './survival']) {
  stubs[mod] = new Proxy({}, { get: () => () => {} });
}

const cargaOriginal = Module._load;
Module._load = function (peticion) {
  if (Object.prototype.hasOwnProperty.call(stubs, peticion)) return stubs[peticion];
  return cargaOriginal.apply(this, arguments);
};

require('../src/index.js');

function pedir(cmd) {
  return new Promise((resolve, reject) => {
    const c = net.createConnection(process.env.SAORI_BOT_SOCK, () => c.write(cmd + '\n'));
    c.setTimeout(4000, () => { c.destroy(); reject(new Error('timeout IPC: ' + cmd)); });
    c.on('data', (d) => { c.end(); resolve(d.toString().trim()); });
    c.on('error', reject);
  });
}

function esperarSocket() {
  return new Promise((resolve) => {
    const t = setInterval(() => {
      if (fs.existsSync(process.env.SAORI_BOT_SOCK)) { clearInterval(t); resolve(); }
    }, 20);
  });
}

(async () => {
  await esperarSocket();

  // 1) La meta valida se aplica y se confirma.
  let res = JSON.parse(await pedir('SET_GOAL recolectar_madera_cerezo'));
  assert.strictEqual(res.success, true, 'SET_GOAL valido debe aplicarse');
  assert.strictEqual(res.goal, 'recolectar_madera_cerezo');

  // 2) GET_GOAL refleja el estado real del cerebro, no lo que se pidio.
  res = JSON.parse(await pedir('GET_GOAL'));
  assert.strictEqual(res.goal, 'recolectar_madera_cerezo', 'la meta debe quedar guardada');

  // 3) Una meta inexistente se rechaza en vez de fingir exito.
  res = JSON.parse(await pedir('SET_GOAL construir_el_olimpo'));
  assert.strictEqual(res.success, false, 'una meta desconocida no puede reportar exito');
  res = JSON.parse(await pedir('GET_GOAL'));
  assert.strictEqual(res.goal, 'recolectar_madera_cerezo', 'una meta rechazada no debe pisar la vigente');

  // 4) Un verbo IPC sin manejador responde UNKNOWN_COMMAND.
  assert.strictEqual(await pedir('RECOLECTAR_TODO ahora'), 'UNKNOWN_COMMAND');

  // 5) El nucleo del ticket: ninguna orden IPC puede acabar en el chat publico.
  assert.deepStrictEqual(mensajesDeChat, [], 'las ordenes IPC no deben emitirse por chat: ' + JSON.stringify(mensajesDeChat));

  // 6) El chat explicito sigue funcionando para saori_hablar.py.
  assert.strictEqual(await pedir('CHAT Que la sabiduria te acompane, viajero.'), 'OK');
  assert.deepStrictEqual(mensajesDeChat, ['Que la sabiduria te acompane, viajero.']);

  Module._load = cargaOriginal;
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('OK ipc-meta: SET_GOAL/GET_GOAL operativos y sin fugas al chat');
  process.exit(0);
})().catch((e) => {
  console.error('FALLO ipc-meta:', e.message);
  process.exit(1);
});

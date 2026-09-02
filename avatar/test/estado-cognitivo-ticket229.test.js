/**
 * Regresion del ticket 229: el modo degradado del chat responde en local, pero
 * quien mira /saori status no tenia forma de distinguir "Atenea callada porque
 * no tiene nada que decir" de "Atenea sin ningun modelo detras".
 *
 * El cuerpo del bot NO decide si hay pensamiento: solo reporta el snapshot que
 * publica el broker, y se niega a reportar un snapshot rancio como si fuera el
 * estado de ahora.
 */
const assert = require('assert');
const Module = require('module');
const EventEmitter = require('events');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'saori-cog-'));
process.env.SAORI_BOT_SOCK = path.join(tmp, 'bot.sock');
process.env.SAORI_BOT_DATA = tmp;
process.env.SAORI_COGNITIVE_STATE = path.join(tmp, 'saori-cognitive-state.json');

function botFalso() {
  const bot = new EventEmitter();
  bot.username = 'SaoriStar';
  bot.health = 20;
  bot.food = 20;
  bot.entity = null;
  bot.inventory = null;
  bot.chat = () => {};
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

function escribirSnapshot(obj) {
  fs.writeFileSync(process.env.SAORI_COGNITIVE_STATE, JSON.stringify(obj), 'utf-8');
}

(async () => {
  await esperarSocket();

  // 1) Sin snapshot no se inventa un estado: DESCONOCIDO, no ONLINE.
  let st = JSON.parse(await pedir('STATUS'));
  assert.ok(st.cognitive, 'STATUS debe incluir el estado cognitivo');
  assert.strictEqual(st.cognitive.estado, 'DESCONOCIDO');
  assert.strictEqual(st.cognitive.puede_razonar, null,
    'sin dato no se afirma ni se niega el pensamiento');

  // 2) Snapshot fresco: se reporta el estado del chat, que es el que importa.
  escribirSnapshot({
    schema: 1,
    generado: Math.floor(Date.now() / 1000),
    estado: 'DEGRADED',
    estado_chat: 'SLEEPING',
    puede_razonar: false,
  });
  st = JSON.parse(await pedir('STATUS'));
  assert.strictEqual(st.cognitive.estado, 'SLEEPING');
  assert.strictEqual(st.cognitive.puede_razonar, false);
  assert.strictEqual(st.cognitive.rancio, false);

  // 3) Snapshot rancio: afirmar ONLINE con datos de ayer seria justo la certeza
  //    fingida que prohibe el ticket.
  escribirSnapshot({
    schema: 1,
    generado: Math.floor(Date.now() / 1000) - 6 * 3600,
    estado: 'ONLINE',
    estado_chat: 'ONLINE',
    puede_razonar: true,
  });
  st = JSON.parse(await pedir('STATUS'));
  assert.strictEqual(st.cognitive.estado, 'DESCONOCIDO', 'un snapshot viejo no es un estado');
  assert.strictEqual(st.cognitive.rancio, true);
  assert.strictEqual(st.cognitive.puede_razonar, null);

  // 4) Un snapshot corrupto no puede tumbar el STATUS.
  fs.writeFileSync(process.env.SAORI_COGNITIVE_STATE, '{esto no es json', 'utf-8');
  st = JSON.parse(await pedir('STATUS'));
  assert.strictEqual(st.cognitive.estado, 'DESCONOCIDO');
  assert.strictEqual(st.username, 'SaoriStar', 'el resto del STATUS sigue intacto');

  Module._load = cargaOriginal;
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('OK estado-cognitivo: /saori status distingue sin modelo de sin snapshot');
  process.exit(0);
})().catch((e) => {
  console.error('FALLO estado-cognitivo:', e.message);
  process.exit(1);
});

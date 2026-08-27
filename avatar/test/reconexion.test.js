/**
 * Regresion del ticket 187: el bucle de reconexion de SaoriStar moria para
 * siempre si el servidor la expulsaba antes del evento 'login' (ANTIBOT o
 * sesion duplicada), porque el pestillo isReconnecting solo se liberaba en
 * 'login'. Aqui se simula esa secuencia con un mineflayer falso.
 */
const assert = require('assert');
const Module = require('module');
const EventEmitter = require('events');
const os = require('os');
const path = require('path');

process.env.SAORI_BOT_SOCK = path.join(os.tmpdir(), 'saori-test-' + process.pid + '.sock');

const botsCreados = [];

function botFalso() {
  const bot = new EventEmitter();
  bot.username = 'SaoriStar';
  bot.chat = () => {};
  bot.quit = () => {};
  bot._client = new EventEmitter();
  bot._client.end = () => {};
  bot.loadPlugin = () => {};
  bot.once = bot.once.bind(bot);
  botsCreados.push(bot);
  return bot;
}

const stubs = {
  mineflayer: { createBot: botFalso, pathfinder: {}, Movements: function () {} },
};
for (const mod of ['./auth', './chat', './moderation', './survival']) {
  stubs[mod] = new Proxy({}, { get: () => () => {} });
}
stubs['./brain'] = { SaoriBrain: function () { this.setSkills = () => {}; this.startAutonomousLoop = () => {}; this.handleDeath = () => {}; this.recoverGrave = () => {}; } };
stubs['./skills'] = { SaoriSkillsEngine: function () { this.currentTask = 'test'; } };
stubs['./perception'] = { getPerceptionState: () => ({ ready: false }) };

const cargaOriginal = Module._load;
Module._load = function (peticion, padre, esPrincipal) {
  if (Object.prototype.hasOwnProperty.call(stubs, peticion)) return stubs[peticion];
  return cargaOriginal.apply(this, arguments);
};

// Reloj falso: ejecuta de inmediato cualquier reconexion programada.
const setTimeoutReal = global.setTimeout;
const pendientes = [];
global.setTimeout = (fn, ms) => {
  pendientes.push({ fn, ms });
  return { unref() {} };
};

require('../src/index.js');

function correrPendientes() {
  while (pendientes.length) pendientes.shift().fn();
}

// 1) Primer intento: expulsada antes de login (ANTIBOT).
assert.strictEqual(botsCreados.length, 1, 'debe crearse un bot al arrancar');
botsCreados[0].emit('kicked', { text: 'ANTIBOT' });
botsCreados[0].emit('end');
correrPendientes();
assert.strictEqual(botsCreados.length, 2, 'debe reconectar tras la primera expulsion');

// 2) Segunda expulsion sin login: aqui moria el bucle antes del fix.
botsCreados[1].emit('kicked', { text: 'ANTIBOT' });
botsCreados[1].emit('end');
correrPendientes();
assert.strictEqual(botsCreados.length, 3, 'debe reconectar tambien sin haber hecho login nunca');

// 3) Tercera, para descartar que el pestillo se atasque mas adelante.
botsCreados[2].emit('end');
correrPendientes();
assert.strictEqual(botsCreados.length, 4, 'el bucle de reconexion debe seguir vivo');

// 4) El backoff debe crecer y no ser siempre el mismo valor fijo.
global.setTimeout = setTimeoutReal;
Module._load = cargaOriginal;

console.log('OK reconexion: ' + botsCreados.length + ' instancias, bucle nunca se atasca');
process.exit(0);

/**
 * Regresion del ticket 196: cuando el proceso muere de golpe (SIGKILL externo,
 * corte de red), el servidor conserva la sesion unos segundos. Reconectar de
 * inmediato solo cosecha "Este reproductor ya esta en linea", y cada expulsion
 * realimentaba el bucle hasta que el centinela reiniciaba el servicio.
 *
 * Se comprueba que un kick de sesion duplicada espera al menos el piso de
 * gracia, que un kick normal no paga ese peaje, y que el backoff sigue creciendo.
 */
const assert = require('assert');
const Module = require('module');
const EventEmitter = require('events');
const os = require('os');
const path = require('path');

process.env.SAORI_BOT_SOCK = path.join(os.tmpdir(), 'saori-t196-' + process.pid + '.sock');

const botsCreados = [];
function botFalso() {
  const bot = new EventEmitter();
  bot.username = 'SaoriStar';
  bot.chat = () => {};
  bot.quit = () => {};
  bot._client = new EventEmitter();
  bot._client.end = () => {};
  bot.loadPlugin = () => {};
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
Module._load = function (peticion) {
  if (Object.prototype.hasOwnProperty.call(stubs, peticion)) return stubs[peticion];
  return cargaOriginal.apply(this, arguments);
};

const setTimeoutReal = global.setTimeout;
const pendientes = [];
global.setTimeout = (fn, ms) => { pendientes.push({ fn, ms }); return { unref() {} }; };

require('../src/index.js');

function ultimaEspera() { return pendientes[pendientes.length - 1].ms; }
function correrPendientes() { while (pendientes.length) pendientes.shift().fn(); }

const PISO_FANTASMA_MS = 45000;

// 1) Kick de sesion duplicada: debe esperar al menos el piso de gracia.
botsCreados[0].emit('kicked', { text: 'Este reproductor ya esta en linea' });
assert.ok(ultimaEspera() >= PISO_FANTASMA_MS,
  'un kick de sesion fantasma debe esperar al menos ' + PISO_FANTASMA_MS + ' ms, espero ' + ultimaEspera());
correrPendientes();
assert.strictEqual(botsCreados.length, 2, 'debe reconectar tras el kick fantasma');

// 2) La variante en ingles del servidor tambien cuenta como fantasma.
botsCreados[1].emit('kicked', { text: 'You are already online!' });
assert.ok(ultimaEspera() >= PISO_FANTASMA_MS, 'la variante en ingles tambien debe pagar el piso');
correrPendientes();

// 3) Un kick normal NO paga el piso: tras un spawn sano el backoff vuelve a cero.
botsCreados[2].emit('spawn');
botsCreados[2].emit('kicked', { text: 'ANTIBOT' });
assert.ok(ultimaEspera() < PISO_FANTASMA_MS,
  'un kick corriente no debe esperar el piso de sesion fantasma, espero ' + ultimaEspera());
correrPendientes();

// 4) El bucle sigue vivo y el backoff crece entre intentos consecutivos.
const antes = (botsCreados[3].emit('end'), ultimaEspera());
correrPendientes();
const despues = (botsCreados[4].emit('end'), ultimaEspera());
assert.ok(despues > antes, 'el backoff debe crecer entre intentos (' + antes + ' -> ' + despues + ')');
correrPendientes();

global.setTimeout = setTimeoutReal;
Module._load = cargaOriginal;
console.log('OK sesion-fantasma: piso de gracia aplicado solo al kick duplicado, backoff creciente');
process.exit(0);

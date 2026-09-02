/**
 * Un ban o rechazo por whitelist es una decisión administrativa, no una caída de red.
 * El bot debe quedarse quieto hasta que Jack lo rehabilite y reinicie el servicio.
 */
const assert = require('assert');
const Module = require('module');
const EventEmitter = require('events');
const os = require('os');
const path = require('path');

process.env.SAORI_BOT_SOCK = path.join(os.tmpdir(), 'saori-terminal-' + process.pid + '.sock');

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

const stubs = { mineflayer: { createBot: botFalso, pathfinder: {}, Movements: function () {} } };
for (const mod of ['./auth', './chat', './moderation', './survival']) {
  stubs[mod] = new Proxy({}, { get: () => () => {} });
}
stubs['./brain'] = { SaoriBrain: function () { this.setSkills = () => {}; } };
stubs['./skills'] = { SaoriSkillsEngine: function () {} };
stubs['./perception'] = { getPerceptionState: () => ({ ready: false }) };

const cargaOriginal = Module._load;
Module._load = function (peticion) {
  if (Object.prototype.hasOwnProperty.call(stubs, peticion)) return stubs[peticion];
  return cargaOriginal.apply(this, arguments);
};

const setTimeoutReal = global.setTimeout;
const pendientes = [];
global.setTimeout = (fn, ms) => { pendientes.push({ fn, ms }); return { unref() {} }; };

const modulo = require('../src/index.js');
assert.strictEqual(modulo.esKickTerminal({ translate: 'multiplayer.disconnect.banned.reason' }), true);
assert.strictEqual(modulo.esKickTerminal({ text: 'hasta nuevo aviso' }), true);
assert.strictEqual(modulo.esKickTerminal({ text: 'ANTIBOT' }), false);

botsCreados[0].emit('kicked', { translate: 'multiplayer.disconnect.banned.reason', with: ['hasta nuevo aviso'] });
botsCreados[0].emit('end', 'socketClosed');
assert.strictEqual(pendientes.length, 0, 'un ban no debe programar ninguna reconexión');
assert.strictEqual(botsCreados.length, 1, 'un ban no debe crear otra instancia');

global.setTimeout = setTimeoutReal;
Module._load = cargaOriginal;
console.log('OK rechazo administrativo: reconexión inhibida');
process.exit(0);

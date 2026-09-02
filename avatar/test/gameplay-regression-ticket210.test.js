const test = require('node:test');
const assert = require('node:assert/strict');

const { getPerceptionState } = require('../src/perception');
const { equipGear } = require('../src/survival');
const { handleDirectJackActions } = require('../src/chat');
const { SaoriBrain } = require('../src/brain');

test('percepcion no afirma estar lista sin posicion', () => {
  assert.deepEqual(getPerceptionState({ entity: { position: null } }), {
    ready: false,
    reason: 'Bot position not loaded'
  });
});

test('equipamiento periodico no reemplaza la herramienta por una espada', async () => {
  const equipped = [];
  const bot = {
    inventory: {
      items: () => [
        { name: 'diamond_sword' },
        { name: 'iron_axe' },
        { name: 'diamond_helmet' }
      ]
    },
    equip: async (item, slot) => equipped.push([item.name, slot])
  };
  equipGear(bot);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(equipped, [['diamond_helmet', 'head']]);
});

test('una sancion pedida por Jack no se promete si shadow mode la bloquea', () => {
  const commands = [];
  const bot = { chat: command => commands.push(command) };
  const reply = handleDirectJackActions(bot, null, null, 'Jack', 'Saori mata a pepino');
  assert.match(reply, /no ejecutare ni fingire/i);
  assert.deepEqual(commands, []);
});

test('una accion bloqueada expira y permite que el cerebro vuelva a decidir', async () => {
  const brain = Object.create(SaoriBrain.prototype);
  await assert.rejects(
    brain.withActionTimeout(new Promise(() => {}), 10, 'ruta_prueba'),
    /ruta_prueba excedio 10 ms/
  );
});

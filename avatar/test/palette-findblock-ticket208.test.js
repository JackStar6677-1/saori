/**
 * Regresion del ticket 208:
 * talarSegunMeta() y aNivel() en brain.js lanzaban:
 * [BRAIN-LOOP-ERR] Cannot read properties of null (reading 'y')
 * cuando mineflayer bot.findBlock() evalua el predicado matcher contra
 * bloques sinteticos de paleta de chunk (Block.fromStateId) cuya position es null/undefined.
 */
const assert = require('assert');
const test = require('node:test');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'saori-findblock-'));
process.env.SAORI_BOT_DATA = tmp;

function metaFalsa(x, y, z, r) { this.x = x; this.y = y; this.z = z; this.r = r; }

const stubs = {
  'mineflayer-pathfinder': {
    goals: { GoalNear: metaFalsa, GoalXZ: metaFalsa, GoalFollow: metaFalsa }
  },
  'mineflayer-auto-eat': { plugin: () => {} }
};

const cargarOriginal = Module._load;
Module._load = function (peticion, padre, esPrincipal) {
  if (Object.prototype.hasOwnProperty.call(stubs, peticion)) return stubs[peticion];
  return cargarOriginal(peticion, padre, esPrincipal);
};

const { SaoriBrain } = require('../src/brain');
const { SaoriSkillsEngine } = require('../src/skills');

function posicion(x, y, z) {
  return {
    x,
    y,
    z,
    floored: () => ({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }),
    offset: (dx, dy, dz) => posicion(x + dx, y + dy, z + dz),
    distanceTo: (o) => Math.sqrt((x - o.x) ** 2 + (y - o.y) ** 2 + (z - o.z) ** 2)
  };
}

function crearBotMock(opciones = {}) {
  const entityPos = opciones.pos || posicion(10, 64, -20);
  return {
    username: 'SaoriStar',
    health: 20,
    food: 20,
    entity: { position: entityPos },
    game: { dimension: 'overworld' },
    inventory: {
      items: () => opciones.items || [
        { name: 'diamond_axe', count: 1, type: 279, slot: 0 },
        { name: 'cherry_log', count: 2, type: 500, slot: 1 }
      ],
      slots: []
    },
    pathfinder: {
      isMoving: () => false,
      goto: async () => {}
    },
    equip: async () => {},
    dig: async () => {},
    entities: {},
    nearestEntity: () => null,
    blockAt: () => null,
    findBlocks: (findOpts) => {
      if (typeof opciones.findBlocksHandler === 'function') {
        return opciones.findBlocksHandler(findOpts);
      }
      return [];
    },
    findBlock: (findOpts) => {
      if (typeof opciones.findBlockHandler === 'function') {
        return opciones.findBlockHandler(findOpts);
      }
      return null;
    },
    time: { timeOfDay: 0 }
  };
}

test('matcher de findLogTarget tolera bloques de paleta sinteticos con position nula/indefinida', () => {
  const matchersCapturados = [];
  const bot = crearBotMock({
    findBlocksHandler: (opts) => {
      matchersCapturados.push(opts.matching);
      return [];
    }
  });

  const brain = new SaoriBrain(bot, {});
  brain.currentGoal = 'recolectar_madera_cerezo';

  brain.findLogTarget('cherry', 64);
  brain.findLogTarget(null, 64);
  assert.strictEqual(matchersCapturados.length, 2, 'Debio consultar candidatos por especie y fallback');

  const matcherEspecie = matchersCapturados[0];
  const matcherFallback = matchersCapturados[1];

  // Bloque sintetico de paleta de cerezo (sin position)
  const bloqueCerezoPaleta = { name: 'cherry_log', position: null };
  assert.doesNotThrow(() => {
    const res = matcherEspecie(bloqueCerezoPaleta);
    assert.strictEqual(res, true, 'Debe coincidir en el filtro de paleta para que mineflayer explore la seccion');
  });

  const bloqueCerezoPaletaUndef = { name: 'cherry_log' };
  assert.doesNotThrow(() => {
    const res = matcherEspecie(bloqueCerezoPaletaUndef);
    assert.strictEqual(res, true);
  });

  // Bloque sintetico de otra madera (sin position)
  const bloqueRoblePaleta = { name: 'oak_log', position: null };
  assert.strictEqual(matcherEspecie(bloqueRoblePaleta), false, 'No debe coincidir en matcher de cerezo');
  assert.strictEqual(matcherFallback(bloqueRoblePaleta), true, 'Debe coincidir en matcher de fallback');
});

test('findLogTarget filtra altura y cuarentena usando posiciones reales', () => {
  const bloques = new Map();
  const pCercano = posicion(12, 64, -20);
  const pAlto = posicion(11, 70, -20);
  bloques.set('12:64:-20', { name: 'oak_log', position: pCercano });
  bloques.set('11:70:-20', { name: 'oak_log', position: pAlto });
  const bot = crearBotMock({
    pos: posicion(10, 64, -20),
    findBlocksHandler: () => [pAlto, pCercano]
  });
  bot.blockAt = pos => bloques.get(`${pos.x}:${pos.y}:${pos.z}`) || null;

  const brain = new SaoriBrain(bot, {});
  assert.strictEqual(brain.findLogTarget(null, 64)?.position, pCercano);
  brain.failedTargets.set('12:64:-20', Date.now() + 60_000);
  assert.strictEqual(brain.findLogTarget(null, 64), null, 'No debe reintentar el objetivo fallido ni elegir el bloque demasiado alto');
});

test('runDecisionLoop no lanza [BRAIN-LOOP-ERR] cuando se evalua paleta de bloques', async () => {
  const errores = [];
  const logOriginal = console.log;
  console.log = (...args) => {
    if (args[0] === '[BRAIN-LOOP-ERR]') {
      errores.push(args.join(' '));
    }
    logOriginal.apply(console, args);
  };

  try {
    const bot = crearBotMock({
      findBlockHandler: (opts) => {
        // Simulacion exacta de lo que hace mineflayer isBlockInSection
        const dummyPaletteBlock = { name: 'cherry_log', position: null };
        opts.matching(dummyPaletteBlock);
        return {
          name: 'cherry_log',
          position: posicion(11, 64, -20)
        };
      }
    });

    const brain = new SaoriBrain(bot, {});
    brain.currentGoal = 'recolectar_madera_cerezo';

    await brain.runDecisionLoop();
    assert.strictEqual(errores.length, 0, 'runDecisionLoop no debio capturar ningun error en el bucle');
  } finally {
    console.log = logOriginal;
  }
});

test('habilidades y guardas soportan bot sin posicion o entidad sin arrojar excepciones', async () => {
  const botSinPos = crearBotMock();
  delete botSinPos.entity.position;

  const brain = new SaoriBrain(botSinPos, {});
  const skills = new SaoriSkillsEngine(botSinPos, {});
  brain.setSkills(skills);

  assert.doesNotThrow(async () => {
    await brain.runDecisionLoop();
    await brain.autoDefensaTactico();
    await brain.recoverGrave();
    await skills.buildAthenaTemple();
  });
});

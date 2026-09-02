/**
 * Regresion del ticket 200: al adoptar el arbol vivo como canonico (ticket 199)
 * el brain.js versionado perdio saveMemory(), el historial de aprendizaje y la
 * unica llamada a curriculum.js, que quedo como codigo muerto. Sin eso SaoriStar
 * no conservaba meta, progreso ni diario de reflexion entre reinicios del
 * servicio, y una tumba ya vaciada revivia en el siguiente arranque.
 *
 * Se valida contra el brain.js real, con mineflayer y pathfinder falsos.
 */
const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'saori-mem-'));
process.env.SAORI_BOT_DATA = tmp;
const MEMORY_PATH = path.join(tmp, 'saori_minecraft_memory.json');

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

function posicion(x, y, z) {
  return { x, y, z, floored: () => ({ x, y, z }) };
}

// Bot minimo: solo lo que brain.js consulta para memoria y percepcion.
function botFalso(items) {
  return {
    username: 'SaoriStar',
    health: 20,
    food: 20,
    entity: { position: posicion(10, 64, -20) },
    game: { dimension: 'overworld' },
    inventory: {
      items: () => items || [],
      slots: []
    },
    entities: {},
    blockAt: () => null,
    findBlock: () => null,
    time: { timeOfDay: 0 }
  };
}

function leerMemoria() {
  return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf-8'));
}

// 1. Una reflexion persiste en disco y sobrevive a un reinicio del proceso.
{
  const brain = new SaoriBrain(botFalso(), {});
  brain.setGoal('recolectar_madera_cerezo');
  brain.logReflection('prueba', true, 'primera reflexion');

  assert.ok(fs.existsSync(MEMORY_PATH), 'logReflection debe escribir la memoria en disco');
  const disco = leerMemoria();
  assert.strictEqual(disco.lastGoal, 'recolectar_madera_cerezo');
  // setGoal deja su propia reflexion, asi que el diario arranca con dos entradas.
  assert.deepStrictEqual(disco.reflections.map(r => r.action), ['set_goal', 'prueba']);
  assert.strictEqual(disco.reflections[1].details, 'primera reflexion');
  assert.deepStrictEqual(disco.reflections[1].position, { x: 10, y: 64, z: -20 });

  const revivido = new SaoriBrain(botFalso(), {});
  assert.strictEqual(revivido.currentGoal, 'recolectar_madera_cerezo', 'la meta debe sobrevivir al reinicio');
  assert.strictEqual(revivido.reflections.length, 2, 'el diario debe sobrevivir al reinicio');
}

// 2. La tumba recuperada no revive tras reiniciar el servicio.
{
  const bot = botFalso();
  const brain = new SaoriBrain(bot, {});
  brain.handleDeath();
  assert.deepStrictEqual(leerMemoria().lastDeathPos, { x: 10, y: 64, z: -20 }, 'la muerte debe persistirse');

  const trasMuerte = new SaoriBrain(botFalso(), {});
  assert.ok(trasMuerte.lastDeathPos, 'una tumba pendiente debe recuperarse del disco');

  // Se simula el final exitoso de recoverGrave sin ejercitar el pathfinder.
  brain.lastDeathPos = null;
  brain.logReflection('recuperar_tumba', true, 'Pertenencias recuperadas tras respawn.');
  assert.strictEqual(leerMemoria().lastDeathPos, null, 'la tumba vaciada debe borrarse del disco');

  const trasRescate = new SaoriBrain(botFalso(), {});
  assert.strictEqual(trasRescate.lastDeathPos, null, 'una tumba ya vaciada no debe revivir al reiniciar');
}

// 3. curriculum.js vuelve a estar vivo: la fase se evalua y su progreso persiste.
{
  fs.rmSync(MEMORY_PATH, { force: true });
  const brain = new SaoriBrain(botFalso([]), {});
  assert.strictEqual(brain.learningHistory.curriculumPhase, null);

  const fase1 = brain.evaluarCurriculum();
  assert.ok(fase1, 'evaluarCurriculum debe devolver la fase vigente');
  assert.strictEqual(fase1.currentPhase.id, 'PHASE_1_BASIC_WOOD', 'sin madera se arranca en la fase 1');
  assert.strictEqual(leerMemoria().learningHistory.curriculumPhase, 'PHASE_1_BASIC_WOOD');

  // Con madera suficiente avanza de fase y anota la anterior como completada.
  const conMadera = botFalso([{ name: 'oak_log', count: 12, slot: 0 }]);
  brain.bot = conMadera;
  const fase2 = brain.evaluarCurriculum();
  assert.strictEqual(fase2.currentPhase.id, 'PHASE_2_STONE_AGE', 'con 12 troncos debe avanzar de fase');

  const disco = leerMemoria();
  assert.strictEqual(disco.learningHistory.curriculumPhase, 'PHASE_2_STONE_AGE');
  assert.deepStrictEqual(
    disco.learningHistory.completedTasks.map(t => t.id),
    ['PHASE_1_BASIC_WOOD'],
    'la fase superada debe quedar registrada una sola vez'
  );

  // Reevaluar sin cambios no duplica el registro.
  brain.evaluarCurriculum();
  assert.strictEqual(leerMemoria().learningHistory.completedTasks.length, 1);

  const revivido = new SaoriBrain(conMadera, {});
  assert.strictEqual(revivido.learningHistory.curriculumPhase, 'PHASE_2_STONE_AGE', 'la fase debe sobrevivir al reinicio');
  assert.deepStrictEqual(revivido.learningHistory.completedTasks.map(t => t.id), ['PHASE_1_BASIC_WOOD']);
}

// 4. Una memoria corrupta no tumba el arranque ni arrastra basura.
{
  fs.writeFileSync(MEMORY_PATH, '{ esto no es json', 'utf-8');
  const brain = new SaoriBrain(botFalso(), {});
  assert.deepStrictEqual(brain.reflections, [], 'una memoria ilegible se descarta');
  assert.strictEqual(brain.lastDeathPos, null);
  assert.ok(brain.saveMemory(), 'debe poder reescribir la memoria corrupta');
  assert.ok(leerMemoria().learningHistory, 'la memoria reescrita vuelve a ser legible');
}

Module._load = cargarOriginal;
fs.rmSync(tmp, { recursive: true, force: true });
console.log('OK memoria-persistente-ticket200: meta, diario, tumba y curriculum persisten entre reinicios');

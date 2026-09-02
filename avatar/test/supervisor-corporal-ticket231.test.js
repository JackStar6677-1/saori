/**
 * Ticket 231 · Supervisor corporal independiente del LLM.
 * Verifica el diagnostico determinista, la prioridad de los peligros, el
 * rescate sin alterar el mapa y el deadline con progreso observable.
 */
const test = require('node:test');
const assert = require('node:assert');
const { SupervisorCorporal, diagnosticar, UMBRALES } = require('../src/supervisor');

const base = (extra = {}) => ({
  listo: true,
  now: 1000,
  posicion: { x: 0, y: 64, z: 0 },
  salud: 20,
  comida: 20,
  oxigeno: 20,
  enAgua: false,
  enLava: false,
  paredes: 0,
  enPozo: false,
  muestrasInmovil: 0,
  msEnMismoBloque: 0,
  enBucle: false,
  pathfinderMoviendo: false,
  ranurasLibres: 10,
  inventarioLleno: false,
  herramientaIncorrecta: false,
  objetivoInalcanzable: null,
  tarea: null,
  ...extra
});

test('cuerpo sano no genera diagnostico', () => {
  assert.strictEqual(diagnosticar(base()), null);
});

test('snapshot no listo no genera diagnostico', () => {
  assert.strictEqual(diagnosticar({ listo: false }), null);
  assert.strictEqual(diagnosticar(null), null);
});

test('la lava tiene prioridad sobre cualquier otro fallo', () => {
  const d = diagnosticar(base({
    enLava: true, enPozo: true, inventarioLleno: true, enBucle: true,
    salud: 3, msEnMismoBloque: 60000
  }));
  assert.strictEqual(d.codigo, 'lava');
  assert.strictEqual(d.remedio, 'escapar_liquido');
  assert.strictEqual(d.severidad, 'critica');
});

test('ahogo solo se dispara en agua con oxigeno bajo', () => {
  assert.strictEqual(diagnosticar(base({ enAgua: true, oxigeno: 20 })), null);
  const d = diagnosticar(base({ enAgua: true, oxigeno: UMBRALES.oxigenoCritico }));
  assert.strictEqual(d.codigo, 'ahogo');
  assert.strictEqual(d.remedio, 'emerger');
});

test('salud critica retira al punto seguro y no confunde muerte con umbral', () => {
  assert.strictEqual(diagnosticar(base({ salud: 0 })), null);
  assert.strictEqual(diagnosticar(base({ salud: UMBRALES.saludCritica })).remedio, 'volver_a_punto_seguro');
});

test('el pozo exige paredes y permanencia, no solo paredes', () => {
  assert.strictEqual(diagnosticar(base({ enPozo: true, msEnMismoBloque: 1000 })), null);
  const d = diagnosticar(base({ enPozo: true, paredes: 4, msEnMismoBloque: UMBRALES.msEnPozoParaRescate }));
  assert.strictEqual(d.codigo, 'pozo');
  assert.strictEqual(d.remedio, 'volver_a_punto_seguro');
});

test('objetivo inalcanzable, bucle e inmovilidad tienen remedios distintos', () => {
  assert.strictEqual(diagnosticar(base({ objetivoInalcanzable: true })).remedio, 'cancelar_objetivo');
  assert.strictEqual(diagnosticar(base({ enBucle: true })).remedio, 'recalcular_ruta');
  const inmovil = diagnosticar(base({ muestrasInmovil: 3, pathfinderMoviendo: true }));
  assert.strictEqual(inmovil.codigo, 'inmovil');
  assert.strictEqual(inmovil.remedio, 'desatascar');
});

test('quieto sin ruta activa no cuenta como atasco', () => {
  assert.strictEqual(diagnosticar(base({ muestrasInmovil: 9, pathfinderMoviendo: false })), null);
});

test('inventario lleno y herramienta incorrecta se detectan', () => {
  assert.strictEqual(diagnosticar(base({ inventarioLleno: true })).codigo, 'inventario_lleno');
  assert.strictEqual(diagnosticar(base({ herramientaIncorrecta: true })).remedio, 'reequipar');
});

test('deadline y falta de progreso cancelan la tarea', () => {
  assert.strictEqual(
    diagnosticar(base({ tarea: { id: 'minar_minerales', deadlineExcedido: true, sinProgreso: false } })).codigo,
    'deadline_excedido'
  );
  assert.strictEqual(
    diagnosticar(base({ tarea: { id: 'minar_minerales', deadlineExcedido: false, sinProgreso: true } })).codigo,
    'sin_progreso'
  );
  assert.strictEqual(
    diagnosticar(base({ tarea: { id: 'x', deadlineExcedido: false, sinProgreso: false } })),
    null
  );
});

// ─── Integracion con un bot falso ───────────────────────────────────────────

function botFalso(opts = {}) {
  const control = { estados: [], limpiezas: 0, metas: [] };
  const pos = {
    x: opts.x ?? 0, y: opts.y ?? 64, z: opts.z ?? 0,
    offset(dx, dy, dz) { return { x: this.x + dx, y: this.y + dy, z: this.z + dz }; }
  };
  return {
    control,
    entity: { position: pos },
    health: opts.health ?? 20,
    food: 20,
    oxygenLevel: opts.oxygenLevel ?? 20,
    inventory: {
      emptySlotCount: () => opts.ranurasLibres ?? 10,
      items: () => opts.items || []
    },
    pathfinder: {
      isMoving: () => Boolean(opts.moviendo),
      setGoal: (g) => control.metas.push(g),
      goto: async () => { control.metas.push('goto'); }
    },
    blockAt: (p) => (opts.blockAt ? opts.blockAt(p) : { name: p.y < (opts.y ?? 64) ? 'stone' : 'air', boundingBox: p.y < (opts.y ?? 64) ? 'block' : 'empty' }),
    setControlState: (n, v) => control.estados.push(`${n}:${v}`),
    clearControlStates: () => { control.limpiezas += 1; }
  };
}

test('el supervisor detecta inmovilidad real y desatasca sin tocar el mapa', async () => {
  let ahora = 0;
  const bot = botFalso({ moviendo: true });
  const sup = new SupervisorCorporal(bot, { ahora: () => ahora, intervaloRemedioMs: 0 });

  for (let i = 0; i < 3; i += 1) { ahora += 6000; assert.strictEqual(await sup.supervisar(), null); }
  ahora += 6000;
  const diag = await sup.supervisar();

  assert.strictEqual(diag.codigo, 'inmovil');
  assert.ok(bot.control.estados.includes('jump:true'));
  assert.ok(bot.control.estados.includes('back:true'));
  assert.strictEqual(typeof bot.dig, 'undefined', 'el supervisor no debe romper bloques');
  assert.strictEqual(sup.rescates, 1);
});

test('el movimiento real reinicia el contador de inmovilidad', async () => {
  let ahora = 0;
  const bot = botFalso({ moviendo: true });
  const sup = new SupervisorCorporal(bot, { ahora: () => ahora, intervaloRemedioMs: 0 });
  for (let i = 0; i < 6; i += 1) {
    ahora += 6000;
    bot.entity.position.x += 2;
    assert.strictEqual(await sup.supervisar(), null);
  }
});

test('el punto seguro nunca se fija dentro de lava', async () => {
  let ahora = 0;
  const bot = botFalso({
    blockAt: (p) => (p.y < 64 ? { name: 'stone', boundingBox: 'block' } : { name: 'lava', boundingBox: 'empty' })
  });
  const sup = new SupervisorCorporal(bot, { ahora: () => ahora, intervaloRemedioMs: 0 });
  ahora += 1000;
  const diag = await sup.supervisar();
  assert.strictEqual(diag.codigo, 'lava');
  assert.strictEqual(sup.puntoSeguro, null);
});

test('el cooldown evita encadenar rescates en cada tick', async () => {
  let ahora = 0;
  // Inventario lleno: la condicion persiste tras el remedio, asi que sirve
  // para comprobar el enfriamiento sin que el propio rescate la borre.
  const bot = botFalso({ ranurasLibres: 0 });
  const sup = new SupervisorCorporal(bot, { ahora: () => ahora, intervaloRemedioMs: 30000 });

  ahora += 1000;
  const primero = await sup.supervisar();
  assert.strictEqual(primero.codigo, 'inventario_lleno');
  assert.strictEqual(primero.aplicado, true);

  ahora += 1000;
  const segundo = await sup.supervisar();
  assert.strictEqual(segundo.aplicado, false, 'el segundo diagnostico no debe ejecutar remedio');
  assert.strictEqual(sup.rescates, 1);

  ahora += 40000;
  const tercero = await sup.supervisar();
  assert.strictEqual(tercero.aplicado, true, 'pasado el enfriamiento vuelve a rescatar');
  assert.strictEqual(sup.rescates, 2);
});

test('el desatasco limpia su propia condicion y no se repite en el tick siguiente', async () => {
  let ahora = 0;
  const bot = botFalso({ moviendo: true });
  const sup = new SupervisorCorporal(bot, { ahora: () => ahora, intervaloRemedioMs: 0 });
  for (let i = 0; i < 4; i += 1) { ahora += 6000; await sup.supervisar(); }
  assert.strictEqual(sup.rescates, 1);
  ahora += 6000;
  assert.strictEqual(await sup.supervisar(), null);
});

test('la tarea mide progreso observable y se cancela al vencer el deadline', async () => {
  let ahora = 0;
  let troncos = 0;
  const bot = botFalso();
  const sup = new SupervisorCorporal(bot, { ahora: () => ahora, intervaloRemedioMs: 0, sinProgresoMs: 60000 });

  sup.declararTarea({ id: 'recolectar_madera', deadlineMs: 10000, medirProgreso: () => troncos });
  ahora += 1000; troncos = 4;
  assert.strictEqual(await sup.supervisar(), null);
  assert.strictEqual(sup.tarea.progreso, 4);

  ahora += 20000;
  const diag = await sup.supervisar();
  assert.strictEqual(diag.codigo, 'deadline_excedido');
  assert.strictEqual(sup.tarea, null, 'la tarea vencida debe quedar cancelada');
});

test('declarar la misma meta no reinicia el reloj de la tarea', () => {
  let ahora = 0;
  const sup = new SupervisorCorporal(botFalso(), { ahora: () => ahora });
  sup.declararTarea({ id: 'minar_minerales', deadlineMs: 5000 });
  const inicio = sup.tarea.inicioAt;
  ahora += 4000;
  sup.declararTarea({ id: 'minar_minerales', deadlineMs: 5000 });
  assert.strictEqual(sup.tarea.inicioAt, inicio);
  sup.declararTarea({ id: 'explorar_terreno' });
  assert.strictEqual(sup.tarea.id, 'explorar_terreno');
  assert.strictEqual(sup.tarea.inicioAt, 4000);
});

test('un bot sin posicion no tumba al supervisor', async () => {
  const sup = new SupervisorCorporal({}, { ahora: () => 1 });
  assert.strictEqual(await sup.supervisar(), null);
  assert.strictEqual(sup.capturar().listo, false);
});

test('estado() resume el trabajo del supervisor para /saori status', async () => {
  let ahora = 0;
  const bot = botFalso({ moviendo: true });
  const sup = new SupervisorCorporal(bot, { ahora: () => ahora, intervaloRemedioMs: 0 });
  sup.declararTarea({ id: 'explorar_terreno', deadlineMs: 9999999 });
  for (let i = 0; i < 4; i += 1) { ahora += 6000; await sup.supervisar(); }
  const e = sup.estado();
  assert.strictEqual(e.rescates, 1);
  assert.strictEqual(e.contadores.inmovil, 1);
  assert.strictEqual(e.tarea.id, 'explorar_terreno');
  assert.ok(e.ultimo_diagnostico);
});

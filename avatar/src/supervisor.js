/**
 * Supervisor Corporal · Ticket 231
 *
 * Capa determinista e INDEPENDIENTE del LLM que conserva la locomocion y la
 * seguridad fisica de SaoriStar. El cerebro (y el modelo, cuando hay cuota)
 * elige QUE meta perseguir; este modulo decide cuando el cuerpo esta en un
 * estado invalido y aplica el rescate, incluso con la cuota agotada.
 *
 * Diseno: `diagnosticar()` es una funcion PURA sobre un snapshot plano, de modo
 * que las regresiones se prueban sin servidor ni mineflayer. Los efectos viven
 * en `aplicarRemedio()`, que nunca lanza.
 */

let GoalNear = null;
try {
  ({ goals: { GoalNear } } = require('mineflayer-pathfinder'));
} catch (e) {
  GoalNear = null;
}

const UMBRALES = {
  muestrasInmovil: 3,          // ticks consecutivos en el mismo bloque
  muestrasBucle: 6,            // posiciones repetidas en ciclo corto
  historialPosiciones: 12,
  oxigenoCritico: 8,           // de 20; por debajo se emerge
  saludCritica: 7,             // de 20
  paredesPozo: 4,              // lados solidos que confirman un hoyo
  ranurasLibresMinimas: 0,     // 0 libres = inventario lleno
  deadlinePorDefectoMs: 180000,
  sinProgresoMs: 60000,
  intervaloRemedioMs: 1500,
  msEnPozoParaRescate: 15000
};

// Bloques que no cuentan como pared/suelo.
const AIRES = new Set(['air', 'cave_air', 'void_air']);
const LIQUIDOS = new Set(['water', 'lava', 'flowing_water', 'flowing_lava', 'bubble_column']);

function esAire(nombre) {
  return !nombre || AIRES.has(nombre);
}

function esSolido(bloque) {
  if (!bloque || !bloque.name) return false;
  if (esAire(bloque.name)) return false;
  if (LIQUIDOS.has(bloque.name)) return false;
  if (bloque.boundingBox === 'empty') return false;
  return true;
}

function clave(pos) {
  if (!pos) return null;
  return `${Math.floor(pos.x)}:${Math.floor(pos.y)}:${Math.floor(pos.z)}`;
}

/**
 * Diagnostico determinista. Devuelve el hallazgo mas grave o null si el cuerpo
 * esta sano. El orden es deliberado: primero lo que mata, despues lo que
 * bloquea la locomocion, y al final lo que solo desperdicia tiempo.
 *
 * @param {object} s snapshot plano (ver capturar()).
 * @returns {{codigo:string, severidad:string, motivo:string, remedio:string, interrumpe:boolean}|null}
 */
function diagnosticar(s) {
  if (!s || !s.listo) return null;

  const d = (codigo, severidad, motivo, remedio, interrumpe = true) =>
    ({ codigo, severidad, motivo, remedio, interrumpe });

  // 1. Peligro vital inmediato.
  if (s.enLava) {
    return d('lava', 'critica', 'Cuerpo dentro de lava', 'escapar_liquido');
  }
  if (s.enAgua && typeof s.oxigeno === 'number' && s.oxigeno <= UMBRALES.oxigenoCritico) {
    return d('ahogo', 'critica', `Oxigeno ${s.oxigeno} bajo el minimo`, 'emerger');
  }
  if (typeof s.salud === 'number' && s.salud > 0 && s.salud <= UMBRALES.saludCritica) {
    return d('salud_critica', 'critica', `Salud ${s.salud} en umbral de retirada`, 'volver_a_punto_seguro');
  }

  // 2. Locomocion fisicamente imposible.
  if (s.enPozo && s.msEnMismoBloque >= UMBRALES.msEnPozoParaRescate) {
    return d('pozo', 'alta', `Encerrado por ${s.paredes} paredes durante ${s.msEnMismoBloque} ms`, 'volver_a_punto_seguro');
  }
  if (s.objetivoInalcanzable === true) {
    return d('objetivo_inalcanzable', 'alta', 'El pathfinder declaro la ruta imposible', 'cancelar_objetivo');
  }
  if (s.enBucle) {
    return d('bucle', 'alta', 'Ciclo corto de posiciones repetido', 'recalcular_ruta');
  }
  if (s.muestrasInmovil >= UMBRALES.muestrasInmovil && s.pathfinderMoviendo) {
    return d('inmovil', 'media', `Sin cambio de bloque en ${s.muestrasInmovil} muestras con ruta activa`, 'desatascar');
  }

  // 3. Tarea que no puede completarse aunque el cuerpo se mueva.
  if (s.inventarioLleno) {
    return d('inventario_lleno', 'media', 'Sin ranuras libres para el botin de la tarea', 'cancelar_objetivo');
  }
  if (s.herramientaIncorrecta) {
    return d('herramienta_incorrecta', 'media', 'La herramienta en mano no cosecha el objetivo', 'reequipar');
  }

  // 4. Tarea viva pero esteril.
  if (s.tarea) {
    if (s.tarea.deadlineExcedido) {
      return d('deadline_excedido', 'media', `Tarea ${s.tarea.id} supero su deadline`, 'cancelar_objetivo');
    }
    if (s.tarea.sinProgreso) {
      return d('sin_progreso', 'media', `Tarea ${s.tarea.id} sin progreso observable`, 'cancelar_objetivo');
    }
  }

  return null;
}

class SupervisorCorporal {
  constructor(bot, opciones = {}) {
    this.bot = bot;
    this.opciones = { ...UMBRALES, ...opciones };
    this.ahora = opciones.ahora || (() => Date.now());
    this.historial = [];
    this.ultimoBloque = null;
    this.ultimoBloqueDesde = this.ahora();
    this.muestrasInmovil = 0;
    this.puntoSeguro = null;
    this.tarea = null;
    // Arranca fuera del enfriamiento: el primer atasco tras conectar debe
    // rescatarse de inmediato, no esperar una ventana completa.
    this.ultimoRemedioAt = this.ahora() - this.opciones.intervaloRemedioMs;
    this.ultimoDiagnostico = null;
    this.contadores = {};
    this.rescates = 0;
    this.necesitaReequipar = false;
  }

  /**
   * Toda tarea del cerebro declara progreso observable y deadline. Sin estos
   * dos datos el supervisor no puede distinguir "trabajando" de "colgada".
   */
  declararTarea({ id, deadlineMs, medirProgreso } = {}) {
    if (!id) return null;
    if (this.tarea && this.tarea.id === id) return this.tarea;
    const now = this.ahora();
    this.tarea = {
      id,
      inicioAt: now,
      deadlineMs: Number.isFinite(deadlineMs) && deadlineMs > 0 ? deadlineMs : this.opciones.deadlinePorDefectoMs,
      medirProgreso: typeof medirProgreso === 'function' ? medirProgreso : null,
      progreso: null,
      ultimoProgresoAt: now,
      cancelada: false
    };
    return this.tarea;
  }

  finalizarTarea(id) {
    if (!this.tarea) return false;
    if (id && this.tarea.id !== id) return false;
    this.tarea = null;
    return true;
  }

  // El progreso puede empujarse desde fuera (bloques talados, mineral obtenido)
  // o leerse de la sonda declarada por la tarea.
  registrarProgreso(valor) {
    if (!this.tarea) return false;
    if (valor === null || valor === undefined) return false;
    if (this.tarea.progreso === null || valor !== this.tarea.progreso) {
      this.tarea.progreso = valor;
      this.tarea.ultimoProgresoAt = this.ahora();
      return true;
    }
    return false;
  }

  evaluarTarea(now) {
    if (!this.tarea) return null;
    if (this.tarea.medirProgreso) {
      let medido = null;
      try {
        medido = this.tarea.medirProgreso();
      } catch (e) {
        medido = null;
      }
      this.registrarProgreso(medido);
    }
    return {
      id: this.tarea.id,
      progreso: this.tarea.progreso,
      edadMs: now - this.tarea.inicioAt,
      deadlineExcedido: now - this.tarea.inicioAt > this.tarea.deadlineMs,
      sinProgreso: this.tarea.progreso !== null &&
        now - this.tarea.ultimoProgresoAt > this.opciones.sinProgresoMs
    };
  }

  bloqueRelativo(dx, dy, dz) {
    try {
      const pos = this.bot?.entity?.position;
      if (!pos || typeof this.bot.blockAt !== 'function') return null;
      return this.bot.blockAt(pos.offset(dx, dy, dz)) || null;
    } catch (e) {
      return null;
    }
  }

  contarParedes() {
    const lados = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let paredes = 0;
    for (const [dx, dz] of lados) {
      const pies = this.bloqueRelativo(dx, 0, dz);
      const cabeza = this.bloqueRelativo(dx, 1, dz);
      if (esSolido(pies) && esSolido(cabeza)) paredes += 1;
    }
    return paredes;
  }

  detectarBucle() {
    const h = this.historial;
    if (h.length < this.opciones.muestrasBucle) return false;
    const ventana = h.slice(-this.opciones.muestrasBucle);
    const unicos = new Set(ventana);
    // Un ciclo corto (ir y volver entre dos o tres bloques) repetido durante
    // toda la ventana es un bucle, no exploracion.
    return unicos.size > 1 && unicos.size <= 3;
  }

  /**
   * Construye el snapshot plano que consume `diagnosticar()`. Todo va con
   * guardas: un bot a medio conectar no debe tumbar el supervisor.
   */
  capturar(extra = {}) {
    const now = this.ahora();
    const pos = this.bot?.entity?.position;
    if (!pos) {
      return { listo: false, motivo: 'posicion no cargada', now };
    }

    const k = clave(pos);
    if (k === this.ultimoBloque) {
      this.muestrasInmovil += 1;
    } else {
      this.muestrasInmovil = 0;
      this.ultimoBloque = k;
      this.ultimoBloqueDesde = now;
    }
    this.historial.push(k);
    if (this.historial.length > this.opciones.historialPosiciones) this.historial.shift();

    const bloquePies = this.bloqueRelativo(0, 0, 0);
    const bloqueCabeza = this.bloqueRelativo(0, 1, 0);
    const nombrePies = bloquePies?.name || null;
    const nombreCabeza = bloqueCabeza?.name || null;
    const paredes = this.contarParedes();
    const techoAbierto = !esSolido(this.bloqueRelativo(0, 2, 0));

    const inventario = this.bot?.inventory;
    let ranurasLibres = null;
    try {
      if (inventario && typeof inventario.emptySlotCount === 'function') {
        ranurasLibres = inventario.emptySlotCount();
      }
    } catch (e) {
      ranurasLibres = null;
    }

    let pathfinderMoviendo = false;
    try {
      pathfinderMoviendo = Boolean(this.bot?.pathfinder?.isMoving && this.bot.pathfinder.isMoving());
    } catch (e) {
      pathfinderMoviendo = false;
    }

    const snapshot = {
      listo: true,
      now,
      posicion: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
      salud: typeof this.bot.health === 'number' ? this.bot.health : null,
      comida: typeof this.bot.food === 'number' ? this.bot.food : null,
      oxigeno: typeof this.bot.oxygenLevel === 'number' ? this.bot.oxygenLevel : null,
      enAgua: nombrePies === 'water' || nombreCabeza === 'water' || nombrePies === 'flowing_water',
      enLava: nombrePies === 'lava' || nombreCabeza === 'lava' || nombrePies === 'flowing_lava',
      paredes,
      enPozo: paredes >= this.opciones.paredesPozo && techoAbierto,
      muestrasInmovil: this.muestrasInmovil,
      msEnMismoBloque: now - this.ultimoBloqueDesde,
      enBucle: this.detectarBucle(),
      pathfinderMoviendo,
      ranurasLibres,
      inventarioLleno: ranurasLibres !== null && ranurasLibres <= this.opciones.ranurasLibresMinimas,
      herramientaIncorrecta: Boolean(extra.herramientaIncorrecta),
      objetivoInalcanzable: extra.objetivoInalcanzable === true ? true : null,
      tarea: this.evaluarTarea(now)
    };

    // El punto seguro solo se actualiza cuando el cuerpo esta realmente sano:
    // asi el rescate nunca devuelve al bot al mismo pozo o a la lava.
    if (!snapshot.enLava && !snapshot.enAgua && !snapshot.enPozo &&
        (snapshot.salud === null || snapshot.salud > this.opciones.saludCritica) &&
        esSolido(this.bloqueRelativo(0, -1, 0))) {
      this.puntoSeguro = { ...snapshot.posicion, at: now };
    }

    return snapshot;
  }

  async pausa(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  detener() {
    try {
      this.bot?.pathfinder?.setGoal?.(null);
    } catch (e) { /* pathfinder aun no cargado */ }
    try {
      this.bot?.clearControlStates?.();
    } catch (e) { /* sesion cerrada */ }
  }

  async volverAPuntoSeguro() {
    const destino = this.puntoSeguro;
    this.detener();
    if (!destino || !GoalNear || !this.bot?.pathfinder?.goto) return false;
    try {
      await this.bot.pathfinder.goto(new GoalNear(destino.x, destino.y, destino.z, 2));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Aplica el rescate. Nunca rompe ni coloca bloques: alterar el mapa para
   * salir de un atasco esta prohibido en el santuario (ver survival.js).
   */
  async aplicarRemedio(diag) {
    if (!diag) return false;
    this.necesitaReequipar = false;
    try {
      switch (diag.remedio) {
        case 'escapar_liquido':
          this.detener();
          this.bot?.setControlState?.('jump', true);
          this.bot?.setControlState?.('forward', true);
          await this.pausa(700);
          this.bot?.clearControlStates?.();
          await this.volverAPuntoSeguro();
          return true;

        case 'emerger':
          this.detener();
          this.bot?.setControlState?.('jump', true);
          await this.pausa(900);
          this.bot?.clearControlStates?.();
          return true;

        case 'volver_a_punto_seguro':
          await this.volverAPuntoSeguro();
          return true;

        case 'desatascar':
          this.detener();
          this.bot?.setControlState?.('jump', true);
          this.bot?.setControlState?.('back', true);
          await this.pausa(450);
          this.bot?.clearControlStates?.();
          this.muestrasInmovil = 0;
          return true;

        case 'recalcular_ruta':
          this.detener();
          this.historial = [];
          return true;

        case 'cancelar_objetivo':
          this.detener();
          if (this.tarea) this.tarea.cancelada = true;
          this.finalizarTarea();
          return true;

        case 'reequipar':
          // El reequipamiento real es del cerebro (equipGear); el supervisor
          // solo detiene el intento esteril y deja la bandera.
          this.detener();
          this.necesitaReequipar = true;
          return true;

        default:
          return false;
      }
    } catch (e) {
      return false;
    }
  }

  /**
   * Un ciclo completo: capturar, diagnosticar, rescatar. Devuelve el
   * diagnostico aplicado o null si el cuerpo esta sano. No lanza nunca.
   */
  async supervisar(extra = {}) {
    try {
      const snapshot = this.capturar(extra);
      const diag = diagnosticar(snapshot);
      if (!diag) {
        this.ultimoDiagnostico = null;
        return null;
      }

      const now = snapshot.now;
      const enfriando = now - this.ultimoRemedioAt < this.opciones.intervaloRemedioMs;
      this.ultimoDiagnostico = { ...diag, timestamp: now, aplicado: !enfriando };
      if (enfriando) return this.ultimoDiagnostico;

      this.ultimoRemedioAt = now;
      this.contadores[diag.codigo] = (this.contadores[diag.codigo] || 0) + 1;
      this.rescates += 1;
      await this.aplicarRemedio(diag);
      return this.ultimoDiagnostico;
    } catch (e) {
      return null;
    }
  }

  // Resumen para /saori status y para el estado que ve el Trio en Star.
  estado() {
    return {
      rescates: this.rescates,
      contadores: { ...this.contadores },
      ultimo_diagnostico: this.ultimoDiagnostico,
      punto_seguro: this.puntoSeguro,
      necesita_reequipar: this.necesitaReequipar,
      tarea: this.tarea
        ? {
            id: this.tarea.id,
            progreso: this.tarea.progreso,
            edad_ms: this.ahora() - this.tarea.inicioAt,
            deadline_ms: this.tarea.deadlineMs
          }
        : null
    };
  }
}

module.exports = { SupervisorCorporal, diagnosticar, UMBRALES, esSolido };

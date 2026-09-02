/**
 * Brain Engine · Cerebro Autónomo Super-Expandido de SAORI
 * Inteligencia adaptativa, 12 metas activas, combate táctico, recuperación de tumbas y memoria
 */
const fs = require('fs');
const path = require('path');
const { equipGear } = require('./survival');
const { INVENTORY_CLEANUP_THRESHOLD } = require('./skills');
const { getPerceptionState } = require('./perception');
const { evaluateCurrentCurriculum } = require('./curriculum');
const { SupervisorCorporal } = require('./supervisor');
const { goals: { GoalNear, GoalXZ, GoalFollow } } = require('mineflayer-pathfinder');

// SAORI_BOT_DATA permite a las pruebas usar un directorio temporal en vez de
// escribir sobre la memoria real de la partida.
const DATA_DIR = process.env.SAORI_BOT_DATA || path.join(__dirname, '../data');
const MEMORY_PATH = path.join(DATA_DIR, 'saori_minecraft_memory.json');
const HABILIDADES_BASE = ['wander', 'gather_wood', 'auto_eat', 'auto_equip', 'recover_grave', 'combat'];
const STAR_STATE_PATH = '/home/jack/ai-hub/memory/saori_state.json';

const METAS = {
  explorar_terreno: { id: 'explorar_terreno', desc: 'Exploración y cartografía de biomas' },
  recolectar_madera: { id: 'recolectar_madera', troncosObjetivo: 32, especie: null },
  recolectar_madera_cerezo: { id: 'recolectar_madera_cerezo', troncosObjetivo: 24, especie: 'cherry' },
  minar_minerales: { id: 'minar_minerales', desc: 'Extracción de hierro, carbón y diamantes' },
  craftear_herramientas: { id: 'craftear_herramientas', desc: 'Forja de herramientas y cofres' },
  construir_templo_atenea: { id: 'construir_templo_atenea', desc: 'Construcción del Templo de Atenea' },
  lootear_cofres: { id: 'lootear_cofres', desc: 'Saqueo de cofres salvajes y mazmorras' },
  organizar_base: { id: 'organizar_base', desc: 'Almacenamiento en cofres del santuario' },
  investigar_slimefun: { id: 'investigar_slimefun', desc: 'Investigaciones en la guía de Slimefun' },
  patrullar_santuario: { id: 'patrullar_santuario', desc: 'Vigilancia y patrullaje defensivo' },
  autodefensa_tactica: { id: 'autodefensa_tactica', desc: 'Combate defensivo y supervivencia' },
  navegar_teletransporte: { id: 'navegar_teletransporte', desc: 'Navegación por puntos sagrados' }
};
const META_POR_DEFECTO = 'explorar_terreno';

// Cada meta declara su deadline (ticket 231). Pasado ese plazo sin progreso
// observable el supervisor corporal la cancela, aunque el modelo insista.
const DEADLINE_POR_META = {
  explorar_terreno: 120000,
  recolectar_madera: 180000,
  recolectar_madera_cerezo: 240000,
  minar_minerales: 240000,
  craftear_herramientas: 90000,
  construir_templo_atenea: 300000,
  lootear_cofres: 180000,
  organizar_base: 120000,
  investigar_slimefun: 90000,
  patrullar_santuario: 120000,
  autodefensa_tactica: 60000,
  navegar_teletransporte: 90000
};

class SaoriBrain {
  constructor(bot, config) {
    this.bot = bot;
    this.config = config;
    this.skills = null;
    this.isPaused = false;
    this.followingTarget = null;
    this.lastDeathPos = null;
    this.recoveringGrave = false;
    this.mainLoopTimer = null;
    this.isLoopRunning = false;
    this.currentGoal = META_POR_DEFECTO;
    this.busyAction = false;
    this.lastLoopError = null;
    this.lastAction = { name: 'inicio', status: 'idle', timestamp: Date.now() };
    this.lastMovementSample = null;
    this.stuckSamples = 0;
    this.failedTargets = new Map();
    this.woodFailureStreak = 0;
    this.woodBackoffUntil = 0;
    this.reflections = [];
    this.supervisor = new SupervisorCorporal(bot);
    this.learningHistory = {
      sessionStart: Date.now(),
      completedTasks: [],
      skillsLearned: [...HABILIDADES_BASE],
      curriculumPhase: null
    };
    this.loadMemory();
  }

  setSkills(skills) {
    this.skills = skills;
  }

  loadMemory() {
    try {
      if (!fs.existsSync(MEMORY_PATH)) return;
      const d = JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf-8'));
      if (Array.isArray(d.reflections)) {
        this.reflections = d.reflections.slice(-150);
      }
      // lastDeathPos ausente o null significa que no hay tumba pendiente: no se
      // conserva la del arranque anterior (ticket 200).
      this.lastDeathPos = d.lastDeathPos || null;
      if (d.lastGoal && Object.prototype.hasOwnProperty.call(METAS, d.lastGoal)) {
        this.currentGoal = d.lastGoal;
      }
      if (d.learningHistory && typeof d.learningHistory === 'object') {
        const h = d.learningHistory;
        this.learningHistory = {
          sessionStart: typeof h.sessionStart === 'number' ? h.sessionStart : Date.now(),
          completedTasks: Array.isArray(h.completedTasks) ? h.completedTasks.slice(-100) : [],
          skillsLearned: Array.isArray(h.skillsLearned) && h.skillsLearned.length
            ? Array.from(new Set([...HABILIDADES_BASE, ...h.skillsLearned]))
            : [...HABILIDADES_BASE],
          curriculumPhase: h.curriculumPhase || null
        };
      }
    } catch (e) {
      console.warn('[BRAIN] Memoria ilegible, se arranca en limpio:', e.message);
    }
  }

  // Escritura atomica: un corte de energia a mitad de volcado dejaba la memoria
  // truncada y loadMemory() la descartaba entera en el siguiente arranque.
  saveMemory() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const mem = {
        reflections: this.reflections,
        lastGoal: this.currentGoal,
        lastDeathPos: this.lastDeathPos,
        learningHistory: this.learningHistory,
        updatedAt: Date.now()
      };
      const tmp = `${MEMORY_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(mem, null, 2), 'utf-8');
      fs.renameSync(tmp, MEMORY_PATH);
      return true;
    } catch (e) {
      console.warn('[BRAIN] Error guardando memoria:', e.message);
      return false;
    }
  }

  logReflection(action, success, details) {
    const entry = {
      timestamp: Date.now(),
      action,
      success,
      details,
      position: this.bot.entity && this.bot.entity.position ? this.bot.entity.position.floored() : null
    };
    this.reflections.push(entry);
    if (this.reflections.length > 150) this.reflections.shift();
    this.saveMemory();
  }

  recordAction(name, status, details = null) {
    this.lastAction = { name, status, details, timestamp: Date.now() };
    console.log(`[ACTION] ${name} ${status}${details ? ': ' + details : ''}`);
  }

  async equipBestTool(block) {
    if (!block || !this.bot || !this.bot.pathfinder || !this.bot.inventory) return null;
    const tool = this.bot.pathfinder.bestHarvestTool(block);
    if (!tool) return null;
    await this.bot.equip(tool, 'hand');
    return tool;
  }

  async withActionTimeout(promise, timeoutMs, actionName) {
    let timer = null;
    try {
      return await Promise.race([
        promise,
        new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`${actionName} excedio ${timeoutMs} ms`)), timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // Progreso observable por meta (ticket 231): un numero que DEBE crecer si la
  // tarea avanza de verdad. Sin esta sonda no se distingue trabajo de bucle.
  medirProgresoDeMeta(meta) {
    const items = this.bot?.inventory?.items ? this.bot.inventory.items() : [];
    const suma = (filtro) => items.filter(filtro).reduce((t, i) => t + (i.count || 0), 0);

    switch (meta) {
      case 'recolectar_madera':
      case 'recolectar_madera_cerezo':
        return suma(i => i.name && (i.name.includes('_log') || i.name.includes('_wood')));
      case 'minar_minerales':
        return suma(i => i.name && (i.name.includes('ore') || ['coal', 'raw_iron', 'iron_ingot', 'diamond', 'raw_copper', 'raw_gold'].includes(i.name)));
      case 'lootear_cofres':
      case 'organizar_base':
        return items.length;
      case 'construir_templo_atenea':
        return suma(i => i.name && (i.name.includes('stone') || i.name.includes('planks') || i.name.includes('brick')));
      default: {
        // Explorar y patrullar progresan por desplazamiento, no por botin.
        const p = this.bot?.entity?.position;
        if (!p) return null;
        return Math.floor(Math.abs(p.x) + Math.abs(p.z));
      }
    }
  }

  declararTareaDeMeta(meta) {
    if (!this.supervisor) return null;
    return this.supervisor.declararTarea({
      id: meta,
      deadlineMs: DEADLINE_POR_META[meta] || undefined,
      medirProgreso: () => this.medirProgresoDeMeta(meta)
    });
  }

  // El supervisor corporal manda sobre el cuerpo: si diagnostica un estado
  // invalido, el ciclo cede el turno al rescate antes de perseguir la meta.
  async supervisarCuerpo() {
    if (!this.supervisor) return false;
    const diag = await this.supervisor.supervisar();
    if (!diag) return false;
    if (diag.aplicado) {
      this.recordAction(`supervisor_${diag.codigo}`, 'completed', `${diag.motivo} -> ${diag.remedio}`);
      if (diag.remedio === 'cancelar_objetivo') {
        this.failedTargets.clear();
      }
      if (this.supervisor.necesitaReequipar) {
        equipGear(this.bot);
      }
    }
    return Boolean(diag.interrumpe);
  }

  // Compatibilidad: la deteccion de inmovilidad ahora vive en el supervisor.
  async recoverIfStuck() {
    return this.supervisarCuerpo();
  }

  targetAvailable(block) {
    // Mineflayer preevalua matchers con bloques sinteticos sin posicion.
    if (!block?.position) return true;
    const key = `${block.position.x}:${block.position.y}:${block.position.z}`;
    const retryAt = this.failedTargets.get(key) || 0;
    if (retryAt <= Date.now()) {
      this.failedTargets.delete(key);
      return true;
    }
    return false;
  }

  // findBlock evalua el matcher con bloques sin coordenadas. Primero obtenemos
  // posiciones candidatas y solo despues filtramos los bloques reales, de modo
  // que la cuarentena de rutas imposibles sea efectiva.
  findLogTarget(species, botY) {
    if (!this.bot || typeof this.bot.findBlocks !== 'function') return null;
    const esTronco = (b) => Boolean(b?.name && (b.name.includes('_log') || b.name.includes('_wood')));
    const posiciones = this.bot.findBlocks({
      matching: (b) => esTronco(b) && (!species || b.name.includes(species)),
      maxDistance: 24,
      count: 32
    }) || [];

    return posiciones
      .map(pos => this.bot.blockAt(pos))
      .filter(block => block?.position && esTronco(block))
      .filter(block => Math.abs(block.position.y - botY) <= 3)
      .filter(block => this.targetAvailable(block))
      .sort((a, b) => this.bot.entity.position.distanceTo(a.position) - this.bot.entity.position.distanceTo(b.position))[0] || null;
  }

  // Registra una tarea del curriculum como cumplida una sola vez, para que el
  // progreso sobreviva a los reinicios del servicio.
  markTaskCompleted(taskId, details) {
    if (!taskId) return false;
    if (this.learningHistory.completedTasks.some(t => t.id === taskId)) return false;
    this.learningHistory.completedTasks.push({ id: taskId, timestamp: Date.now(), details: details || null });
    if (this.learningHistory.completedTasks.length > 100) this.learningHistory.completedTasks.shift();
    this.logReflection('curriculum_fase', true, `Fase completada: ${taskId}`);
    return true;
  }

  // Evalua el arbol de progresion sin alterar la meta activa: solo deja constancia
  // de la fase vigente en la memoria y en el estado que ve el Trio.
  evaluarCurriculum() {
    try {
      const perception = getPerceptionState(this.bot);
      if (!perception || !perception.ready) return null;
      const estado = evaluateCurrentCurriculum(perception);
      if (!estado || !estado.currentPhase) return null;

      const anterior = this.learningHistory.curriculumPhase;
      const actual = estado.currentPhase.id;
      if (anterior && anterior !== actual) {
        this.markTaskCompleted(anterior, 'Superada al avanzar de fase');
      }
      if (anterior !== actual) {
        this.learningHistory.curriculumPhase = actual;
        this.saveMemory();
      }
      return estado;
    } catch (e) {
      return null;
    }
  }

  setGoal(goal) {
    const clave = String(goal || '').trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(METAS, clave)) {
      console.warn('[BRAIN] Meta desconocida rechazada:', goal);
      return false;
    }
    if (clave !== this.currentGoal) {
      console.log('[BRAIN] Nueva meta asignada:', clave);
      this.logReflection('set_goal', true, `Meta cambiada a ${clave}`);
    }
    this.currentGoal = clave;
    return true;
  }

  metaActual() {
    return METAS[this.currentGoal] || METAS[META_POR_DEFECTO];
  }

  contarTroncos() {
    if (!this.bot.inventory) return 0;
    return this.bot.inventory.items()
      .filter(i => i.name.includes('_log') || i.name.includes('_wood'))
      .reduce((total, i) => total + i.count, 0);
  }

  handleDeath() {
    if (this.bot.entity && this.bot.entity.position) {
      this.lastDeathPos = this.bot.entity.position.floored();
      this.logReflection('muerte', false, `Caída en combate en ${this.lastDeathPos.x}, ${this.lastDeathPos.y}, ${this.lastDeathPos.z}`);
      console.log('[DEATH] Posición de muerte guardada:', this.lastDeathPos);
    }
  }

  async recoverGrave() {
    if (!this.lastDeathPos || this.recoveringGrave || !this.bot || !this.bot.entity || !this.bot.entity.position) return false;
    this.recoveringGrave = true;
    console.log('[GRAVE] Recuperando pertenencias sagradas en:', this.lastDeathPos);

    try {
      await this.bot.pathfinder.goto(new GoalNear(this.lastDeathPos.x, this.lastDeathPos.y, this.lastDeathPos.z, 2));
      await new Promise(r => setTimeout(r, 2000));
      // Primero se olvida la tumba y luego se persiste: si se guardaba antes,
      // el reinicio del servicio revivia una tumba ya vaciada (ticket 200).
      this.lastDeathPos = null;
      this.logReflection('recuperar_tumba', true, 'Pertenencias recuperadas tras respawn.');
      return true;
    } catch (e) {
      console.log('[GRAVE-ERR]', e.message);
      return false;
    } finally {
      this.recoveringGrave = false;
    }
  }

  // Combate y Autodefensa Táctica (0 tokens)
  async autoDefensaTactico() {
    if (!this.bot || !this.bot.entity || !this.bot.entity.position || this.bot.health <= 0) return false;

    const hostil = this.bot.nearestEntity(e => {
      if (!e || e.type !== 'mob' || !e.position) return false;
      const n = e.name ? e.name.toLowerCase() : '';
      return n.includes('zombie') || n.includes('skeleton') || n.includes('spider') || 
             n.includes('creeper') || n.includes('enderman') || n.includes('witch') || n.includes('drowned');
    });

    if (!hostil || !hostil.position || this.bot.entity.position.distanceTo(hostil.position) > 8) return false;

    const sword = this.bot.inventory ? this.bot.inventory.items().find(i => i.name.includes('sword')) : null;
    if (sword) await this.bot.equip(sword, 'hand').catch(() => {});

    const shield = this.bot.inventory ? this.bot.inventory.items().find(i => i.name === 'shield') : null;
    if (shield) await this.bot.equip(shield, 'off-hand').catch(() => {});

    if (this.bot.health <= 8) {
      console.log('[DEFENSE] Salud baja. Retrocediendo tácticamente...');
      const fleePos = this.bot.entity.position.offset(
        (this.bot.entity.position.x - hostil.position.x) * 2,
        0,
        (this.bot.entity.position.z - hostil.position.z) * 2
      );
      await this.bot.pathfinder.goto(new GoalXZ(fleePos.x, fleePos.z)).catch(() => {});
      return true;
    }

    const dist = this.bot.entity.position.distanceTo(hostil.position);
    if (hostil.name && hostil.name.includes('creeper') && dist < 3.5) {
      await this.bot.attack(hostil);
      const backPos = this.bot.entity.position.offset(0, 0, -2);
      await this.bot.pathfinder.goto(new GoalXZ(backPos.x, backPos.z)).catch(() => {});
      return true;
    }

    await this.bot.lookAt(hostil.position.offset(0, 1, 0), true);
    await this.bot.attack(hostil);
    return true;
  }

  // Tala de Madera
  async talarSegunMeta() {
    const meta = this.metaActual();
    if (this.busyAction) return false;
    if (!this.bot || !this.bot.entity || !this.bot.entity.position) return false;
    if (Date.now() < this.woodBackoffUntil) return false;

    const botY = this.bot.entity.position.y;
    let tronco = meta.especie ? this.findLogTarget(meta.especie, botY) : null;
    if (!tronco) tronco = this.findLogTarget(null, botY);
    if (!tronco) return false;

    this.busyAction = true;
    this.recordAction('talar_madera', 'started', tronco.name);
    try {
      await this.equipBestTool(tronco).catch(() => null);
      await this.withActionTimeout(
        this.bot.pathfinder.goto(new GoalNear(tronco.position.x, tronco.position.y, tronco.position.z, 2)),
        15000,
        'ruta_hacia_tronco'
      );
      await this.withActionTimeout(this.bot.dig(tronco), 10000, 'talar_tronco');
      this.woodFailureStreak = 0;
      this.woodBackoffUntil = 0;
      this.logReflection('talar_madera', true, `Tronco recolectado en ${tronco.position}`);
      this.recordAction('talar_madera', 'completed', tronco.name);
      return true;
    } catch (e) {
      const failedKey = `${tronco.position.x}:${tronco.position.y}:${tronco.position.z}`;
      this.failedTargets.set(failedKey, Date.now() + 5 * 60 * 1000);
      this.woodFailureStreak += 1;
      if (this.woodFailureStreak >= 3) {
        this.woodBackoffUntil = Date.now() + 60 * 1000;
        this.woodFailureStreak = 0;
        this.recordAction('talar_madera', 'backoff', 'tres rutas imposibles; reintento en 60 s');
      }
      if (this.bot.pathfinder) this.bot.pathfinder.setGoal(null);
      if (this.bot.clearControlStates) this.bot.clearControlStates();
      this.recordAction('talar_madera', 'failed', e.message);
      return false;
    } finally {
      this.busyAction = false;
    }
  }

  // Sincronización del Estado hacia AI Hub
  syncStateToStarHub() {
    if (!this.bot || !this.bot.entity || !this.bot.entity.position) return;
    try {
      const p = this.bot.entity.position;
      const inv = this.bot.inventory ? this.bot.inventory.items().map(i => ({ name: i.name, count: i.count, slot: i.slot })) : [];
      const armor = {
        head: this.bot.inventory ? this.bot.inventory.slots[5]?.name || null : null,
        torso: this.bot.inventory ? this.bot.inventory.slots[6]?.name || null : null,
        legs: this.bot.inventory ? this.bot.inventory.slots[7]?.name || null : null,
        feet: this.bot.inventory ? this.bot.inventory.slots[8]?.name || null : null,
        offhand: this.bot.inventory ? this.bot.inventory.slots[45]?.name || null : null
      };

      const stateObj = {
        timestamp: Date.now(),
        username: this.bot.username,
        health: this.bot.health,
        food: this.bot.food,
        dimension: this.bot.game ? this.bot.game.dimension : 'overworld',
        position: { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) },
        current_goal: this.currentGoal,
        armor,
        inventory_count: inv.length,
        inventory: inv,
        current_task: this.skills ? (this.skills.currentTask || 'Patrulla') : 'Patrulla',
        curriculum_phase: this.learningHistory.curriculumPhase,
        completed_tasks: this.learningHistory.completedTasks.map(t => t.id),
        session_start: this.learningHistory.sessionStart,
        last_action: this.lastAction,
        last_loop_error: this.lastLoopError,
        supervisor: this.supervisor ? this.supervisor.estado() : null
      };

      const dir = path.dirname(STAR_STATE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(STAR_STATE_PATH, JSON.stringify(stateObj, null, 2), 'utf-8');
    } catch (e) {}
  }

  // Bucle Autónomo de Decisión y Ejecución
  async runDecisionLoop() {
    if (this.isPaused || this.isLoopRunning || !this.bot || !this.bot.entity || !this.bot.entity.position) return;
    this.isLoopRunning = true;

    try {
      this.evaluarCurriculum();
      this.syncStateToStarHub();

      this.declararTareaDeMeta(this.currentGoal);
      if (await this.supervisarCuerpo()) return;

      // 1. Autodefensa táctica ante monstruos cercanos
      const defendido = await this.autoDefensaTactico();
      if (defendido) return;

      // 2. Equipamiento óptimo de armadura y herramientas
      equipGear(this.bot);

      // 3. Limpieza silenciosa de inventario si está saturado
      if (this.skills) {
        await this.skills.manageInventoryAndStore();
      }

      // 4. Ejecución según la meta activa
      switch (this.currentGoal) {
        case 'recolectar_madera':
        case 'recolectar_madera_cerezo':
          await this.talarSegunMeta();
          break;

        case 'minar_minerales':
          if (this.skills) await this.skills.mineDeepResources('ore');
          break;

        case 'lootear_cofres':
          if (this.skills) await this.skills.lootWildChests();
          break;

        case 'construir_templo_atenea':
          if (this.skills) await this.skills.buildAthenaTemple();
          break;

        case 'organizar_base':
          if (this.skills) await this.skills.storeAtBaseChest();
          break;

        case 'explorar_terreno':
        default:
          if (!this.bot.pathfinder.isMoving() && this.bot.entity && this.bot.entity.position) {
            const rx = Math.floor(Math.random() * 20) - 10;
            const rz = Math.floor(Math.random() * 20) - 10;
            const target = this.bot.entity.position.offset(rx, 0, rz);
            await this.bot.pathfinder.goto(new GoalNear(target.x, target.y, target.z, 2)).catch(() => {});
          }
          break;
      }
    } catch (err) {
      this.lastLoopError = { message: err.message, stack: err.stack || null, timestamp: Date.now() };
      console.log('[BRAIN-LOOP-ERR]', err.stack || err.message);
    } finally {
      this.isLoopRunning = false;
    }
  }

  start() {
    console.log('[BRAIN] Motor cognitivo super-expandido de SAORI activo.');
    if (this.mainLoopTimer) clearInterval(this.mainLoopTimer);
    this.mainLoopTimer = setInterval(() => this.runDecisionLoop(), 6000);
  }

  stop() {
    if (this.mainLoopTimer) {
      clearInterval(this.mainLoopTimer);
      this.mainLoopTimer = null;
    }
    // Un apagado ordenado no debe perder la meta ni el progreso de la sesion.
    this.saveMemory();
  }

  followPlayer(username) {
    this.followingTarget = username;
    if (this.bot && this.bot.players && this.bot.players[username]) {
      const p = this.bot.players[username];
      if (p.entity && this.bot.pathfinder) {
        this.bot.pathfinder.setGoal(new GoalFollow(p.entity, 2), true);
      }
    }
  }

  stopAll() {
    this.followingTarget = null;
    if (this.bot && this.bot.pathfinder) {
      this.bot.pathfinder.setGoal(null);
    }
  }

  startAutonomousLoop() {
    return this.start();
  }

  stopAutonomousLoop() {
    return this.stop();
  }
}

module.exports = { SaoriBrain, METAS, META_POR_DEFECTO };

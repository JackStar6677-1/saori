/**
 * Brain Engine · Cerebro Autónomo Super-Expandido de SAORI
 * Inteligencia adaptativa, 12 metas activas, combate táctico, recuperación de tumbas y memoria
 */
const fs = require('fs');
const path = require('path');
const { equipGear } = require('./survival');
const { INVENTORY_CLEANUP_THRESHOLD } = require('./skills');
const { goals: { GoalNear, GoalXZ, GoalFollow } } = require('mineflayer-pathfinder');

const MEMORY_PATH = path.join(__dirname, '../data/saori_minecraft_memory.json');
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
    this.reflections = [];
    this.loadMemory();
  }

  setSkills(skills) {
    this.skills = skills;
  }

  loadMemory() {
    try {
      if (fs.existsSync(MEMORY_PATH)) {
        const d = JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf-8'));
        if (d.reflections && Array.isArray(d.reflections)) {
          this.reflections = d.reflections.slice(-100);
        }
        if (d.lastDeathPos) this.lastDeathPos = d.lastDeathPos;
      }
    } catch (e) {}
  }

  logReflection(action, success, details) {
    try {
      const entry = {
        timestamp: Date.now(),
        action,
        success,
        details,
        position: this.bot.entity ? this.bot.entity.position.floored() : null
      };
      this.reflections.push(entry);
      if (this.reflections.length > 150) this.reflections.shift();

      let mem = {};
      if (fs.existsSync(MEMORY_PATH)) {
        try { mem = JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf-8')); } catch (e) {}
      }
      mem.reflections = this.reflections;
      mem.lastGoal = this.currentGoal;
      mem.lastDeathPos = this.lastDeathPos;
      mem.updatedAt = Date.now();
      fs.writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2), 'utf-8');
    } catch (e) {}
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
    if (!this.lastDeathPos || this.recoveringGrave) return false;
    this.recoveringGrave = true;
    console.log('[GRAVE] Recuperando pertenencias sagradas en:', this.lastDeathPos);

    try {
      await this.bot.pathfinder.goto(new GoalNear(this.lastDeathPos.x, this.lastDeathPos.y, this.lastDeathPos.z, 2));
      await new Promise(r => setTimeout(r, 2000));
      this.logReflection('recuperar_tumba', true, 'Pertenencias recuperadas tras respawn.');
      this.lastDeathPos = null;
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
    if (!this.bot.entity || this.bot.health <= 0) return false;

    const hostil = this.bot.nearestEntity(e => {
      if (!e || e.type !== 'mob') return false;
      const n = e.name ? e.name.toLowerCase() : '';
      return n.includes('zombie') || n.includes('skeleton') || n.includes('spider') || 
             n.includes('creeper') || n.includes('enderman') || n.includes('witch') || n.includes('drowned');
    });

    if (!hostil || this.bot.entity.position.distanceTo(hostil.position) > 8) return false;

    const sword = this.bot.inventory.items().find(i => i.name.includes('sword'));
    if (sword) await this.bot.equip(sword, 'hand').catch(() => {});

    const shield = this.bot.inventory.items().find(i => i.name === 'shield');
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

    const botY = this.bot.entity.position.y;
    const esTronco = (b) => b && b.name && (b.name.includes('_log') || b.name.includes('_wood'));
    const aNivel = (b) => Math.abs(b.position.y - botY) <= 3;

    let tronco = null;
    if (meta.especie) {
      tronco = this.bot.findBlock({ matching: (b) => esTronco(b) && b.name.includes(meta.especie) && aNivel(b), maxDistance: 20 });
    }
    if (!tronco) {
      tronco = this.bot.findBlock({ matching: (b) => esTronco(b) && aNivel(b), maxDistance: 20 });
    }
    if (!tronco) return false;

    this.busyAction = true;
    try {
      const hacha = this.bot.inventory.items().find(i => i.name.includes('axe') && !i.name.includes('pickaxe'));
      if (hacha) await this.bot.equip(hacha, 'hand').catch(() => {});
      await this.bot.pathfinder.goto(new GoalNear(tronco.position.x, tronco.position.y, tronco.position.z, 2));
      await this.bot.dig(tronco);
      await this.bot.pathfinder.goto(new GoalNear(tronco.position.x, tronco.position.y, tronco.position.z, 1));
      this.logReflection('talar_madera', true, `Tronco recolectado en ${tronco.position}`);
      return true;
    } catch (e) {
      return false;
    } finally {
      this.busyAction = false;
    }
  }

  // Sincronización del Estado hacia AI Hub
  syncStateToStarHub() {
    if (!this.bot || !this.bot.entity) return;
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
        current_task: this.skills ? (this.skills.currentTask || 'Patrulla') : 'Patrulla'
      };

      const dir = path.dirname(STAR_STATE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(STAR_STATE_PATH, JSON.stringify(stateObj, null, 2), 'utf-8');
    } catch (e) {}
  }

  // Bucle Autónomo de Decisión y Ejecución
  async runDecisionLoop() {
    if (this.isPaused || this.isLoopRunning || !this.bot.entity) return;
    this.isLoopRunning = true;

    try {
      this.syncStateToStarHub();

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
          if (!this.bot.pathfinder.isMoving()) {
            const rx = Math.floor(Math.random() * 20) - 10;
            const rz = Math.floor(Math.random() * 20) - 10;
            const target = this.bot.entity.position.offset(rx, 0, rz);
            await this.bot.pathfinder.goto(new GoalNear(target.x, target.y, target.z, 2)).catch(() => {});
          }
          break;
      }
    } catch (err) {
      console.log('[BRAIN-LOOP-ERR]', err.message);
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
  }

  startAutonomousLoop() {
    return this.start();
  }

  stopAutonomousLoop() {
    return this.stop();
  }
}

module.exports = { SaoriBrain, METAS, META_POR_DEFECTO };

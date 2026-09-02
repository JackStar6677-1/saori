/**
 * Motor Autónomo de Habilidades Avanzadas (Skills Engine) de SAORI
 * 
 * Habilidades:
 * 1. Base Sagrada & Protección (/rtp -> /sethome templo -> /ps get -> colocar piedra)
 * 2. Crafteo Autónomo en Mesa de Trabajo y Horno
 * 3. Minería Profunda de Minerales (Hierro, Carbón, Diamantes, Cobre, Oro)
 * 4. Saqueo / Looteo de Cofres Salvajes y Mazmorras
 * 5. Almacenamiento Organizado en Cofres de Base
 * 6. Construcción Procedural del Templo de Atenea
 * 7. Investigación de Slimefun (/sf guide)
 * 8. Comandos de Moderación y Vigilancia (/warn, /kick, /tempban, /saorifreeze, /mute)
 */
let Vec3;
try {
  Vec3 = require('vec3').Vec3 || require('vec3');
} catch (e) {
  Vec3 = class {
    constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
    plus(o) { return new Vec3(this.x + o.x, this.y + o.y, this.z + o.z); }
    offset(dx, dy, dz) { return new Vec3(this.x + dx, this.y + dy, this.z + dz); }
  };
}

let GoalNear, GoalXZ, GoalFollow, GoalBlock;
try {
  const pf = require('mineflayer-pathfinder');
  GoalNear = pf.goals.GoalNear;
  GoalXZ = pf.goals.GoalXZ;
  GoalFollow = pf.goals.GoalFollow;
  GoalBlock = pf.goals.GoalBlock;
} catch (e) {
  GoalNear = class {}; GoalXZ = class {}; GoalFollow = class {}; GoalBlock = class {};
}
const fs = require('fs');
const path = require('path');

const MEMORY_PATH = path.join(__dirname, '../data/saori_minecraft_memory.json');
const INVENTORY_CLEANUP_THRESHOLD = 26;

class SaoriSkillsEngine {
  constructor(bot, brain) {
    this.bot = bot;
    this.brain = brain;
    this.currentTask = null;
    this.isWorking = false;
    this.mcData = null;
    this.lastInventoryCleanup = 0;
    this.baseLocation = null;
    this.loadMemory();
  }

  loadMemory() {
    try {
      if (fs.existsSync(MEMORY_PATH)) {
        const mem = JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf-8'));
        if (mem.baseLocation) this.baseLocation = mem.baseLocation;
      }
    } catch (e) {}
  }

  saveMemory() {
    try {
      let mem = {};
      if (fs.existsSync(MEMORY_PATH)) {
        try { mem = JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf-8')); } catch (e) {}
      }
      mem.baseLocation = this.baseLocation;
      mem.lastUpdate = Date.now();
      fs.writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2), 'utf-8');
    } catch (e) {}
  }

  initData() {
    if (!this.mcData && this.bot.version) {
      this.mcData = require('minecraft-data')(this.bot.version);
    }
  }

  // 1. Establecer Base Sagrada y Protección
  async establishBaseSettlement() {
    if (this.isWorking) return false;
    this.isWorking = true;
    this.currentTask = 'Establecer Santuario';

    try {
      this.bot.chat('Buscando tierras sagradas para fundar el santuario del Olimpo...');
      this.bot.chat('/rtp');
      await new Promise(r => setTimeout(r, 6000));

      if (!this.bot.entity || !this.bot.entity.position) return false;
      const p = this.bot.entity.position.floored();

      this.baseLocation = { x: p.x, y: p.y, z: p.z, timestamp: Date.now() };
      this.saveMemory();

      this.bot.chat('/sethome templo');
      await new Promise(r => setTimeout(r, 1000));

      this.bot.chat('/ps get');
      await new Promise(r => setTimeout(r, 1500));

      const psBlock = this.bot.inventory.items().find(i => 
        i.name.includes('ore') || i.name.includes('gold_block') || i.name.includes('iron_block') || i.name.includes('diamond_block') || i.name.includes('sponge')
      );

      if (psBlock) {
        const floor = this.bot.blockAt(p.offset(0, -1, 0));
        if (floor && floor.boundingBox === 'block') {
          await this.bot.equip(psBlock, 'hand');
          await this.bot.placeBlock(floor, new Vec3(0, 1, 0)).catch(() => {});
          this.bot.chat('Piedra de protección consagrada en el centro del templo.');
        }
      }

      console.log('[BASE] Santuario fundado en:', this.baseLocation);
      return true;
    } catch (e) {
      console.log('[BASE-ERR]', e.message);
      return false;
    } finally {
      this.isWorking = false;
      this.currentTask = null;
    }
  }

  // 2. Obtener o Craftear Mesa de Trabajo
  async getOrCreateCraftingTable() {
    this.initData();

    // 1. Buscar mesa existente en radio de 16 bloques
    let existingTable = this.bot.findBlock({
      matching: (b) => b && b.name === 'crafting_table',
      maxDistance: 16
    });

    if (existingTable) return existingTable;

    // 2. Colocar mesa de trabajo desde inventario
    let tableItem = this.bot.inventory.items().find(i => i.name === 'crafting_table');
    if (tableItem) {
      const p = this.bot.entity.position.floored().offset(1, 0, 0);
      const floor = this.bot.blockAt(p.offset(0, -1, 0));
      if (floor && floor.boundingBox === 'block') {
        await this.bot.equip(tableItem, 'hand');
        await this.bot.placeBlock(floor, new Vec3(0, 1, 0)).catch(() => {});
        await new Promise(r => setTimeout(r, 600));
        return this.bot.blockAt(p);
      }
    }

    // 3. Craftear mesa si tenemos madera/tablones
    const logItem = this.bot.inventory.items().find(i => i.name.includes('_log') || i.name.includes('_wood') || i.name.includes('_planks'));
    if (logItem && this.mcData) {
      try {
        const tableData = this.mcData.itemsByName['crafting_table'];
        if (tableData) {
          const recipes = this.bot.recipesFor(tableData.id, null, 1, null);
          if (recipes.length > 0) {
            await this.bot.craft(recipes[0], 1, null);
            tableItem = this.bot.inventory.items().find(i => i.name === 'crafting_table');
            if (tableItem) {
              const p = this.bot.entity.position.floored().offset(1, 0, 0);
              const floor = this.bot.blockAt(p.offset(0, -1, 0));
              if (floor && floor.boundingBox === 'block') {
                await this.bot.equip(tableItem, 'hand');
                await this.bot.placeBlock(floor, new Vec3(0, 1, 0)).catch(() => {});
                await new Promise(r => setTimeout(r, 600));
                return this.bot.blockAt(p);
              }
            }
          }
        }
      } catch (e) {}
    }

    return null;
  }

  // 3. Crafteo Autónomo de Herramientas, Antorchas y Cofres
  async craftItem(itemName, count = 1) {
    if (this.isWorking) return false;
    this.isWorking = true;
    this.currentTask = 'Craftear ' + itemName;
    this.initData();

    try {
      const itemData = this.mcData ? this.mcData.itemsByName[itemName] : null;
      if (!itemData) return false;

      const table = await this.getOrCreateCraftingTable();
      const recipes = this.bot.recipesFor(itemData.id, null, 1, table);
      if (recipes && recipes.length > 0) {
        if (table) {
          await this.bot.pathfinder.goto(new GoalNear(table.position.x, table.position.y, table.position.z, 2));
        }
        await this.bot.craft(recipes[0], count, table);
        console.log('[CRAFT] Crafteado con éxito:', itemName, 'x' + count);
        return true;
      }
      return false;
    } catch (e) {
      console.log('[CRAFT-ERR]', e.message);
      return false;
    } finally {
      this.isWorking = false;
      this.currentTask = null;
    }
  }

  // 4. Minería Profunda de Recursos
  async mineDeepResources(resourceType) {
    if (this.isWorking) return false;
    this.isWorking = true;
    this.currentTask = 'Minar ' + resourceType;

    try {
      const targetOre = this.bot.findBlock({
        matching: (b) => b && b.name && (b.name.includes(resourceType) || (resourceType === 'ore' && b.name.includes('_ore'))),
        maxDistance: 24
      });

      if (targetOre) {
        const pickaxe = this.bot.inventory.items().find(i => i.name.includes('pickaxe'));
        if (pickaxe) await this.bot.equip(pickaxe, 'hand').catch(() => {});

        await this.bot.pathfinder.goto(new GoalNear(targetOre.position.x, targetOre.position.y, targetOre.position.z, 2));
        await this.bot.dig(targetOre);
        await this.bot.pathfinder.goto(new GoalNear(targetOre.position.x, targetOre.position.y, targetOre.position.z, 1));
        console.log('[MINE] Mineral extraído:', targetOre.name);
        return true;
      }
      return false;
    } catch (e) {
      console.log('[MINE-ERR]', e.message);
      return false;
    } finally {
      this.isWorking = false;
      this.currentTask = null;
    }
  }

  // 5. Saqueo / Looteo de Cofres Salvajes
  async lootWildChests() {
    if (this.isWorking) return false;
    this.isWorking = true;
    this.currentTask = 'Lootear Cofre';

    try {
      const chestBlock = this.bot.findBlock({
        matching: (b) => b && (b.name === 'chest' || b.name === 'trapped_chest' || b.name === 'barrel'),
        maxDistance: 20
      });

      if (!chestBlock) return false;

      await this.bot.pathfinder.goto(new GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2));
      const chest = await this.bot.openContainer(chestBlock);
      if (!chest) return false;

      const itemsInChest = chest.containerItems();
      console.log('[LOOT] Cofre abierto. Items encontrados:', itemsInChest.length);

      for (const item of itemsInChest) {
        const valuable = item.name.includes('diamond') || item.name.includes('gold') || 
                         item.name.includes('iron') || item.name.includes('emerald') ||
                         item.name.includes('book') || item.name.includes('apple') ||
                         item.name.includes('potion') || item.name.includes('slime');
        if (valuable || chest.containerItems().length > 0) {
          try {
            await chest.withdraw(item.type, null, item.count);
            await new Promise(r => setTimeout(r, 150));
          } catch (e) {}
        }
      }

      await chest.close();
      console.log('[LOOT] Cofre saqueado con éxito.');
      return true;
    } catch (e) {
      console.log('[LOOT-ERR]', e.message);
      return false;
    } finally {
      this.isWorking = false;
      this.currentTask = null;
    }
  }

  // 6. Almacenamiento Metódico en Cofre de Base
  async storeAtBaseChest() {
    if (this.isWorking) return false;
    this.isWorking = true;
    this.currentTask = 'Almacenar en Base';

    try {
      const baseChest = this.bot.findBlock({
        matching: (b) => b && (b.name === 'chest' || b.name === 'barrel'),
        maxDistance: 16
      });

      if (!baseChest) return false;

      await this.bot.pathfinder.goto(new GoalNear(baseChest.position.x, baseChest.position.y, baseChest.position.z, 2));
      const chest = await this.bot.openContainer(baseChest);
      if (!chest) return false;

      const depositItems = [
        'cobblestone', 'dirt', 'gravel', 'sand', 'granite', 'diorite', 'andesite',
        'raw_iron', 'raw_copper', 'raw_gold', 'coal', 'purpur_block', 'end_stone'
      ];

      const inv = this.bot.inventory.items();
      for (const item of inv) {
        if (depositItems.some(d => item.name.includes(d)) && item.count > 4) {
          try {
            await chest.deposit(item.type, null, item.count - 2);
            await new Promise(r => setTimeout(r, 150));
          } catch (e) {}
        }
      }

      await chest.close();
      console.log('[STORE] Recursos excedentes guardados en el cofre sagrado.');
      return true;
    } catch (e) {
      console.log('[STORE-ERR]', e.message);
      return false;
    } finally {
      this.isWorking = false;
      this.currentTask = null;
    }
  }

  // 7. Construcción Procedural del Templo de Atenea
  async buildAthenaTemple(origin) {
    if (this.isWorking) return false;
    if (!origin && !this.baseLocation && (!this.bot || !this.bot.entity || !this.bot.entity.position)) return false;
    this.isWorking = true;
    this.currentTask = 'Construir Templo de Atenea';

    try {
      const p = origin || (this.baseLocation ? new Vec3(this.baseLocation.x, this.baseLocation.y, this.baseLocation.z) : this.bot.entity.position.floored());
      if (!p) return false;
      const ox = p.x;
      const oy = p.y;
      const oz = p.z;

      const buildingMaterial = this.bot.inventory.items().find(i => 
        i.name.includes('purpur') || i.name.includes('quartz') || i.name.includes('end_stone') || i.name.includes('stone_brick') || i.name.includes('planks') || i.name.includes('cobblestone')
      );

      if (!buildingMaterial) return false;

      await this.bot.equip(buildingMaterial, 'hand').catch(() => {});

      // Blueprint del Santuario: 4 Columnas Griegas y Perímetro
      const templeCoords = [
        // Columna Norte-Este
        { x: ox + 3, y: oy, z: oz + 3 },
        { x: ox + 3, y: oy + 1, z: oz + 3 },
        { x: ox + 3, y: oy + 2, z: oz + 3 },
        // Columna Norte-Oeste
        { x: ox - 3, y: oy, z: oz + 3 },
        { x: ox - 3, y: oy + 1, z: oz + 3 },
        { x: ox - 3, y: oy + 2, z: oz + 3 },
        // Columna Sur-Este
        { x: ox + 3, y: oy, z: oz - 3 },
        { x: ox + 3, y: oy + 1, z: oz - 3 },
        { x: ox + 3, y: oy + 2, z: oz - 3 },
        // Columna Sur-Oeste
        { x: ox - 3, y: oy, z: oz - 3 },
        { x: ox - 3, y: oy + 1, z: oz - 3 },
        { x: ox - 3, y: oy + 2, z: oz - 3 },
      ];

      for (const targetPos of templeCoords) {
        const dest = new Vec3(targetPos.x, targetPos.y, targetPos.z);
        const currentBlock = this.bot.blockAt(dest);
        if (currentBlock && currentBlock.boundingBox === 'block') continue;

        const neighbors = [
          new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)
        ];

        let referenceBlock = null;
        let faceVector = null;

        for (const n of neighbors) {
          const checkPos = dest.plus(n);
          const block = this.bot.blockAt(checkPos);
          if (block && block.boundingBox === 'block') {
            referenceBlock = block;
            faceVector = new Vec3(-n.x, -n.y, -n.z);
            break;
          }
        }

        if (referenceBlock && faceVector) {
          try {
            await this.bot.lookAt(dest, true);
            await this.bot.placeBlock(referenceBlock, faceVector);
            await new Promise(r => setTimeout(r, 300));
          } catch (e) {}
        }
      }

      console.log('[BUILD] Estructura del Templo de Atenea avanzada.');
      return true;
    } catch (err) {
      console.log('[BUILD-ERR]', err.message);
      return false;
    } finally {
      this.isWorking = false;
      this.currentTask = null;
    }
  }

  // 8. Comandos de Moderación y Vigilancia Divina
  async moderatePlayer(targetPlayer, action, reason = 'Violación de las leyes del reino') {
    if (!targetPlayer || typeof targetPlayer !== 'string') return false;
    const player = targetPlayer.trim();
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(player)) {
      console.warn('[MODERATION] Nick invalido rechazado:', targetPlayer);
      return false;
    }
    const act = String(action || '').toLowerCase().trim();
    const cleanReason = String(reason || 'Violación de las leyes del reino')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[\u00a7&][0-9a-fk-or]/g, '')
      .replace(/["';\\]/g, '')
      .trim()
      .slice(0, 80);

    console.log(`[MODERATION] Ejecutando ${act} sobre ${player}: ${cleanReason}`);

    if (act === 'warn') {
      this.bot.chat(`/warn ${player} ${cleanReason}`);
    } else if (act === 'kick') {
      this.bot.chat(`/kick ${player} ${cleanReason}`);
    } else if (act === 'freeze' || act === 'saorifreeze') {
      this.bot.chat(`/saorifreeze ${player}`);
    } else if (act === 'tempban') {
      this.bot.chat(`/tempban ${player} 1h ${cleanReason}`);
    } else if (act === 'mute') {
      this.bot.chat(`/mute ${player} 30m ${cleanReason}`);
    } else if (act === 'tp' || act === 'teleport') {
      this.bot.chat(`/tp ${player}`);
    } else if (act === 'invsee') {
      this.bot.chat(`/invsee ${player}`);
    }
    return true;
  }

  // 9. Limpieza Silenciosa de Basura
  async manageInventoryAndStore() {
    const now = Date.now();
    if (now - this.lastInventoryCleanup < 30000) return false;
    this.lastInventoryCleanup = now;

    if (!this.bot || !this.bot.inventory) return false;

    const items = this.bot.inventory.items();
    if (items.length < INVENTORY_CLEANUP_THRESHOLD) return false;

    const trashItems = [
      'rotten_flesh', 'spider_eye', 'poisonous_potato', 'oak_sapling', 'spruce_sapling',
      'cherry_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling', 'feather',
      'string', 'white_wool'
    ];

    const trash = items.filter(item => trashItems.includes(item.name));
    if (trash.length === 0) return false;

    console.log('[INVENTORY] Limpieza silenciosa (' + items.length + '/36 slots, ' + trash.length + ' descartables)...');

    for (const item of trash) {
      try {
        await this.bot.toss(item.type, null, item.count);
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {}
    }

    return true;
  }
}

module.exports = { SaoriSkillsEngine, INVENTORY_CLEANUP_THRESHOLD };

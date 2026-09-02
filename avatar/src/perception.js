/**
 * Perception Engine · Sensores y Telemetría del Entorno 3D (0 Tokens)
 * Convierte el estado de Minecraft en representaciones estructuradas para el Cerebro IA
 */

function getPerceptionState(bot) {
  if (!bot || !bot.entity || !bot.entity.position) {
    return { ready: false, reason: 'Bot position not loaded' };
  }

  const pos = bot.entity.position;
  const health = bot.health;
  const food = bot.food;
  const dimension = bot.game ? bot.game.dimension : 'overworld';
  const timeOfDay = bot.time ? bot.time.timeOfDay : 0;
  const isDay = timeOfDay < 12000;

  // 1. Inventario clasificado
  const inventory = {
    items: [],
    tools: {},
    armor: {},
    foodCount: 0,
    materials: {}
  };

  if (bot.inventory) {
    for (const item of bot.inventory.items()) {
      inventory.items.push({ name: item.name, count: item.count, slot: item.slot });
      
      if (item.name.includes('_pickaxe') || item.name.includes('_axe') || item.name.includes('_sword') || item.name.includes('_shovel')) {
        const type = item.name.split('_')[1];
        inventory.tools[type] = item.name;
      }
      if (item.name.includes('_helmet') || item.name.includes('_chestplate') || item.name.includes('_leggings') || item.name.includes('_boots') || item.name.includes('shield')) {
        inventory.armor[item.name] = true;
      }
      if (['bread', 'cooked_beef', 'cooked_porkchop', 'golden_carrot', 'baked_potato', 'apple'].includes(item.name)) {
        inventory.foodCount += item.count;
      }
      if (item.name.includes('log') || item.name.includes('planks') || item.name.includes('stone') || item.name.includes('cobblestone') || item.name.includes('iron')) {
        inventory.materials[item.name] = (inventory.materials[item.name] || 0) + item.count;
      }
    }
  }

  // 2. Entorno cercano (bloques notables a 16 bloques)
  const nearbyBlocks = {
    trees: [],
    ores: [],
    craftingTables: [],
    furnaces: [],
    chests: [],
    waterNearby: false
  };

  try {
    const radius = 16;
    for (let x = -radius; x <= radius; x += 4) {
      for (let y = -4; y <= 6; y += 2) {
        for (let z = -radius; z <= radius; z += 4) {
          const b = bot.blockAt(pos.offset(x, y, z));
          if (!b || !b.name) continue;
          if (b.name.includes('log') && nearbyBlocks.trees.length < 5) {
            nearbyBlocks.trees.push({ name: b.name, pos: { x: b.position.x, y: b.position.y, z: b.position.z } });
          } else if ((b.name.includes('ore') || b.name === 'coal_block' || b.name === 'iron_block') && nearbyBlocks.ores.length < 5) {
            nearbyBlocks.ores.push({ name: b.name, pos: { x: b.position.x, y: b.position.y, z: b.position.z } });
          } else if (b.name === 'crafting_table' && nearbyBlocks.craftingTables.length < 2) {
            nearbyBlocks.craftingTables.push({ pos: { x: b.position.x, y: b.position.y, z: b.position.z } });
          } else if ((b.name === 'furnace' || b.name === 'blast_furnace') && nearbyBlocks.furnaces.length < 2) {
            nearbyBlocks.furnaces.push({ pos: { x: b.position.x, y: b.position.y, z: b.position.z } });
          } else if (b.name.includes('chest') && nearbyBlocks.chests.length < 3) {
            nearbyBlocks.chests.push({ pos: { x: b.position.x, y: b.position.y, z: b.position.z } });
          } else if (b.name === 'water') {
            nearbyBlocks.waterNearby = true;
          }
        }
      }
    }
  } catch (e) {}

  // 3. Entidades cercanas
  const nearbyEntities = {
    players: [],
    hostiles: [],
    animals: []
  };

  if (bot.entities) {
    for (const e of Object.values(bot.entities)) {
      if (!e || e.id === bot.entity.id || !e.position) continue;
      const dist = bot.entity.position.distanceTo(e.position);
      if (dist > 32) continue;

      if (e.type === 'player') {
        nearbyEntities.players.push({ username: e.username || e.displayName || 'Unknown', distance: Math.round(dist) });
      } else if (e.type === 'hostile' || ['zombie', 'skeleton', 'creeper', 'spider', 'witch', 'enderman', 'phantom'].includes(e.name)) {
        nearbyEntities.hostiles.push({ name: e.name, distance: Math.round(dist), pos: { x: Math.round(e.position.x), y: Math.round(e.position.y), z: Math.round(e.position.z) } });
      } else if (e.type === 'animal' || ['cow', 'sheep', 'pig', 'chicken'].includes(e.name)) {
        nearbyEntities.animals.push({ name: e.name, distance: Math.round(dist) });
      }
    }
  }

  return {
    ready: true,
    timestamp: Date.now(),
    status: {
      health,
      food,
      isDay,
      timeOfDay,
      dimension,
      position: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) }
    },
    inventory,
    nearbyBlocks,
    nearbyEntities
  };
}

module.exports = { getPerceptionState };

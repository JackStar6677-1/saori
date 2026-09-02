/**
 * Módulo de Supervivencia Físico, Movimiento Natural y Escalada de Bloques
 */
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const autoEat = require('mineflayer-auto-eat').plugin;

function equipGear(bot) {
  if (!bot || !bot.inventory) return;

  const items = bot.inventory.items();
  const armorSlots = [
    { name: 'helmet', slot: 'head', alt: 'cap' },
    { name: 'chestplate', slot: 'torso', alt: 'tunic' },
    { name: 'leggings', slot: 'legs', alt: 'pants' },
    { name: 'boots', slot: 'feet' },
    { name: 'shield', slot: 'off-hand' }
  ];

  for (const armor of armorSlots) {
    const item = items.find(i => 
      i.name.includes(armor.name) || (armor.alt && i.name.includes(armor.alt))
    );
    if (item) {
      if (item.enchants && !Array.isArray(item.enchants)) item.enchants = [];
      bot.equip(item, armor.slot).catch(() => {});
    }
  }

  // La mano principal pertenece a la habilidad activa. Equipar una espada en
  // este temporizador interrumpia la tala/mineria cada dos segundos.
}

function setupSurvival(bot, config) {
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(autoEat);

  bot.on('spawn', () => {
    console.log('[SURVIVAL] Configurando navegacion fluida y superacion de obstaculos.');

    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    
    // Patrullar nunca debe alterar el mapa para salir de un atasco. Las
    // habilidades de recoleccion excavan de forma explicita y auditada.
    defaultMove.canDig = false;
    defaultMove.allowParkour = true; // Permite subir desniveles de 1 bloque y escalones
    defaultMove.allow1by1towers = false;
    defaultMove.allowFreeMotion = true;
    defaultMove.maxDropDown = 4;
    defaultMove.digCost = 100;
    
    // Las hojas no son terreno fiable: se evitan en vez de romperlas o
    // intentar atravesarlas indefinidamente.
    const avoidBlocks = [
      'birch_leaves', 'oak_leaves', 'spruce_leaves', 'jungle_leaves',
      'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves', 'azalea_leaves'
    ];
    for (const b of avoidBlocks) {
      if (mcData.blocksByName[b]) {
        defaultMove.blocksToAvoid.add(mcData.blocksByName[b].id);
      }
    }

    bot.pathfinder.setMovements(defaultMove);

    if (bot.autoEat) {
      bot.autoEat.options = {
        priority: 'foodPoints',
        startAt: 14,
        bannedFood: ['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish']
      };
    }

    setInterval(() => {
      equipGear(bot);
    }, 2000);
  });
}

module.exports = { setupSurvival, equipGear };

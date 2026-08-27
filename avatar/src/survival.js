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

  const sword = items.find(i => i.name.includes('sword'));
  if (sword && (!bot.heldItem || !bot.heldItem.name.includes('sword') && !bot.heldItem.name.includes('pickaxe') && !bot.heldItem.name.includes('axe'))) {
    if (sword.enchants && !Array.isArray(sword.enchants)) sword.enchants = [];
    bot.equip(sword, 'hand').catch(() => {});
  }
}

function setupSurvival(bot, config) {
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(autoEat);

  bot.on('spawn', () => {
    console.log('[SURVIVAL] Configurando navegacion fluida y superacion de obstaculos.');

    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    
    defaultMove.canDig = true;
    defaultMove.allowParkour = true; // Permite subir desniveles de 1 bloque y escalones
    defaultMove.allow1by1towers = false;
    defaultMove.allowFreeMotion = true;
    defaultMove.maxDropDown = 4;
    defaultMove.digCost = 4; // Costo bajo para romper hojas u obstaculos que tapen el paso
    
    // Tratamiento de hojas y nieve: transitables o rompibles
    const clearBlocks = [
      'birch_leaves', 'oak_leaves', 'spruce_leaves', 'jungle_leaves',
      'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves', 'azalea_leaves',
      'snow', 'tall_grass', 'grass', 'fern', 'dandelion', 'poppy', 'short_grass'
    ];
    for (const b of clearBlocks) {
      if (mcData.blocksByName[b]) {
        defaultMove.blocksToAvoid.delete(mcData.blocksByName[b].id);
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

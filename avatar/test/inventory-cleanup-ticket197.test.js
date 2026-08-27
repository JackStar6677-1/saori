const { SaoriSkillsEngine, INVENTORY_CLEANUP_THRESHOLD } = require('../src/skills');

function mkBot(names) {
  const items = names.map((n, i) => ({ name: n, type: 100 + i, count: 1, slot: 9 + i }));
  return { tossed: [], inventory: { items: () => items },
           toss(type){ this.tossed.push(type); return Promise.resolve(); } };
}
function engine(bot){ const e = Object.create(SaoriSkillsEngine.prototype); e.bot = bot; e.lastInventoryCleanup = 0; return e; }

let logs = [];
const realLog = console.log;
console.log = (...a) => logs.push(a.join(' '));

(async () => {
  let fails = 0;
  // Caso real del ticket 197: 29 slots de material valioso, cero basura.
  const valiosos = ['stick','end_rod','enchanted_book','cherry_planks','copper_block','purpur_stairs',
    'written_book','torch','end_stone_brick_wall','cooked_beef','golden_carrot','purpur_block',
    'purpur_pillar','end_stone','end_stone_bricks','cocoa_beans','diamond','iron_ingot','coal',
    'bread','apple','oak_log','stone','sand','glass','bucket','shears','bone','emerald'];
  let bot = mkBot(valiosos); let e = engine(bot);
  logs = [];
  let r = await e.manageInventoryAndStore();
  if (r !== false) { realLog('FALLO: deberia retornar false sin basura, retorno', r); fails++; }
  if (logs.length !== 0) { realLog('FALLO: no debe loguear sin basura ->', logs); fails++; }
  if (bot.tossed.length !== 0) { realLog('FALLO: no debe tirar nada'); fails++; }

  // Con basura real presente si limpia y anuncia.
  const conBasura = valiosos.slice(0, 27).concat(['rotten_flesh', 'string']);
  bot = mkBot(conBasura); e = engine(bot);
  logs = [];
  r = await e.manageInventoryAndStore();
  if (r !== true) { realLog('FALLO: deberia retornar true con basura, retorno', r); fails++; }
  if (bot.tossed.length !== 2) { realLog('FALLO: deberia tirar 2 items, tiro', bot.tossed.length); fails++; }
  if (logs.length !== 1 || !logs[0].includes('2 descartables')) { realLog('FALLO: log esperado ->', logs); fails++; }

  // Bajo el umbral no hace nada.
  bot = mkBot(valiosos.slice(0, INVENTORY_CLEANUP_THRESHOLD - 1)); e = engine(bot);
  logs = [];
  r = await e.manageInventoryAndStore();
  if (r !== false) { realLog('FALLO: bajo umbral debe retornar false'); fails++; }
  if (logs.length !== 0) { realLog('FALLO: bajo umbral no debe loguear'); fails++; }

  console.log = realLog;
  console.log(fails === 0 ? 'TODAS LAS PRUEBAS OK (3 escenarios)' : `${fails} FALLOS`);
  process.exit(fails === 0 ? 0 : 1);
})();

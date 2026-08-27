/**
 * Curriculum Engine · Árbol de Conocimiento y Progresión para SaoriStar
 * Define fases, metas y verificaciones de progreso autónomo
 */

const CURRICULUM_PHASES = [
  {
    id: 'PHASE_1_BASIC_WOOD',
    title: 'Recolección Básica de Madera',
    description: 'Obtener al menos 8 bloques de madera para herramientas iniciales',
    check: (inv) => (inv.materials['oak_log'] || 0) + (inv.materials['birch_log'] || 0) + (inv.materials['spruce_log'] || 0) + (inv.materials['jungle_log'] || 0) >= 8 || Object.keys(inv.tools).length >= 2,
    recommendedSkill: 'gather',
    args: { target: 'log', count: 8 }
  },
  {
    id: 'PHASE_2_STONE_AGE',
    title: 'Edad de Piedra y Hornos',
    description: 'Conseguir piedra/adoquín y fabricar herramientas de piedra',
    check: (inv) => (inv.materials['cobblestone'] || 0) >= 16 || inv.tools['pickaxe']?.includes('diamond') || inv.tools['pickaxe']?.includes('iron'),
    recommendedSkill: 'gather',
    args: { target: 'stone', count: 16 }
  },
  {
    id: 'PHASE_3_SETTLEMENT_PROTECTION',
    title: 'Asentamiento y Fundación de Polis',
    description: 'Asegurar terreno con protección /ps y colocar baúl de suministros',
    check: (state) => state.nearbyBlocks?.chests?.length > 0 || state.status?.position?.y >= 60,
    recommendedSkill: 'shelter',
    args: { type: 'camp' }
  },
  {
    id: 'PHASE_4_SLIMEFUN_FOUNDATIONS',
    title: 'Iniciación en Slimefun',
    description: 'Explorar árbol tecnológico de Slimefun (/sf guide) y recolectar componentes',
    check: (inv) => Object.keys(inv.materials).some(m => m.includes('copper') || m.includes('amethyst') || m.includes('quartz')),
    recommendedSkill: 'slimefun',
    args: { tech: 'basic_machines' }
  },
  {
    id: 'PHASE_5_ATHENA_TEMPLE',
    title: 'Construcción del Templo de Atenea',
    description: 'Edificación del templo griego en honor a Atenea en DrakesCraft',
    check: (state) => false, // Meta continua de gran escala
    recommendedSkill: 'build',
    args: { structure: 'athena_columns' }
  }
];

function evaluateCurrentCurriculum(perception) {
  if (!perception || !perception.inventory) return null;

  for (const phase of CURRICULUM_PHASES) {
    const isCompleted = phase.check(perception.inventory, perception);
    if (!isCompleted) {
      return {
        currentPhase: phase,
        completed: false
      };
    }
  }

  return {
    currentPhase: CURRICULUM_PHASES[CURRICULUM_PHASES.length - 1],
    completed: true
  };
}

module.exports = { CURRICULUM_PHASES, evaluateCurrentCurriculum };

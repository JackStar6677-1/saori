/**
 * Módulo de Moderación y Defensa Escalonada (Modos: Serena, Centinela y Diosa Agresiva)
 */
function setupModeration(bot, config) {
  bot.on('messagestr', (message) => {
    // Monitoreo pasivo de anomalías del servidor
  });
}

function handleEmergencyContainment(bot, targetPlayer, reason) {
  console.log('[MODERATION] Modo Diosa / Contencion activado para:', targetPlayer, reason);
  bot.chat('/saorifreeze ' + targetPlayer);
  bot.chat('/tempban ' + targetPlayer + ' 30m [Atenea] Contencion preventiva de seguridad');
}

module.exports = { setupModeration, handleEmergencyContainment };

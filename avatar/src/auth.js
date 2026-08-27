/**
 * Módulo de Autenticación Blindado (nLogin)
 * Previene spam de /login o ejecuciones repetidas ante cambios de mundo/teletransporte.
 */
function setupAuth(bot, config) {
  let loggedIn = false;
  let loginAttempted = false;

  bot.on('message', (jsonMsg) => {
    try {
      const rawText = jsonMsg ? jsonMsg.toString() : '';

      if (!loggedIn && !loginAttempted) {
        const lower = rawText.toLowerCase();
        if (lower.includes('/login') || lower.includes('inicia sesion') || lower.includes('inicia sesión') || lower.includes('contraseña')) {
          loginAttempted = true;
          console.log('[AUTH] Enviando comando /login...');
          bot.chat('/login ' + config.password);
        }
      }

      if (rawText.includes('autenticado') || rawText.includes('sesion iniciada') || rawText.includes('éxito al iniciar sesión') || rawText.includes('has iniciado') || rawText.includes('Ya estás conectado')) {
        loggedIn = true;
        loginAttempted = true;
        console.log('[AUTH] Autenticación completada con éxito.');
        setTimeout(() => {
          if (config.skin_url) {
            bot.chat('/skin url ' + config.skin_url);
          }
        }, 3000);
      }
    } catch (e) {}
  });

  bot.on('spawn', () => {
    if (!loggedIn && !loginAttempted) {
      loginAttempted = true;
      console.log('[AUTH] Spawn inicial detectado. Ejecutando login único...');
      setTimeout(() => {
        if (!loggedIn) bot.chat('/login ' + config.password);
      }, 1000);
    }
  });

  bot.on('end', () => {
    loggedIn = false;
    loginAttempted = false;
  });
}

module.exports = { setupAuth };

/**
 * Identidad y autoridad de SaoriStar (Diosa Atenea) — Ticket 186.
 *
 * El nick NO autentica a nadie. Un jugador puede llamarse "Jackito" o
 * "blackjack" y antes obtenia, solo por eso, exencion del filtro
 * anti-inyeccion, exencion del rate-limit y ejecucion de acciones fisicas.
 *
 * La unica fuente de autoridad es el UUID que el servidor anuncia en la lista
 * de jugadores (bot.players[nick].uuid), que viaja por el protocolo y no por el
 * texto del chat, contrastado contra una allowlist exacta de configuracion.
 * Deny-by-default: sin allowlist configurada, nadie manda.
 */

function normalizarUuid(valor) {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim().toLowerCase().replace(/-/g, '');
  return /^[0-9a-f]{32}$/.test(limpio) ? limpio : null;
}

/**
 * Allowlist exacta de UUID con autoridad. Acepta `authorized_uuids` (lista) y
 * el `jack_uuid` heredado. Las entradas invalidas se descartan en silencio para
 * que un config a medio llenar no conceda autoridad accidental.
 */
function cargarAllowlist(config) {
  const crudos = [];
  if (config && Array.isArray(config.authorized_uuids)) {
    crudos.push(...config.authorized_uuids);
  }
  if (config && config.jack_uuid) {
    crudos.push(config.jack_uuid);
  }
  const validos = crudos.map(normalizarUuid).filter(Boolean);
  return new Set(validos);
}

/**
 * UUID real del emisor segun la lista de jugadores del servidor. Devuelve null
 * si el nick no corresponde a nadie conectado: un mensaje sintetico (consola,
 * tellraw, plugin que imita el formato de chat) nunca resuelve UUID y por tanto
 * nunca obtiene autoridad.
 */
function uuidDeJugador(bot, username) {
  if (!bot || !bot.players || typeof username !== 'string') return null;
  const registro = bot.players[username];
  if (!registro) return null;
  return normalizarUuid(registro.uuid);
}

/**
 * Unica funcion que decide si un mensaje viene de una autoridad reconocida.
 * No mira el texto, no mira el nick: solo el UUID del protocolo.
 */
function esAutoridad(bot, username, config) {
  const allowlist = cargarAllowlist(config);
  if (allowlist.size === 0) return false;
  const uuid = uuidDeJugador(bot, username);
  if (!uuid) return false;
  return allowlist.has(uuid);
}

module.exports = { normalizarUuid, cargarAllowlist, uuidDeJugador, esAutoridad };

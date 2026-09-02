const test = require('node:test');
const assert = require('node:assert/strict');

const { esRespuestaEmitible, primeraLineaUtil } = require('../src/chat');

// Evidencia literal del ticket 210: lo que Atenea publico tres veces en el
// chat publico del Survival ante preguntas de un jugador.
const EVIDENCIA = "Youve hit your weekly limit · resets Aug 30, 7am (UTC)";

test('el mensaje de cuota del proveedor no es emitible', () => {
  assert.equal(esRespuestaEmitible(EVIDENCIA), false);
});

test('variantes del error de proveedor tampoco salen al chat', () => {
  for (const mal of [
    "You've hit your session limit, upgrade your subscription",
    'API Error: Internal server error',
    '{"type":"overloaded_error"}',
    'Traceback (most recent call last):',
    'authentication_error: invalid api key',
    'Usage limit reached. Purchase more credits.'
  ]) {
    assert.equal(esRespuestaEmitible(mal), false, mal);
  }
});

test('las frases propias de Atenea siguen pasando', () => {
  for (const buena of [
    'Usa /sf guide para abrir la guia de Slimefun, joven.',
    'Tu proteccion se reclama con /ps create, con calma.',
    'La tienda y las guias viven en web.drakescraft.cl.'
  ]) {
    assert.equal(esRespuestaEmitible(buena), true, buena);
  }
});

test('el vacio y el ruido corto se descartan', () => {
  assert.equal(esRespuestaEmitible(''), false);
  assert.equal(esRespuestaEmitible(null), false);
  assert.equal(esRespuestaEmitible('ok'), false);
});

test('el fallback CLI publica solo la primera linea util', () => {
  assert.equal(primeraLineaUtil('\n\nSaludos, mortal.\nWARN: algo interno\n'),
    'Saludos, mortal.');
  assert.equal(primeraLineaUtil(''), '');
  assert.equal(primeraLineaUtil(null), '');
});

// El filtro tiene que resistir el texto acentuado o normalizado en NFD.
test('la comparacion ignora tildes y mayusculas', () => {
  assert.equal(esRespuestaEmitible('WEEKLY LIMIT alcanzado'), false);
  assert.equal(esRespuestaEmitible('Rate Limit excedido'.normalize('NFD')), false);
});

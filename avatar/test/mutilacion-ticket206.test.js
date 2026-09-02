const test = require('node:test');
const assert = require('node:assert');

const { cleanText } = require('../src/chat.js');

// Regresion del ticket 206: durante unos minutos el filtro de emojis borro
// mayusculas, digitos y la letra 'f' de las respuestas de Atenea, que salieron
// al chat publico como 'cudiendo a tu presencia de inmediato, ack'.
const FRASES_DEL_INCIDENTE = [
  'Acudiendo a tu presencia de inmediato, Jack.',
  'Mr_Em1lio, mandame la solicitud de teletransporte.',
  'Como deidad de DrakesCraft, prefiero guiar vuestras batallas.',
  'Mi senor Jack, Hermes recorre los confines de DrakesCraft.'
];

test('no mutila ninguna de las frases del incidente', () => {
  for (const frase of FRASES_DEL_INCIDENTE) {
    assert.strictEqual(cleanText(frase), frase);
  }
});

test('conserva todas las mayusculas y digitos ASCII', () => {
  const frase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789 abcdefghijklmnopqrstuvwxyz';
  assert.strictEqual(cleanText(frase), frase);
});

test('sigue eliminando emojis mientras protege el texto', () => {
  assert.strictEqual(cleanText('Jack ⚡ DrakesCraft 😀'), 'Jack DrakesCraft');
});

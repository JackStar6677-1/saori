const test = require('node:test');
const assert = require('node:assert');

const { cleanText } = require('../src/chat.js');

// Regresion del ticket 205: el rango ☀-➿ estaba fuera de los
// corchetes, asi que los emojis y dingbats llegaban intactos al chat pese a
// la directiva de cero emojis de Atenea.
test('elimina emojis del plano suplementario', () => {
  assert.strictEqual(cleanText('Salve viajero 😀🌟'), 'Salve viajero');
});

test('elimina dingbats y simbolos misceláneos del plano basico', () => {
  assert.strictEqual(cleanText('Salve ⚡ viajero ✦ ☀'), 'Salve viajero');
  assert.strictEqual(cleanText('Atencion ⚠️ guardiana'), 'Atencion guardiana');
});

test('conserva intactos los acentos, la enye y la puntuacion', () => {
  const frase = 'Avanza con sabiduría, Mr_Em1lio; el año del señor ¡DrakesCraft!';
  assert.strictEqual(cleanText(frase), frase);
});

test('tolera entradas vacias o nulas', () => {
  assert.strictEqual(cleanText(''), '');
  assert.strictEqual(cleanText(null), '');
  assert.strictEqual(cleanText(undefined), '');
});

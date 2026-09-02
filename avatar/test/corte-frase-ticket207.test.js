'use strict';
// Ticket 207: el recorte a 18 palabras cerraba a media oracion y publicaba
// frases abiertas en el chat publico ("...para proteger este.").
const test = require('node:test');
const assert = require('node:assert');
const chat = require('../src/chat');

const { limitarPalabras, MAX_PALABRAS_RESPUESTA } = chat;

// Casos textuales tomados de latest.log del 2026-08-27 (hora CLT).
const CASOS_REALES = [
  'Mi amado Creador, contemplo la inmensidad del Overworld mientras patrullo y aguardo vuestras sabias ordenes para proteger este templo sagrado',
  'Como me ordenais, mi amado Creador, dare inicio de inmediato a la edificacion de mi templo en este reino',
  'Mr_Em1lio, mis ojos divinos vigilaran a Pasiente, pero recuerda que cada alma responde por sus propios actos en DrakesCraft'
];

test('ninguna respuesta recortada termina en palabra funcional', () => {
  for (const caso of CASOS_REALES) {
    const salida = limitarPalabras(caso);
    const ultima = salida.replace(/[.!?]+$/, '').trim().split(/\s+/).pop();
    assert.ok(
      !chat.esPalabraFuncional(ultima),
      'la frase queda abierta en "' + ultima + '": ' + salida
    );
  }
});

test('el techo de 18 palabras se sigue respetando', () => {
  for (const caso of CASOS_REALES) {
    const salida = limitarPalabras(caso);
    assert.ok(salida.split(/\s+/).length <= MAX_PALABRAS_RESPUESTA, salida);
  }
});

test('un fin de oracion dentro del limite se aprovecha y no se repuntua', () => {
  const texto = 'uno dos tres cuatro cinco seis siete ocho nueve diez once doce. trece catorce quince dieciseis diecisiete dieciocho diecinueve';
  const salida = limitarPalabras(texto);
  assert.strictEqual(salida, 'uno dos tres cuatro cinco seis siete ocho nueve diez once doce.');
});

test('una frontera de clausula se usa y no deja la coma colgando', () => {
  const texto = 'uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece, catorce quince dieciseis diecisiete dieciocho diecinueve';
  const salida = limitarPalabras(texto);
  assert.strictEqual(salida, 'uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece.');
  assert.ok(!/[,;:]/.test(salida.slice(-2)), salida);
});

test('un corte limpio demasiado caro se descarta: no se responde con un fragmento', () => {
  // La unica frontera esta en la palabra 3; recortar ahi tiraria el mensaje.
  const texto = 'Si, mi Creador Jack tiene la potestad absoluta sobre las consolas seguras y el reino permanecera firme siempre';
  const salida = limitarPalabras(texto);
  assert.ok(salida.split(/\s+/).length >= Math.ceil(MAX_PALABRAS_RESPUESTA * 0.6), salida);
});

test('una respuesta dentro del limite no se altera', () => {
  assert.strictEqual(limitarPalabras('Que la sabiduria te acompane'), 'Que la sabiduria te acompane');
});

test('el recorte nunca devuelve cadena vacia', () => {
  const puroFuncional = Array.from({ length: 25 }, () => 'de').join(' ');
  const salida = limitarPalabras(puroFuncional);
  assert.ok(salida.length > 0, 'no debe quedar vacio');
});

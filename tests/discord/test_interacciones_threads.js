const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', '..', 'integrations', 'discord', 'index.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const start = source.indexOf('function buildInteractionThreadName(message) {');
const end = source.indexOf('\n}\n', start) + 2;

assert.ok(start >= 0 && end > start, 'no se encontro buildInteractionThreadName en index.js');

const context = {};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

function message(content, attachmentCount = 0) {
    return {
        content,
        attachments: { size: attachmentCount },
        author: { username: 'Jugador' }
    };
}

assert.strictEqual(
    context.buildInteractionThreadName(message('Contrato terraplanistas')),
    'Hilo: Contrato terraplanistas'
);
assert.strictEqual(
    context.buildInteractionThreadName(message('', 1)),
    'Hilo: Publicacion de Jugador'
);
assert.strictEqual(
    context.buildInteractionThreadName(message('Hola <@123456789>\nDetalle')),
    'Hilo: Hola'
);
assert.ok(
    context.buildInteractionThreadName(message('x'.repeat(160))).length <= 100,
    'el nombre del hilo debe respetar el limite de Discord'
);
assert.match(
    source,
    /if \(!message\.channel\.isThread\(\) && !message\.webhookId\)/,
    'solo los mensajes humanos del canal raiz deben abrir hilos'
);
assert.match(
    source,
    /if \(!message\.hasThread\)/,
    'no debe intentar duplicar un hilo existente'
);

console.log('Auto-hilos de Interacciones: todas las pruebas pasaron.');

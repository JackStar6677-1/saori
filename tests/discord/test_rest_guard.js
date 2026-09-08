// Pruebas del blindaje de la API REST interna (ticket #366).
// Extrae del index.js real el bloque de guardas y lo evalua en un contexto
// aislado: se prueba el codigo publicado, no una copia.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

const SRC = path.join(__dirname, '..', '..', 'integrations', 'discord', 'index.js');
const src = fs.readFileSync(SRC, 'utf8');

const desde = src.indexOf('const REST_AUTH_TOKEN =');
const hasta = src.indexOf('function startDiscordRestApiServer(client) {');
assert.ok(desde > 0 && hasta > desde, 'no se localizo el bloque de blindaje en index.js');

const TOKEN = 'a'.repeat(64);
const contexto = { crypto, console, Date, Number, Map, parseInt, String,
    process: { env: { SAORI_REST_TOKEN: TOKEN } } };
vm.createContext(contexto);
vm.runInContext(src.slice(desde, hasta), contexto);

let fallos = 0;
function prueba(nombre, fn) {
    try { fn(); console.log(`  ok  ${nombre}`); }
    catch (e) { fallos++; console.error(`  FALLA ${nombre}: ${e.message}`); }
}

console.log('Blindaje REST (#366):');

prueba('loopback permitido', () => assert.strictEqual(contexto.restOriginAllowed('127.0.0.1'), true));
prueba('IPv6 loopback permitido', () => assert.strictEqual(contexto.restOriginAllowed('::1'), true));
prueba('tailnet permitida', () => assert.strictEqual(contexto.restOriginAllowed('100.110.230.7'), true));
prueba('docker bridge permitido', () => assert.strictEqual(contexto.restOriginAllowed('172.19.0.5'), true));
prueba('IP publica rechazada', () => assert.strictEqual(contexto.restOriginAllowed('8.8.8.8'), false));
prueba('IP publica limitrofe rechazada', () => assert.strictEqual(contexto.restOriginAllowed('100.128.0.1'), false));
prueba('origen vacio rechazado', () => assert.strictEqual(contexto.restOriginAllowed(''), false));
prueba('mapeo IPv4 sobre IPv6 se normaliza', () =>
    assert.strictEqual(contexto.restOriginAllowed(contexto.restNormalizeIp('::ffff:127.0.0.1')), true));
prueba('octeto invalido no pasa como red permitida', () =>
    assert.strictEqual(contexto.restOriginAllowed('127.0.0.999'), false));

prueba('token correcto en Bearer', () =>
    assert.strictEqual(contexto.restTokenValid({ headers: { authorization: `Bearer ${TOKEN}` } }), true));
prueba('token correcto en X-Saori-Token', () =>
    assert.strictEqual(contexto.restTokenValid({ headers: { 'x-saori-token': TOKEN } }), true));
prueba('token ausente rechazado', () =>
    assert.strictEqual(contexto.restTokenValid({ headers: {} }), false));
prueba('token erroneo rechazado', () =>
    assert.strictEqual(contexto.restTokenValid({ headers: { authorization: 'Bearer ' + 'b'.repeat(64) } }), false));
prueba('prefijo correcto pero truncado rechazado', () =>
    assert.strictEqual(contexto.restTokenValid({ headers: { authorization: 'Bearer ' + 'a'.repeat(63) } }), false));
prueba('token de longitud distinta no lanza excepcion', () =>
    assert.strictEqual(contexto.restTokenValid({ headers: { authorization: 'Bearer x' } }), false));
prueba('esquema Bearer insensible a mayusculas', () =>
    assert.strictEqual(contexto.restTokenValid({ headers: { authorization: `bearer ${TOKEN}` } }), true));

prueba('escritura corta a las 20 peticiones', () => {
    const ip = '10.9.9.1';
    for (let i = 0; i < 20; i++) {
        assert.strictEqual(contexto.restRateLimited(ip, true), false, `corto en la peticion ${i + 1}`);
    }
    assert.strictEqual(contexto.restRateLimited(ip, true), true, 'no corto en la 21');
});
prueba('lectura y escritura llevan cubos separados', () => {
    const ip = '10.9.9.2';
    for (let i = 0; i < 21; i++) contexto.restRateLimited(ip, true);
    assert.strictEqual(contexto.restRateLimited(ip, false), false);
});
prueba('cada IP lleva su propio cubo', () => {
    const a = '10.9.9.3';
    for (let i = 0; i < 21; i++) contexto.restRateLimited(a, true);
    assert.strictEqual(contexto.restRateLimited('10.9.9.4', true), false);
});

// Fail-closed: sin token configurado la API no debe autenticar a nadie.
const ctxSinToken = { crypto, console, Date, Number, Map, parseInt, String, process: { env: {} } };
vm.createContext(ctxSinToken);
vm.runInContext(src.slice(desde, hasta), ctxSinToken);
prueba('sin SAORI_REST_TOKEN nadie autentica (fail-closed)', () => {
    // Sin token en el entorno, ninguna credencial presentada puede validar.
    assert.strictEqual(ctxSinToken.restTokenValid({ headers: { authorization: `Bearer ${TOKEN}` } }), false);
    assert.strictEqual(ctxSinToken.restTokenValid({ headers: { authorization: 'Bearer ' } }), false);
    assert.strictEqual(ctxSinToken.restTokenValid({ headers: {} }), false);
});

console.log(fallos === 0 ? '\nTodas las pruebas pasaron.' : `\n${fallos} prueba(s) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);

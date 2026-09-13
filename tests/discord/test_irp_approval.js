// Pruebas del vale de restauracion IRP de un solo uso (tickets #350 y QA #361).
// Igual que test_rest_guard.js, se extrae del index.js real el bloque de estado
// y se evalua en un contexto aislado: se prueba el codigo publicado.
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

const SRC = path.join(__dirname, '..', '..', 'integrations', 'discord', 'index.js');
const src = fs.readFileSync(SRC, 'utf8');

const desde = src.indexOf('const pendingIrpApprovalRequests = new Map();');
const hasta = src.indexOf('// ── Blindaje de la API REST interna');
assert.ok(desde > 0 && hasta > desde, 'no se localizo el bloque de solicitudes IRP en index.js');
// Las declaraciones `const` del bloque no se publican como globales del contexto
// (solo las `function`), asi que se anade un epilogo que las expone tal cual son.
const bloque = src.slice(desde, hasta) + `
this.__valores = { pendingIrpApprovalRequests, IRP_CASE_ID_REGEX, IRP_PLAYER_REGEX, IRP_BACKUP_ID_REGEX };
`;

const estadoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'irp-approval-'));
const estadoFile = path.join(estadoDir, 'irp-approval-requests.json');

function nuevoContexto(env = {}) {
    const ctx = {
        crypto, fs, console, Date, Number, Map, Array, JSON, parseInt, String, Math,
        __dirname: estadoDir,
        process: { env: Object.assign({ SAORI_IRP_APPROVAL_STATE: estadoFile }, env) }
    };
    vm.createContext(ctx);
    vm.runInContext(bloque, ctx);
    return Object.assign(ctx, ctx.__valores);
}

let fallos = 0;
function prueba(nombre, fn) {
    try { fn(); console.log(`  ok  ${nombre}`); }
    catch (e) { fallos++; console.error(`  FALLA ${nombre}: ${e.message}`); }
}

console.log('Vale de restauracion IRP (#350/#361):');

const ctx = nuevoContexto();

prueba('el nonce no sale de Math.random y no es adivinable', () => {
    const vistos = new Set();
    for (let i = 0; i < 500; i++) {
        const n = ctx.irpNewApprovalNonce();
        assert.match(n, /^[0-9a-f]{48}$/, `nonce con formato inesperado: ${n}`);
        assert.ok(!vistos.has(n), 'nonce repetido');
        vistos.add(n);
    }
});

prueba('el customId legacy jugador:backup ya no resuelve ningun vale', () => {
    // La rama de compatibilidad permitia despachar irp restore --force sin vale,
    // sin caducidad y tantas veces como se pulsara el boton.
    assert.ok(!/tokenOrPayload\.includes\(':'\)/.test(src), 'la rama legacy sigue presente en index.js');
    assert.strictEqual(ctx.pendingIrpApprovalRequests.get('Pasiente:latest'), undefined);
});

prueba('un vale caducado se detecta por expiresAt y no se purga en silencio', () => {
    const ahora = Date.now();
    ctx.pendingIrpApprovalRequests.set('caducado', {
        nonce: 'caducado', player: 'Pasiente', backupId: 'latest',
        caseId: '336', createdAt: ahora - 90000000, expiresAt: ahora - 1000, status: 'PENDING'
    });
    ctx.purgeIrpApprovalRequests();
    const vale = ctx.pendingIrpApprovalRequests.get('caducado');
    assert.ok(vale, 'un PENDING caducado debe conservarse para responder "caducada"');
    assert.ok(Date.now() > vale.expiresAt, 'el vale deberia estar caducado');
});

prueba('un vale resuelto y antiguo si se descarta', () => {
    ctx.pendingIrpApprovalRequests.set('viejo', {
        nonce: 'viejo', player: 'Pasiente', backupId: 'latest', caseId: '336',
        createdAt: 1, decidedAt: 1, status: 'REJECTED'
    });
    ctx.purgeIrpApprovalRequests();
    assert.strictEqual(ctx.pendingIrpApprovalRequests.get('viejo'), undefined);
});

prueba('el estado sobrevive a un reinicio del bot', () => {
    const nonce = ctx.irpNewApprovalNonce();
    ctx.pendingIrpApprovalRequests.set(nonce, {
        nonce, player: '.Pasiente8934', backupId: '3', modality: 'clasico',
        caseId: '336', evidence: 'delta IRP', createdAt: Date.now(),
        expiresAt: Date.now() + 3600000, status: 'PENDING'
    });
    ctx.saveIrpApprovalRequests();

    const ctx2 = nuevoContexto();
    const recuperado = ctx2.pendingIrpApprovalRequests.get(nonce);
    assert.ok(recuperado, 'el vale no se recupero de disco');
    assert.strictEqual(recuperado.player, '.Pasiente8934');
    assert.strictEqual(recuperado.caseId, '336');
    assert.strictEqual(recuperado.status, 'PENDING');
});

prueba('el fichero de estado no queda legible para otros usuarios', () => {
    const modo = fs.statSync(estadoFile).mode & 0o777;
    assert.strictEqual(modo, 0o600, `modo inesperado: ${modo.toString(8)}`);
});

prueba('el caso solo admite identificadores acotados', () => {
    assert.ok(ctx.IRP_CASE_ID_REGEX.test('336'));
    assert.ok(ctx.IRP_CASE_ID_REGEX.test('TICKET-336'));
    assert.ok(!ctx.IRP_CASE_ID_REGEX.test(''));
    assert.ok(!ctx.IRP_CASE_ID_REGEX.test('336 && say hola'));
    assert.ok(!ctx.IRP_CASE_ID_REGEX.test('a'.repeat(65)));
});

prueba('el jugador y el backup siguen acotados contra inyeccion de consola', () => {
    assert.ok(ctx.IRP_PLAYER_REGEX.test('.Pasiente8934'), 'nick Floodgate valido');
    assert.ok(!ctx.IRP_PLAYER_REGEX.test('Pasiente op'), 'un espacio abre un segundo argumento');
    assert.ok(!ctx.IRP_BACKUP_ID_REGEX.test('latest --ender'), 'no debe colarse otra bandera');
});

// El despacho verificado y la puerta de Jack no son funciones aisladas: se
// comprueban sobre el texto publicado del manejador de botones.
prueba('la decision no pasa a APPROVED antes de confirmar el despacho', () => {
    assert.ok(/requestData\.status = 'DISPATCHING';/.test(src), 'falta el estado intermedio DISPATCHING');
    assert.ok(/requestData\.status = ok \? 'APPROVED' : 'PENDING';/.test(src),
        'el estado final debe depender del resultado del despacho');
});

prueba('solo Jack decide: el nivel OWNER de Discord no basta', () => {
    assert.ok(/if \(interaction\.user\.id !== JACK_DISCORD_ID\) \{/.test(src),
        'la puerta debe comparar contra JACK_DISCORD_ID');
    assert.ok(!/hierarchy\.level < STAFF_LEVELS\.OWNER/.test(src.slice(
        src.indexOf("id.startsWith('btn_irp_approve_')"),
        src.indexOf("// BOTONES DE SHELPSTAFF"))),
        'el manejador IRP no debe aceptar el rango OWNER como equivalente a Jack');
});

fs.rmSync(estadoDir, { recursive: true, force: true });

console.log(fallos === 0 ? '\nTodas las pruebas pasaron.' : `\n${fallos} prueba(s) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);

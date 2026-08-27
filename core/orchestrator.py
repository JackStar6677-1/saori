#!/usr/bin/env python3
"""
SAORI — orquestador tecnico y de seguridad de DrakesCraft.

Coordina a claude-code, codex y antigravity sobre una unica cola de trabajo para
que ninguno duplique esfuerzo ni pise los cambios de otro. Sustituye la exclusion
global de `coordinar_agentes.py` por bloqueos por recurso, de modo que dos agentes
puedan trabajar a la vez mientras no toquen lo mismo.

    python3 saori_orchestrador.py estado --json
    python3 saori_orchestrador.py crear-ticket --titulo "..." --categoria error ...
    python3 saori_orchestrador.py reclamar --agente claude-code --ticket 12

Por que SQLite y no un JSON compartido: tres procesos escribiendo un JSON se
pisan sin remedio, y el fallo se ve como trabajo duplicado mucho despues. SQLite
en WAL da transacciones reales y un `UPDATE ... WHERE status='TRIAGED'` que solo
puede ganar un agente.

TODO lo que pueda sancionar, anunciar en publico o tocar produccion nace apagado.
La fase la sube Jack a mano; el codigo nunca se auto-promociona.
"""

import argparse
import hashlib
import json
import os
import re
import secrets
import sqlite3
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

# ─────────────────────────────── rutas y constantes ───────────────────────────

HUB = Path.home() / "ai-hub"
ESTADO_DIR = Path.home() / ".local/state/nova"
BD = ESTADO_DIR / "drakescraft-orchestrator.db"
CONFIG = Path.home() / ".config/nova/saori.json"
CONTROL_ANTIGUO = ESTADO_DIR / "agent-control.json"
CONTROL_SERVIDOR = HUB / "scripts/control_drakescraft.py"
LOTE_CANONICO = HUB / "scripts/saori_lote.py"

AGENTES = ("claude-code", "codex", "antigravity")

ESQUEMA_VERSION = 3

ESTADOS_TICKET = ("DETECTED", "TRIAGED", "CLAIMED", "INVESTIGATING", "FIXING",
                  "BUILT", "QA", "STAGED", "ACTIVE", "VERIFIED", "BLOCKED",
                  "FAILED", "ROLLED_BACK", "CLOSED")

# Estados desde los que un ticket abandonado puede reasignarse sin perder trabajo.
ESTADOS_REASIGNABLES = ("CLAIMED", "INVESTIGATING", "FIXING", "QA")

# Transiciones de despliegue que un integrador puede registrar sobre un BUILT
# ajeno (autor agotado o pausado) sin tomar la propiedad del ticket: preserva
# autor y evidencia, solo dejando traza auditable del agente que actuo.
ESTADOS_DESPLIEGUE_INTEGRADOR = ("STAGED", "FAILED", "ROLLED_BACK")

# Estados que significan "hay trabajo a medias": no se purgan ni se reasignan
# sin conservar commit, artefacto y evidencia.
ESTADOS_ABIERTOS = ("DETECTED", "TRIAGED", "CLAIMED", "INVESTIGATING", "FIXING",
                    "BUILT", "QA", "STAGED", "ACTIVE", "BLOCKED")

ROLES = ("generalista", "observador", "desarrollador", "integrador",
         "desarrollador-integrador", "desarrollador-pesado", "integrador-qa",
         "observador-qa", "documentador-quickfix", "reposo-preservacion")

# Recursos con semantica especial. El resto (repo:X, player:UUID...) es libre.
RECURSO_COMPARTIDO = "observe"
RECURSO_REINICIO = "restart"

CONFIG_POR_DEFECTO = {
    # Fase 1 = solo local. Ver docs/SAORI.md; solo Jack la sube.
    "fase": 1,
    "moderacion": {
        "modo": "shadow",
        "shadow_horas_minimas": 72,
        "nivel_maximo_automatico": 0,
        "ban_permanente_habilitado": False,
        "ban_ip_habilitado": False,
        "consenso_desde_nivel": 3,
        "allowlist": ["JackStar6677-1", "Jack", "CONSOLE", "Server"],
        "confianza_minima": 0.85,
    },
    "anuncios": {
        "audiencias_activas": ["consola"],
        "cooldown_rutina_seg": 7200,
        "cooldown_incidente_seg": 900,
        "comando_publico": "broadcast {mensaje}",
        # Sin valor por defecto: depende de que plugin de staff-chat use Jack.
        # Con null se degrada a consola en vez de inventar un comando.
        "comando_staff": None,
    },
    "agentes": {
        "heartbeat_maximo_min": 45,
        "errores_seguidos_para_excluir": 3,
        "ttl_ticket_abandonado_min": 90,
    },
    "bloqueos": {"ttl_por_defecto_seg": 1800},
    "retencion": {"eventos_dias": 90, "anuncios_dias": 30,
                  "moderacion_dias": 365, "tickets_cerrados_dias": 180},
}


class SaoriError(Exception):
    """Error de uso o de estado. Se emite como JSON, no como traceback."""


# ─────────────────────────────── configuracion ────────────────────────────────

def _fusionar(base, encima):
    """Mezcla recursiva: el override solo pisa las claves que declara."""
    salida = dict(base)
    for clave, valor in (encima or {}).items():
        if isinstance(valor, dict) and isinstance(salida.get(clave), dict):
            salida[clave] = _fusionar(salida[clave], valor)
        else:
            salida[clave] = valor
    return salida


def cargar_config():
    """Config efectiva. Un archivo ilegible no debe dejar SAORI sin arrancar:
    se cae a los valores por defecto, que son los mas restrictivos."""
    if not CONFIG.is_file():
        return dict(CONFIG_POR_DEFECTO)
    try:
        return _fusionar(CONFIG_POR_DEFECTO,
                         json.loads(CONFIG.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return dict(CONFIG_POR_DEFECTO)


def guardar_config(cfg):
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, CONFIG)


# ─────────────────────────────── privacidad ───────────────────────────────────

# Se redacta al ESCRIBIR, no al mostrar: lo que no entra en la base no se puede
# filtrar despues por un volcado, un backup o un push accidental.
_PATRONES_REDACCION = (
    (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"), "[IP]"),
    (re.compile(r"\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b"), "[IPv6]"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"), "[EMAIL]"),
    (re.compile(r"(?i)\b(?:token|bearer|api[_-]?key|password|passwd|secret)"
                r"\s*[:=]\s*\S+"), "[SECRETO]"),
    (re.compile(r"\b[A-Za-z0-9_-]{32,}\b"), "[OPACO]"),
)

_PATRONES_INYECCION = (
    (re.compile(r"(?i)\b(?:ignore|disregard|forget|omit)\s+(?:all\s+)?(?:previous|above|prior|initial)\s+instructions\b"), "[INJECTION_BLOCKED:ignore-instructions]"),
    (re.compile(r"(?i)\b(?:system\s+prompt|system\s+override|admin\s+override|developer\s+mode|dan\s+mode|jailbreak)\b"), "[INJECTION_BLOCKED:override-attempt]"),
    (re.compile(r"(?i)\b(?:you\s+are\s+now|act\s+as|pretend\s+to\s+be)\s+(?:an?\s+)?(?:uncensored|admin|root|god|hacker|bot|assistant|saori|jack)\b"), "[INJECTION_BLOCKED:persona-impersonation]"),
    (re.compile(r"(?i)\[(?:system|saori|admin|console|root|server|moderation)\]"), "[INJECTION_BLOCKED:tag-spoofing]"),
    (re.compile(r"(?i)\b(?:dame\s+op|give\s+me\s+op|hazme\s+admin|hazme\s+op|op\s+me|force\s+op|bypass\s+auth)\b"), "[INJECTION_BLOCKED:privilege-escalation]"),
    (re.compile(r"(?i)\b(?:run_command|execute_shell|eval|os\.system|subprocess|rm\s+-rf|DROP\s+TABLE)\b"), "[INJECTION_BLOCKED:eval-directive]"),
)


def detectar_inyeccion_prompt(texto):
    """Detecta si un texto no confiable (chat, cartel, libro) contiene patrones de inyección."""
    if not texto:
        return False, []
    hallazgos = []
    texto_str = str(texto)
    for patron, etiqueta in _PATRONES_INYECCION:
        if patron.search(texto_str):
            hallazgos.append(etiqueta)
    return len(hallazgos) > 0, hallazgos


def redactar(texto):
    """Quita IP, correos, tokens y neutraliza intentos de inyección de prompt."""
    if not texto:
        return texto
    salida = str(texto)
    for patron, reemplazo in _PATRONES_REDACCION:
        salida = patron.sub(reemplazo, salida)
    for patron, reemplazo in _PATRONES_INYECCION:
        salida = patron.sub(reemplazo, salida)
    return salida


def huella(texto):
    """Identificador estable de un contenido sin conservar el contenido."""
    return hashlib.sha256(str(texto).encode("utf-8")).hexdigest()[:32]


# ─────────────────────────────── base de datos ────────────────────────────────

def conectar():
    """Conexion con WAL, claves foraneas y espera ante bloqueo.

    busy_timeout es lo que evita que dos agentes simultaneos se devuelvan
    'database is locked' en vez de esperar su turno.
    """
    ESTADO_DIR.mkdir(parents=True, exist_ok=True)
    cx = sqlite3.connect(str(BD), timeout=30, isolation_level=None)
    cx.row_factory = sqlite3.Row
    cx.execute("PRAGMA journal_mode=WAL")
    cx.execute("PRAGMA busy_timeout=30000")
    cx.execute("PRAGMA foreign_keys=ON")
    cx.execute("PRAGMA synchronous=NORMAL")
    migrar(cx)
    return cx


@contextmanager
def transaccion(cx):
    """IMMEDIATE toma el bloqueo de escritura al entrar, no al primer UPDATE:
    sin eso, dos agentes pueden leer el mismo ticket libre antes de que ninguno
    escriba, y ambos creerian haberlo ganado."""
    cx.execute("BEGIN IMMEDIATE")
    try:
        yield cx
    except Exception:
        cx.execute("ROLLBACK")
        raise
    else:
        cx.execute("COMMIT")


MIGRACIONES = {
    1: """
    CREATE TABLE IF NOT EXISTS agents (
        agent_id       TEXT PRIMARY KEY,
        enabled        INTEGER NOT NULL DEFAULT 1,
        paused         INTEGER NOT NULL DEFAULT 0,
        last_heartbeat INTEGER,
        quota_status   TEXT NOT NULL DEFAULT 'ok',
        current_role   TEXT,
        current_ticket INTEGER,
        last_error     TEXT,
        error_streak   INTEGER NOT NULL DEFAULT 0,
        capabilities   TEXT NOT NULL DEFAULT '[]',
        metadata       TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS tickets (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        title                 TEXT NOT NULL,
        category              TEXT NOT NULL,
        severity              TEXT NOT NULL DEFAULT 'media',
        priority              INTEGER NOT NULL DEFAULT 50,
        evidence              TEXT,
        source                TEXT,
        player                TEXT,
        player_uuid           TEXT,
        modality              TEXT,
        probable_repo         TEXT,
        assigned_agent        TEXT,
        status                TEXT NOT NULL DEFAULT 'DETECTED',
        created_at            INTEGER NOT NULL,
        claimed_at            INTEGER,
        completed_at          INTEGER,
        "commit"              TEXT,
        artifact              TEXT,
        local_sha256          TEXT,
        remote_sha256         TEXT,
        backup                TEXT,
        validation            TEXT,
        dependencies          TEXT NOT NULL DEFAULT '[]',
        private_data_reference TEXT,
        signature             TEXT,
        occurrences           INTEGER NOT NULL DEFAULT 1,
        first_seen            INTEGER,
        last_seen             INTEGER,
        updated_at            INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS ix_tickets_agent  ON tickets(assigned_agent);
    -- La firma agrupa repeticiones del mismo stack trace en UN incidente.
    CREATE UNIQUE INDEX IF NOT EXISTS ux_tickets_signature
        ON tickets(signature) WHERE signature IS NOT NULL;

    CREATE TABLE IF NOT EXISTS locks (
        resource    TEXT PRIMARY KEY,
        owner       TEXT NOT NULL,
        token       TEXT NOT NULL,
        acquired_at INTEGER NOT NULL,
        heartbeat   INTEGER NOT NULL,
        ttl         INTEGER NOT NULL,
        shared      INTEGER NOT NULL DEFAULT 0,
        ticket      INTEGER
    );

    CREATE TABLE IF NOT EXISTS events (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp          INTEGER NOT NULL,
        agent              TEXT,
        ticket             INTEGER,
        event_type         TEXT NOT NULL,
        summary            TEXT,
        evidence_reference TEXT,
        result             TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_events_ts ON events(timestamp);

    CREATE TABLE IF NOT EXISTS moderation_cases (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        player          TEXT NOT NULL,
        uuid            TEXT,
        evidence        TEXT,
        classification  TEXT NOT NULL,
        confidence      REAL NOT NULL DEFAULT 0,
        level           INTEGER NOT NULL DEFAULT 0,
        proposed_action TEXT,
        proposed_by     TEXT,
        reviewed_by     TEXT,
        review_verdict  TEXT,
        approved_by     TEXT,
        executed_action TEXT,
        executed_at     INTEGER,
        expires_at      INTEGER,
        reversible      INTEGER NOT NULL DEFAULT 1,
        appeal_status   TEXT NOT NULL DEFAULT 'ninguna',
        status          TEXT NOT NULL DEFAULT 'PROPUESTO',
        shadow          INTEGER NOT NULL DEFAULT 1,
        created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_mod_player ON moderation_cases(player);

    CREATE TABLE IF NOT EXISTS announcements (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        category       TEXT NOT NULL,
        message        TEXT NOT NULL,
        message_hash   TEXT NOT NULL,
        created_at     INTEGER NOT NULL,
        sent_at        INTEGER,
        cooldown_until INTEGER,
        audience       TEXT NOT NULL,
        incident_key   TEXT,
        result         TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_ann_cat ON announcements(category, created_at);
    """,
    2: """
    -- v1 guardaba un único owner por recurso, lo que hacía que `observe`
    -- pareciera compartido sin poder seguir ni liberar cada lector.
    ALTER TABLE locks RENAME TO locks_v1;
    CREATE TABLE locks (
        resource    TEXT NOT NULL,
        owner       TEXT NOT NULL,
        token       TEXT NOT NULL,
        acquired_at INTEGER NOT NULL,
        heartbeat   INTEGER NOT NULL,
        ttl         INTEGER NOT NULL,
        shared      INTEGER NOT NULL DEFAULT 0,
        ticket      INTEGER,
        PRIMARY KEY(resource, owner)
    );
    INSERT INTO locks(resource,owner,token,acquired_at,heartbeat,ttl,shared,ticket)
        SELECT resource,owner,token,acquired_at,heartbeat,ttl,shared,ticket
        FROM locks_v1;
    DROP TABLE locks_v1;
    CREATE INDEX ix_locks_resource ON locks(resource);
    """,
    3: """
    -- v3 agrega quota_percent para balance adaptativo de roles y despacho de tickets
    ALTER TABLE agents ADD COLUMN quota_percent INTEGER NOT NULL DEFAULT 100;
    """,
}


def migrar(cx):
    """Migraciones por `user_version`. Cada una corre una sola vez y en orden."""
    actual = cx.execute("PRAGMA user_version").fetchone()[0]
    for version in sorted(MIGRACIONES):
        if version > actual:
            cx.executescript(MIGRACIONES[version])
            cx.execute(f"PRAGMA user_version={version}")
            actual = version
    if actual > ESQUEMA_VERSION:
        raise SaoriError(
            f"la base esta en esquema v{actual} y este script solo entiende "
            f"v{ESQUEMA_VERSION}: actualiza saori_orchestrador.py antes de seguir")


def ahora():
    return int(time.time())


def evento(cx, tipo, *, agente=None, ticket=None, resumen=None,
           evidencia=None, resultado=None):
    """Bitacora append-only. Todo lo que SAORI decide deja rastro aqui."""
    cx.execute(
        "INSERT INTO events(timestamp,agent,ticket,event_type,summary,"
        "evidence_reference,result) VALUES(?,?,?,?,?,?,?)",
        (ahora(), agente, ticket, tipo, redactar(resumen), evidencia, resultado))


# ─────────────────────────────── agentes y roles ──────────────────────────────

def _pausa_heredada():
    """Compatibilidad con coordinar_agentes.py mientras los tres prompts migran.

    Si Jack pausa un agente desde el widget antiguo, SAORI debe respetarlo: dos
    interruptores donde uno no apaga es peor que no tener interruptor.
    """
    try:
        d = json.loads(CONTROL_ANTIGUO.read_text(encoding="utf-8"))
        return {k: bool(v) for k, v in (d.get("paused") or {}).items()}
    except (OSError, ValueError):
        return {}


def registrar_agente(cx, agente, capacidades=None, metadata=None):
    if agente not in AGENTES:
        raise SaoriError(f"agente desconocido: {agente}")
    with transaccion(cx):
        cx.execute(
            "INSERT INTO agents(agent_id,last_heartbeat,capabilities,metadata) "
            "VALUES(?,?,?,?) ON CONFLICT(agent_id) DO UPDATE SET "
            "capabilities=excluded.capabilities, metadata=excluded.metadata",
            (agente, ahora(), json.dumps(capacidades or []),
             json.dumps(metadata or {})))
        evento(cx, "agente-registrado", agente=agente)
    return {"ok": True, "agente": agente}


def heartbeat_agente(cx, agente, *, cuota=None, error=None, rol=None, porcentaje=None):
    """Late-vivo del agente. Tambien es donde declara su cuota, porcentaje y sus fallos."""
    with transaccion(cx):
        fila = cx.execute("SELECT error_streak, quota_percent FROM agents WHERE agent_id=?",
                          (agente,)).fetchone()
        if fila is None:
            cx.execute("INSERT INTO agents(agent_id) VALUES(?)", (agente,))
            racha = 0
            pct = 100
        else:
            racha = int(fila["error_streak"])
            pct = int(fila["quota_percent"]) if "quota_percent" in fila.keys() and fila["quota_percent"] is not None else 100
        racha = racha + 1 if error else 0
        if porcentaje is not None:
            pct = max(0, min(100, int(porcentaje)))
        elif cuota and str(cuota).lower() in ("agotada", "exhausted", "limite"):
            pct = 0
        elif cuota and str(cuota).lower() in ("ok", "activa", "active") and pct <= 0:
            # Una ejecución correcta prueba que la ventana volvió a estar
            # disponible. No conservar el cero de un agotamiento anterior: eso
            # excluiría al agente aunque ya esté trabajando. Si la CLI conoce el
            # porcentaje exacto debe enviarlo expresamente con --porcentaje.
            pct = 100

        cx.execute(
            "UPDATE agents SET last_heartbeat=?, quota_status=COALESCE(?,quota_status),"
            " last_error=?, error_streak=?, current_role=COALESCE(?,current_role),"
            " quota_percent=? WHERE agent_id=?",
            (ahora(), cuota, redactar(error), racha, rol, pct, agente))
        renovar_bloqueos_de(cx, agente)
    return {"ok": True, "agente": agente, "errores_seguidos": racha, "quota_percent": pct}


def pausar_agente(cx, agente, pausado):
    with transaccion(cx):
        cx.execute("INSERT INTO agents(agent_id,paused) VALUES(?,?) "
                   "ON CONFLICT(agent_id) DO UPDATE SET paused=excluded.paused",
                   (agente, 1 if pausado else 0))
        evento(cx, "pausa" if pausado else "reanudacion", agente=agente)
    return {"ok": True, "agente": agente, "pausado": bool(pausado)}


def disponibilidad(cx, cfg=None):
    """Quien puede trabajar ahora y, si no puede, por que exactamente.

    Devolver el motivo importa: 'no disponible' sin causa hace que Jack revise
    tres aplicaciones para averiguar cual se quedo sin cuota.
    """
    cfg = cfg or cargar_config()
    limite = int(cfg["agentes"]["heartbeat_maximo_min"]) * 60
    max_errores = int(cfg["agentes"]["errores_seguidos_para_excluir"])
    heredadas = _pausa_heredada()
    salida = {}
    for agente in AGENTES:
        fila = cx.execute("SELECT * FROM agents WHERE agent_id=?", (agente,)).fetchone()
        if fila is None:
            salida[agente] = {"disponible": False, "motivo": "no-registrado",
                              "rol": None, "cuota": "desconocida", "quota_percent": 0,
                              "tier_cuota": "critico", "ultimo_heartbeat": None}
            continue
        edad = ahora() - int(fila["last_heartbeat"] or 0)
        pausado = bool(fila["paused"]) or heredadas.get(agente, False)
        pct = int(fila["quota_percent"]) if "quota_percent" in fila.keys() and fila["quota_percent"] is not None else 100
        if not int(fila["enabled"]):
            motivo = "deshabilitado"
        elif pausado:
            motivo = "pausado"
        elif fila["last_heartbeat"] is None or edad > limite:
            motivo = "heartbeat-caduco"
        elif str(fila["quota_status"]).lower() in ("agotada", "exhausted", "limite") or pct <= 0:
            motivo = "cuota-agotada"
        elif int(fila["error_streak"]) >= max_errores:
            motivo = "errores-repetidos"
        else:
            motivo = None

        if pct >= 70:
            tier = "alto"
        elif pct >= 30:
            tier = "medio"
        elif pct >= 10:
            tier = "eco"
        else:
            tier = "critico"

        salida[agente] = {
            "disponible": motivo is None,
            "motivo": motivo,
            "rol": fila["current_role"],
            "ticket": fila["current_ticket"],
            "cuota": fila["quota_status"],
            "quota_percent": pct,
            "tier_cuota": tier,
            "errores_seguidos": int(fila["error_streak"]),
            "ultimo_error": fila["last_error"],
            "ultimo_heartbeat": fila["last_heartbeat"],
            "edad_min": edad // 60 if fila["last_heartbeat"] else None,
            "capacidades": json.loads(fila["capabilities"] or "[]"),
        }
    return salida


UMBRAL_RIESGO_CUOTA = 5

# Preferencias de rol cuando estan los tres. Son preferencias, no jaulas:
# `asignar` cae al reparto generico si falta alguno.
ROL_PREFERIDO = {"antigravity": "observador", "claude-code": "desarrollador",
                 "codex": "integrador"}


def asignar_roles(cx, cfg=None):
    """Reparte roles segun agentes disponibles y su porcentaje de cuota (batería)."""
    disp = disponibilidad(cx, cfg)
    vivos = [a for a in AGENTES if disp[a]["disponible"]]

    # Agentes operativos son los disponibles con cuota por encima del umbral de riesgo (5%)
    vivos_operativos = [a for a in vivos if int(disp[a].get("quota_percent", 100)) > UMBRAL_RIESGO_CUOTA]
    vivos_en_riesgo = [a for a in vivos if int(disp[a].get("quota_percent", 100)) <= UMBRAL_RIESGO_CUOTA]

    vivos_por_cuota = sorted(
        vivos_operativos,
        key=lambda a: (int(disp[a].get("quota_percent", 100)),
                       -["antigravity", "claude-code", "codex"].index(a)),
        reverse=True
    )
    roles = {}
    for a in vivos_en_riesgo:
        roles[a] = "reposo-preservacion"

    todos_eco = len(vivos) > 0 and all(int(disp[a].get("quota_percent", 100)) < 30 for a in vivos)

    if len(vivos_operativos) == 0:
        if len(vivos) == 0:
            modo = "sin-agentes"
        else:
            modo = "eco-conservacion"
            for a in vivos:
                roles[a] = "documentador-quickfix"
    elif todos_eco and len(vivos_operativos) == len(vivos):
        modo = "eco-conservacion"
        for a in vivos:
            roles[a] = "documentador-quickfix"
    elif len(vivos_operativos) == 1:
        modo = "generalista"
        roles[vivos_operativos[0]] = "generalista"
    elif len(vivos_operativos) == 2:
        modo = "dual"
        if int(disp[vivos_operativos[0]].get("quota_percent", 100)) == int(disp[vivos_operativos[1]].get("quota_percent", 100)):
            orden = sorted(vivos_operativos, key=lambda a: ("antigravity", "claude-code", "codex").index(a))
            roles[orden[0]] = "observador"
            roles[orden[1]] = "desarrollador-integrador"
        else:
            roles[vivos_por_cuota[0]] = "desarrollador-pesado"
            roles[vivos_por_cuota[1]] = "observador-qa"
    else:
        modo = "triple"
        # Si las cuotas son iguales, usar preferencias
        cuotas = [int(disp[a].get("quota_percent", 100)) for a in vivos_operativos]
        if len(set(cuotas)) == 1:
            for agente in vivos_operativos:
                roles[agente] = ROL_PREFERIDO[agente]
        else:
            roles[vivos_por_cuota[0]] = "desarrollador-pesado"
            roles[vivos_por_cuota[1]] = "integrador-qa"
            roles[vivos_por_cuota[2]] = "observador"

    with transaccion(cx):
        for agente in AGENTES:
            cx.execute("UPDATE agents SET current_role=? WHERE agent_id=?",
                       (roles.get(agente), agente))
        evento(cx, "roles-asignados", resumen=f"modo={modo} {json.dumps(roles)}")
    return {"modo": modo, "roles": roles, "disponibles": vivos,
            "detalle": disp}


def agente_operable(cx, agente, cfg=None):
    """Valida en código que el agente pueda tomar trabajo, no sólo en prompt."""
    if agente not in AGENTES:
        return {"ok": False, "reason": "agente-desconocido"}
    detalle = disponibilidad(cx, cfg).get(agente) or {}
    if not detalle.get("disponible"):
        return {"ok": False, "reason": detalle.get("motivo") or "no-disponible",
                "agente": agente}
    return {"ok": True}


# ─────────────────────────────── bloqueos ─────────────────────────────────────

def _expirados(cx):
    """Un bloqueo caduca por heartbeat, no por antiguedad: un agente que sigue
    latiendo conserva el recurso aunque lleve horas en el mismo ticket."""
    cx.execute("DELETE FROM locks WHERE heartbeat + ttl < ?", (ahora(),))


def renovar_bloqueos_de(cx, agente):
    cx.execute("UPDATE locks SET heartbeat=? WHERE owner=?", (ahora(), agente))


def adquirir_bloqueo(cx, recurso, agente, *, ttl=None, compartido=False,
                     ticket=None, cfg=None):
    """Toma un recurso. `observe` es compartido; todo lo demas, exclusivo.

    `restart` es especial: exige que no haya NINGUN otro bloqueo vivo, porque un
    reinicio a la vez que un despliegue deja el jar a medio subir.
    """
    cfg = cfg or cargar_config()
    operable = agente_operable(cx, agente, cfg)
    if not operable["ok"]:
        return operable
    ttl = int(ttl or cfg["bloqueos"]["ttl_por_defecto_seg"])
    token = secrets.token_urlsafe(24)
    with transaccion(cx):
        _expirados(cx)
        if recurso == RECURSO_REINICIO:
            otros = cx.execute(
                "SELECT resource,owner FROM locks WHERE resource<>?",
                (RECURSO_REINICIO,)).fetchall()
            if otros:
                return {"ok": False, "reason": "ocupado-por-otros",
                        "bloqueos": [dict(o) for o in otros]}
        else:
            reinicio = cx.execute("SELECT owner FROM locks WHERE resource=?",
                                  (RECURSO_REINICIO,)).fetchone()
            if reinicio:
                return {"ok": False, "reason": "reinicio-en-curso",
                        "owner": reinicio["owner"]}

        existentes = cx.execute("SELECT * FROM locks WHERE resource=?",
                                (recurso,)).fetchall()
        es_compartido = compartido or recurso == RECURSO_COMPARTIDO
        propio = next((fila for fila in existentes if fila["owner"] == agente), None)
        if propio:
            cx.execute("UPDATE locks SET heartbeat=?, ttl=? "
                       "WHERE resource=? AND owner=?",
                       (ahora(), ttl, recurso, agente))
            return {"ok": True, "reason": "ya-era-suyo", "recurso": recurso,
                    "token": propio["token"]}
        if existentes and not (es_compartido and
                                all(int(fila["shared"]) for fila in existentes)):
            return {"ok": False, "reason": "busy", "recurso": recurso,
                    "owner": existentes[0]["owner"]}
        if es_compartido:
            # Cada lector necesita su propia fila, token y heartbeat. Así un
            # lector no desaparece cuando otro libera el mismo recurso.
            cx.execute(
                "INSERT INTO locks(resource,owner,token,acquired_at,heartbeat,ttl,"
                "shared,ticket) VALUES(?,?,?,?,?,?,1,?)",
                (recurso, agente, token, ahora(), ahora(), ttl, ticket))
            evento(cx, "bloqueo-adquirido", agente=agente, ticket=ticket,
                   resumen=recurso)
            return {"ok": True, "reason": "compartido", "recurso": recurso,
                    "token": token, "ttl": ttl}
        cx.execute(
            "INSERT INTO locks(resource,owner,token,acquired_at,heartbeat,ttl,"
            "shared,ticket) VALUES(?,?,?,?,?,?,?,?)",
            (recurso, agente, token, ahora(), ahora(), ttl,
             1 if es_compartido else 0, ticket))
        evento(cx, "bloqueo-adquirido", agente=agente, ticket=ticket,
               resumen=recurso)
    return {"ok": True, "recurso": recurso, "token": token, "ttl": ttl}


def liberar_bloqueo(cx, recurso, agente, token=None):
    with transaccion(cx):
        fila = cx.execute("SELECT * FROM locks WHERE resource=? AND owner=?",
                          (recurso, agente)).fetchone()
        if fila is None:
            otro = cx.execute("SELECT owner FROM locks WHERE resource=? LIMIT 1",
                              (recurso,)).fetchone()
            if otro:
                return {"ok": False, "reason": "not-owner", "owner": otro["owner"]}
            return {"ok": True, "reason": "no-existia"}
        if token and token != fila["token"]:
            return {"ok": False, "reason": "token-invalido"}
        cx.execute("DELETE FROM locks WHERE resource=? AND owner=?",
                   (recurso, agente))
        evento(cx, "bloqueo-liberado", agente=agente, resumen=recurso)
    return {"ok": True, "recurso": recurso}


def listar_bloqueos(cx):
    with transaccion(cx):
        _expirados(cx)
    return [dict(f) for f in cx.execute(
        "SELECT resource,owner,acquired_at,heartbeat,ttl,shared,ticket "
        "FROM locks ORDER BY acquired_at").fetchall()]


# ─────────────────────────────── tickets ──────────────────────────────────────

def crear_ticket(cx, **kw):
    """Alta de incidencia. Si llega `firma`, repeticiones del mismo fallo
    incrementan el contador en vez de crear tickets nuevos."""
    firma = kw.get("firma")
    momento = ahora()
    with transaccion(cx):
        if firma:
            previo = cx.execute("SELECT id,status,occurrences FROM tickets "
                                "WHERE signature=?", (firma,)).fetchone()
            if previo:
                cx.execute(
                    "UPDATE tickets SET occurrences=occurrences+1, last_seen=?, "
                    "updated_at=? WHERE id=?", (momento, momento, previo["id"]))
                evento(cx, "ticket-repetido", ticket=previo["id"],
                       resumen=f"repeticion #{previo['occurrences']+1}")
                return {"ok": True, "ticket": previo["id"], "repetido": True,
                        "repeticiones": previo["occurrences"] + 1,
                        "estado": previo["status"]}
        cur = cx.execute(
            "INSERT INTO tickets(title,category,severity,priority,evidence,source,"
            "player,player_uuid,modality,probable_repo,status,created_at,"
            "dependencies,private_data_reference,signature,first_seen,last_seen,"
            "updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (kw["titulo"], kw["categoria"], kw.get("severidad", "media"),
             int(kw.get("prioridad", 50)), redactar(kw.get("evidencia")),
             kw.get("fuente"), kw.get("jugador"), kw.get("uuid"),
             kw.get("modalidad"), kw.get("repo"), kw.get("estado", "DETECTED"),
             momento, json.dumps(kw.get("dependencias") or []),
             kw.get("referencia_privada"), firma, momento, momento, momento))
        tid = cur.lastrowid
        evento(cx, "ticket-creado", ticket=tid, resumen=kw["titulo"])
    return {"ok": True, "ticket": tid, "repetido": False}


def reclamar_ticket(cx, agente, ticket=None, cfg=None):
    """Reclama un ticket. La exclusion la da el UPDATE condicional, no una
    comprobacion previa: si dos agentes lo intentan a la vez, solo uno ve
    rowcount=1 y el otro recibe 'ya-reclamado'."""
    cfg = cfg or cargar_config()
    operable = agente_operable(cx, agente, cfg)
    if not operable["ok"]:
        return operable
    with transaccion(cx):
        _expirados(cx)
        if ticket is None:
            ag_fila = cx.execute("SELECT quota_percent FROM agents WHERE agent_id=?",
                                 (agente,)).fetchone()
            pct = int(ag_fila["quota_percent"]) if ag_fila and ag_fila["quota_percent"] is not None else 100
            if pct < 30:
                # En modo eco / batería baja: solo reclamar tickets de severidad baja o documentación/guía/quickfix
                fila = cx.execute(
                    "SELECT id FROM tickets WHERE status IN ('DETECTED','TRIAGED') "
                    "AND assigned_agent IS NULL "
                    "AND (severity = 'baja' OR category IN ('documentacion', 'web', 'quickfix', 'optimizacion')) "
                    "ORDER BY priority DESC, created_at LIMIT 1").fetchone()
            else:
                fila = cx.execute(
                    "SELECT id FROM tickets WHERE status IN ('DETECTED','TRIAGED') "
                    "AND assigned_agent IS NULL ORDER BY priority DESC, created_at "
                    "LIMIT 1").fetchone()
            if fila is None:
                return {"ok": False, "reason": "sin-tickets-libres", "quota_percent": pct}
            ticket = int(fila["id"])
        cur = cx.execute(
            "UPDATE tickets SET assigned_agent=?, status='CLAIMED', claimed_at=?, "
            "updated_at=? WHERE id=? AND assigned_agent IS NULL "
            "AND status IN ('DETECTED','TRIAGED')",
            (agente, ahora(), ahora(), ticket))
        if cur.rowcount == 0:
            actual = cx.execute("SELECT assigned_agent,status FROM tickets "
                                "WHERE id=?", (ticket,)).fetchone()
            if actual is None:
                return {"ok": False, "reason": "no-existe"}
            return {"ok": False, "reason": "ya-reclamado",
                    "owner": actual["assigned_agent"], "estado": actual["status"]}
        cx.execute("UPDATE agents SET current_ticket=? WHERE agent_id=?",
                   (ticket, agente))
        evento(cx, "ticket-reclamado", agente=agente, ticket=ticket)
    return {"ok": True, "ticket": ticket, "agente": agente}


def progreso_ticket(cx, ticket, agente, estado, **kw):
    if estado not in ESTADOS_TICKET:
        raise SaoriError(f"estado invalido: {estado}")
    campos = {"status": estado, "updated_at": ahora()}
    for clave, columna in (("commit", '"commit"'), ("artefacto", "artifact"),
                           ("sha_local", "local_sha256"),
                           ("sha_remoto", "remote_sha256"), ("respaldo", "backup"),
                           ("validacion", "validation")):
        if kw.get(clave) is not None:
            campos[columna] = kw[clave]
    if estado in ("VERIFIED", "CLOSED", "ROLLED_BACK", "FAILED"):
        campos["completed_at"] = ahora()
    with transaccion(cx):
        fila = cx.execute("SELECT assigned_agent, status FROM tickets WHERE id=?",
                          (ticket,)).fetchone()
        if fila is None:
            return {"ok": False, "reason": "no-existe"}
        autor_original = fila["assigned_agent"]
        transferencia_integrador = False
        if autor_original not in (None, agente):
            rol_actor = cx.execute(
                "SELECT current_role FROM agents WHERE agent_id=?", (agente,)
            ).fetchone()
            rol_actor = rol_actor["current_role"] if rol_actor else None
            es_integrador = bool(rol_actor) and "integrador" in rol_actor
            if (fila["status"] == "BUILT" and estado in ESTADOS_DESPLIEGUE_INTEGRADOR
                    and es_integrador):
                transferencia_integrador = True
            else:
                return {"ok": False, "reason": "not-owner",
                        "owner": autor_original}
        sets = ", ".join(f"{c}=?" for c in campos)
        cx.execute(f"UPDATE tickets SET {sets} WHERE id=?",
                   (*campos.values(), ticket))
        if estado in ("VERIFIED", "CLOSED", "FAILED", "ROLLED_BACK"):
            cx.execute("UPDATE agents SET current_ticket=NULL WHERE current_ticket=?",
                       (ticket,))
        resumen = estado
        if transferencia_integrador:
            resumen = f"{estado} (integrador {agente} sobre BUILT de {autor_original})"
        evento(cx, "ticket-progreso", agente=agente, ticket=ticket,
               resumen=resumen, resultado=kw.get("nota"))
    return {"ok": True, "ticket": ticket, "estado": estado}


def reasignar_abandonados(cx, cfg=None):
    """Libera tickets cuyo dueño lleva demasiado sin latir.

    Se conserva TODO (commit, artefacto, evidencia) y solo se suelta la
    asignacion: reasignar no puede significar empezar de cero.
    """
    cfg = cfg or cargar_config()
    ttl = int(cfg["agentes"]["ttl_ticket_abandonado_min"]) * 60
    limite = ahora() - ttl
    sueltos = []
    with transaccion(cx):
        filas = cx.execute(
            "SELECT t.id, t.assigned_agent, a.last_heartbeat FROM tickets t "
            "LEFT JOIN agents a ON a.agent_id = t.assigned_agent "
            f"WHERE t.status IN ({','.join('?'*len(ESTADOS_REASIGNABLES))}) "
            "AND t.assigned_agent IS NOT NULL",
            ESTADOS_REASIGNABLES).fetchall()
        for f in filas:
            if int(f["last_heartbeat"] or 0) < limite:
                cx.execute("UPDATE tickets SET assigned_agent=NULL, "
                           "status='TRIAGED', updated_at=? WHERE id=?",
                           (ahora(), f["id"]))
                evento(cx, "ticket-reasignado", ticket=f["id"],
                       resumen=f"abandonado por {f['assigned_agent']}")
                sueltos.append({"ticket": f["id"], "era_de": f["assigned_agent"]})
    return {"ok": True, "liberados": sueltos}


def listar_tickets(cx, estado=None, agente=None, limite=50):
    sql = "SELECT * FROM tickets WHERE 1=1"
    args = []
    if estado:
        sql += " AND status=?"
        args.append(estado)
    if agente:
        sql += " AND assigned_agent=?"
        args.append(agente)
    sql += " ORDER BY priority DESC, created_at DESC LIMIT ?"
    args.append(int(limite))
    return [dict(f) for f in cx.execute(sql, args).fetchall()]


def cola_por_estado(cx):
    return {f["status"]: f["n"] for f in cx.execute(
        "SELECT status, COUNT(*) n FROM tickets GROUP BY status").fetchall()}


# ─────────────────────────────── moderacion ───────────────────────────────────

# Categorias reconocidas. Las tres ultimas existen para poder clasificar algo
# como "no sancionable" de forma explicita, en vez de dejarlo sin clasificar.
CATEGORIAS_MODERACION = (
    "spam", "flood", "bots", "evasion-sancion", "amenazas-creibles", "doxxing",
    "acoso-dirigido", "odio-grave", "extorsion", "compromiso-cuentas",
    "explotacion-servidor", "distribucion-exploits", "publicidad-maliciosa",
    "toxicidad-reiterada", "insulto-aislado", "critica-legitima",
    "broma-contextual", "reporte-sin-evidencia",
)

# Techo de nivel por categoria. Una critica legitima no puede escalar por mucha
# confianza que declare el clasificador.
TECHO_NIVEL = {
    "critica-legitima": 0, "broma-contextual": 0, "reporte-sin-evidencia": 0,
    "insulto-aislado": 0, "spam": 2, "flood": 2, "toxicidad-reiterada": 2,
    "acoso-dirigido": 3, "evasion-sancion": 3, "explotacion-servidor": 3,
    "publicidad-maliciosa": 2, "bots": 4, "compromiso-cuentas": 4,
    "amenazas-creibles": 4, "doxxing": 4, "odio-grave": 4, "extorsion": 4,
    "distribucion-exploits": 4,
}

ACCION_POR_NIVEL = {0: "registro", 1: "advertencia", 2: "mute-temporal",
                    3: "kick-o-tempban", 4: "cuarentena", 5: "ban-permanente"}


def proponer_moderacion(cx, *, jugador, uuid=None, clasificacion, confianza,
                        evidencia=None, nivel=None, agente=None, cfg=None):
    """Crea un caso. En shadow mode NUNCA ejecuta; solo deja la propuesta.

    El nivel propuesto se recorta por el techo de la categoria y por el techo
    global de la config, de modo que subir la confianza no puede, por si solo,
    convertir un insulto en un ban.
    """
    cfg = cfg or cargar_config()
    mod = cfg["moderacion"]
    if clasificacion not in CATEGORIAS_MODERACION:
        raise SaoriError(f"clasificacion desconocida: {clasificacion}")

    if jugador in mod["allowlist"]:
        # No se silencia: se registra como posible compromiso de cuenta
        # privilegiada, que es justo el caso que no se puede perder.
        with transaccion(cx):
            cur = cx.execute(
                "INSERT INTO moderation_cases(player,uuid,evidence,classification,"
                "confidence,level,proposed_action,proposed_by,status,shadow,"
                "created_at,reversible) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)",
                (jugador, uuid, redactar(evidencia), clasificacion,
                 float(confianza), 0, "alerta-cuenta-privilegiada", agente,
                 "ALERTA_ALLOWLIST", 1, ahora()))
            evento(cx, "moderacion-allowlist", agente=agente,
                   resumen=f"{jugador}: {clasificacion}")
        return {"ok": True, "caso": cur.lastrowid, "accion": "alerta-allowlist",
                "ejecutado": False,
                "nota": "cuenta en allowlist: se alerta a Jack, no se sanciona"}

    techo_categoria = TECHO_NIVEL.get(clasificacion, 0)
    propuesto = min(int(nivel if nivel is not None else techo_categoria),
                    techo_categoria)
    if float(confianza) < float(mod["confianza_minima"]):
        propuesto = 0
    if propuesto >= 5 and not mod["ban_permanente_habilitado"]:
        propuesto = 4

    accion = ACCION_POR_NIVEL[propuesto]
    requiere_consenso = propuesto >= int(mod["consenso_desde_nivel"])
    en_shadow = mod["modo"] != "enforcement"

    with transaccion(cx):
        cur = cx.execute(
            "INSERT INTO moderation_cases(player,uuid,evidence,classification,"
            "confidence,level,proposed_action,proposed_by,status,shadow,"
            "created_at,reversible) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (jugador, uuid, redactar(evidencia), clasificacion, float(confianza),
             propuesto, accion, agente,
             "PROPUESTO" if propuesto > 0 else "REGISTRO",
             1 if en_shadow else 0, ahora(), 0 if propuesto >= 5 else 1))
        caso = cur.lastrowid
        evento(cx, "moderacion-propuesta", agente=agente,
               resumen=f"caso {caso} nivel {propuesto} {clasificacion}",
               evidencia=huella(evidencia or ""))
    return {"ok": True, "caso": caso, "nivel": propuesto, "accion": accion,
            "shadow": en_shadow, "requiere_consenso": requiere_consenso,
            "ejecutado": False}


def revisar_moderacion(cx, caso, agente, veredicto, nota=None):
    """Segunda opinion independiente. Quien propuso no puede revisar."""
    if veredicto not in ("confirma", "rechaza"):
        raise SaoriError("veredicto debe ser confirma o rechaza")
    with transaccion(cx):
        fila = cx.execute("SELECT * FROM moderation_cases WHERE id=?",
                          (caso,)).fetchone()
        if fila is None:
            return {"ok": False, "reason": "no-existe"}
        if fila["proposed_by"] == agente:
            return {"ok": False, "reason": "mismo-agente",
                    "nota": "quien propone no puede revisar ni aprobar"}
        cx.execute("UPDATE moderation_cases SET reviewed_by=?, review_verdict=?, "
                   "status=? WHERE id=?",
                   (agente, veredicto,
                    "REVISADO" if veredicto == "confirma" else "DESCARTADO", caso))
        evento(cx, "moderacion-revision", agente=agente,
               resumen=f"caso {caso}: {veredicto}", resultado=redactar(nota))
    return {"ok": True, "caso": caso, "veredicto": veredicto}


def ejecutar_moderacion(cx, caso, agente, *, cfg=None):
    """Ejecuta una sancion aprobada. Bloqueada de raiz en shadow mode.

    Comprueba, en este orden: modo, fase, consenso, techo de nivel y permisos
    especiales para ban permanente e IP. Cualquier fallo devuelve motivo y no
    toca produccion.
    """
    cfg = cfg or cargar_config()
    mod = cfg["moderacion"]
    fila = cx.execute("SELECT * FROM moderation_cases WHERE id=?", (caso,)).fetchone()
    if fila is None:
        return {"ok": False, "reason": "no-existe"}
    nivel = int(fila["level"])

    if mod["modo"] != "enforcement":
        return {"ok": False, "reason": "shadow-mode",
                "nota": "solo Jack puede pasar a enforcement"}
    if int(cfg["fase"]) < 4:
        return {"ok": False, "reason": "fase-insuficiente", "fase": cfg["fase"]}
    if nivel > int(mod["nivel_maximo_automatico"]):
        return {"ok": False, "reason": "nivel-sobre-el-techo",
                "nivel": nivel, "techo": mod["nivel_maximo_automatico"]}
    if nivel >= int(mod["consenso_desde_nivel"]):
        if fila["review_verdict"] != "confirma":
            return {"ok": False, "reason": "sin-consenso"}
        if fila["reviewed_by"] == fila["proposed_by"]:
            return {"ok": False, "reason": "consenso-invalido"}
        if agente == fila["proposed_by"]:
            return {"ok": False, "reason": "proponente-no-ejecuta"}
    if nivel >= 5 and not mod["ban_permanente_habilitado"]:
        return {"ok": False, "reason": "ban-permanente-desactivado"}

    # Un caso ya ejecutado no se re-ejecuta: evita la sancion duplicada cuando
    # dos agentes procesan la misma cola.
    if fila["executed_at"]:
        return {"ok": False, "reason": "ya-ejecutado",
                "cuando": fila["executed_at"]}

    with transaccion(cx):
        cx.execute("UPDATE moderation_cases SET executed_action=?, executed_at=?, "
                   "approved_by=?, status='EJECUTADO' WHERE id=? AND executed_at IS NULL",
                   (fila["proposed_action"], ahora(), agente, caso))
        evento(cx, "moderacion-ejecutada", agente=agente,
               resumen=f"caso {caso} nivel {nivel}")
    return {"ok": True, "caso": caso, "accion": fila["proposed_action"]}


# ─────────────────────────────── anuncios ─────────────────────────────────────

PLANTILLAS = {
    "inicio": "§8[§dSAORI§8] §7Análisis técnico activo: §f{agente}\n§8Revisando estabilidad, errores recientes y reportes técnicos.",
    "refuerzo": "§8[§dSAORI§8] §aSupervisión técnica reforzada activa.\n§7Antigravity analiza registros, Claude revisa código y Codex valida producción.",
    "auditoria": "§8[§dSAORI§8] §7Auditoría preventiva en curso:\n§finventarios, comandos, protecciones y registros técnicos.\n§8Los datos se revisan de forma privada y no se publican.",
    "transparencia": "§8[§dSAORI§8] §7Los reportes técnicos enviados por chat o mensajes al staff\n§7pueden correlacionarse con los registros del servidor para detectar fallos.",
    "sin-errores": "§8[§dSAORI§8] §aRevisión finalizada.\n§7No se detectaron problemas técnicos nuevos.",
    "con-hallazgos": "§8[§dSAORI§8] §eRevisión finalizada: §f{x} incidencias técnicas detectadas.\n§a{y} corregidas y verificadas §8· §6{z} pendiente de investigación.",
    "cambios-preparados": "§8[§dSAORI§8] §bMantenimiento preparado:\n§f{x} correcciones se integrarán en el próximo reinicio seguro.\n§7No es necesario desconectarse todavía. Guías y tienda en §fweb.drakescraft.cl",
    "antes-reinicio": "§8[§dSAORI§8] §eActivación técnica en 2 minutos.\n§7Se guardarán mundos e inventarios antes del reinicio seguro.",
    "despues-reinicio": "§8[§dSAORI§8] §aMantenimiento activado.\n§f{x} correcciones cargadas §8· §a{y} verificadas §8· §e{z} bajo observación.",
}

CATEGORIAS_RUTINA = ("inicio", "refuerzo", "auditoria", "transparencia",
                     "sin-errores", "con-hallazgos", "cambios-preparados",
                     "antes-reinicio", "despues-reinicio")


def anunciar(cx, categoria, *, audiencia="consola", variables=None,
             incidente=None, cfg=None, dry_run=False):
    """Unico camino para hablar en el servidor.

    Los agentes no emiten broadcasts por su cuenta: si tres agentes anuncian
    "revision finalizada", el jugador ve spam y deja de leerlo. Aqui se aplica
    cooldown por categoria y deduplicacion por hash de mensaje.
    """
    cfg = cfg or cargar_config()
    ann = cfg["anuncios"]
    plantilla = PLANTILLAS.get(categoria)
    if plantilla is None:
        raise SaoriError(f"categoria de anuncio desconocida: {categoria}")

    def _formatear(p: str, v: dict | None) -> str:
        d = {"agente": "Claude Code", "x": "0", "y": "0", "z": "0", **(v or {})}
        try:
            return p.format(**d)
        except Exception:
            return p

    mensaje = _formatear(plantilla, variables)
    h = huella(mensaje if not incidente else f"{incidente}:{categoria}")
    momento = ahora()
    cooldown = int(ann["cooldown_rutina_seg"] if categoria in CATEGORIAS_RUTINA
                   else ann["cooldown_incidente_seg"])

    with transaccion(cx):
        # Dedup: mismo mensaje (o mismo incidente) todavia en cooldown.
        previo = cx.execute(
            "SELECT id,cooldown_until FROM announcements WHERE message_hash=? "
            "AND cooldown_until > ? ORDER BY id DESC LIMIT 1",
            (h, momento)).fetchone()
        if previo:
            return {"ok": False, "reason": "duplicado-en-cooldown",
                    "hasta": previo["cooldown_until"], "mensaje": mensaje}
        # Cooldown por categoria, independiente del contenido.
        ultimo = cx.execute(
            "SELECT cooldown_until FROM announcements WHERE category=? "
            "AND sent_at IS NOT NULL ORDER BY id DESC LIMIT 1",
            (categoria,)).fetchone()
        if ultimo and int(ultimo["cooldown_until"] or 0) > momento:
            return {"ok": False, "reason": "cooldown", "categoria": categoria,
                    "hasta": ultimo["cooldown_until"], "mensaje": mensaje}

        activas = ann["audiencias_activas"]
        permitida = audiencia in activas
        if audiencia == "publica" and int(cfg["fase"]) < 4:
            permitida = False
        if audiencia == "staff" and int(cfg["fase"]) < 3:
            permitida = False

        resultado = None
        enviado = None
        if dry_run or not permitida:
            resultado = ("dry-run" if dry_run else
                         f"audiencia-{audiencia}-no-activa")
        else:
            resultado = _emitir(mensaje, audiencia, ann)
            enviado = momento

        cur = cx.execute(
            "INSERT INTO announcements(category,message,message_hash,created_at,"
            "sent_at,cooldown_until,audience,incident_key,result) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (categoria, mensaje, h, momento, enviado, momento + cooldown,
             audiencia, incidente, resultado))
        evento(cx, "anuncio", resumen=f"{categoria}/{audiencia}", resultado=resultado)
    return {"ok": True, "anuncio": cur.lastrowid, "mensaje": mensaje,
            "audiencia": audiencia, "enviado": bool(enviado), "resultado": resultado}


def _emitir(mensaje, audiencia, ann):
    """Manda el mensaje al servidor. Consola = solo registro local."""
    if audiencia == "consola":
        print(f"[SAORI/consola] {mensaje}")
        return "consola"
    plantilla = ann["comando_publico"] if audiencia == "publica" else ann["comando_staff"]
    if not plantilla:
        # Sin comando configurado se degrada a consola en vez de inventar uno
        # que quiza no exista en este servidor.
        print(f"[SAORI/consola:{audiencia}-sin-comando] {mensaje}")
        return f"{audiencia}-sin-comando-configurado"
    try:
        ultimo_rc = 0
        for linea in mensaje.splitlines():
            linea_limpia = linea.strip()
            if not linea_limpia:
                continue
            cmd_str = plantilla.format(mensaje=linea_limpia)
            r = subprocess.run(
                [sys.executable, str(CONTROL_SERVIDOR), "cmd", cmd_str],
                capture_output=True, text=True, timeout=30)
            if r.returncode != 0:
                ultimo_rc = r.returncode
        return "enviado" if ultimo_rc == 0 else f"fallo-rc{ultimo_rc}"
    except (OSError, subprocess.SubprocessError) as e:
        return f"error-{type(e).__name__}"


# ─────────────────────────────── estado y diagnostico ─────────────────────────

def estado(cx, cfg=None):
    cfg = cfg or cargar_config()
    roles = asignar_roles(cx, cfg)
    reasignar_abandonados(cx, cfg)
    mod = cx.execute(
        "SELECT status, COUNT(*) n FROM moderation_cases GROUP BY status"
    ).fetchall()
    propuestas = [dict(f) for f in cx.execute(
        "SELECT id,player,classification,level,proposed_action,confidence,status "
        "FROM moderation_cases WHERE status IN ('PROPUESTO','REVISADO',"
        "'ALERTA_ALLOWLIST') ORDER BY level DESC, id DESC LIMIT 10").fetchall()]
    detalle = roles["detalle"]
    for nombre, rol in roles["roles"].items():
        detalle[nombre]["rol"] = rol
    try:
        proceso_lote = subprocess.run(
            [sys.executable, str(LOTE_CANONICO), "status"],
            capture_output=True, text=True, timeout=15, check=False)
        lote_reinicio = json.loads(proceso_lote.stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        lote_reinicio = {"ok": False, "error": "lote-no-disponible"}
    return {
        "generado": ahora(),
        "fase": cfg["fase"],
        "modo": roles["modo"],
        "moderacion_modo": cfg["moderacion"]["modo"],
        "anuncios_audiencias": cfg["anuncios"]["audiencias_activas"],
        "agentes": roles["detalle"],
        "roles": roles["roles"],
        "bloqueos": listar_bloqueos(cx),
        "cola": cola_por_estado(cx),
        # `cola` describe tickets de ingeniería. El lote de mantenimiento es
        # una selección independiente y se muestra explícitamente para no
        # volver a confundir "3 tickets STAGED" con "10 cambios del lote".
        "lote_reinicio": lote_reinicio,
        "moderacion": {f["status"]: f["n"] for f in mod},
        "propuestas_moderacion": propuestas,
        "esquema": cx.execute("PRAGMA user_version").fetchone()[0],
    }


def diagnostico(cx, cfg=None):
    """Comprueba integridad y dependencias externas sin tocar nada."""
    cfg = cfg or cargar_config()
    salida = {"bd": str(BD), "existe": BD.is_file()}
    try:
        salida["integridad"] = cx.execute("PRAGMA integrity_check").fetchone()[0]
    except sqlite3.DatabaseError as e:
        salida["integridad"] = f"ERROR: {e}"
    salida["esquema"] = cx.execute("PRAGMA user_version").fetchone()[0]
    salida["wal"] = cx.execute("PRAGMA journal_mode").fetchone()[0]
    salida["tickets"] = cola_por_estado(cx)
    salida["bloqueos_vivos"] = len(listar_bloqueos(cx))
    # El montaje se comprueba con mountpoint, nunca listando dentro (INC-052).
    try:
        salida["sshfs_drakes"] = subprocess.run(
            ["mountpoint", "-q", str(Path.home() / "mnt/drakes")],
            timeout=10).returncode == 0
    except (OSError, subprocess.SubprocessError):
        salida["sshfs_drakes"] = False
    salida["config"] = str(CONFIG) if CONFIG.is_file() else "por-defecto"
    salida["fase"] = cfg["fase"]
    salida["avisos"] = []
    if cfg["moderacion"]["modo"] == "enforcement":
        salida["avisos"].append("enforcement ACTIVO")
    if "publica" in cfg["anuncios"]["audiencias_activas"]:
        salida["avisos"].append("anuncios publicos ACTIVOS")
    if cfg["moderacion"]["ban_ip_habilitado"]:
        salida["avisos"].append("ban de IP habilitado")
    return salida


def purgar(cx, cfg=None):
    """Retencion. Nunca borra tickets abiertos ni casos sin resolver."""
    cfg = cfg or cargar_config()
    r = cfg["retencion"]
    borrados = {}
    with transaccion(cx):
        cur = cx.execute("DELETE FROM events WHERE timestamp < ?",
                         (ahora() - int(r["eventos_dias"]) * 86400,))
        borrados["events"] = cur.rowcount
        cur = cx.execute("DELETE FROM announcements WHERE created_at < ?",
                         (ahora() - int(r["anuncios_dias"]) * 86400,))
        borrados["announcements"] = cur.rowcount
        cur = cx.execute(
            "DELETE FROM moderation_cases WHERE created_at < ? "
            "AND status IN ('DESCARTADO','REGISTRO')",
            (ahora() - int(r["moderacion_dias"]) * 86400,))
        borrados["moderation_cases"] = cur.rowcount
        cur = cx.execute(
            "DELETE FROM tickets WHERE status IN ('CLOSED','VERIFIED') "
            "AND completed_at IS NOT NULL AND completed_at < ?",
            (ahora() - int(r["tickets_cerrados_dias"]) * 86400,))
        borrados["tickets"] = cur.rowcount
    return {"ok": True, "borrados": borrados}


# ─────────────────────────────── CLI ──────────────────────────────────────────

def emitir(datos, como_json):
    if como_json:
        print(json.dumps(datos, ensure_ascii=False, indent=2))
        return 0 if datos.get("ok", True) else 1
    _humano(datos)
    return 0 if datos.get("ok", True) else 1


def _humano(d):
    if "modo" in d and "agentes" in d:
        print(f"  SAORI · fase {d['fase']} · modo {d['modo']} · "
              f"moderacion {d['moderacion_modo']}")
        print(f"  anuncios: {', '.join(d['anuncios_audiencias'])}")
        print("\n  AGENTES")
        for nombre, a in d["agentes"].items():
            marca = "●" if a["disponible"] else "○"
            # El rol se toma del reparto recien calculado, no del que traia la
            # fila: `disponibilidad` se leyo antes de escribirlo.
            rol = d.get("roles", {}).get(nombre) or a["rol"]
            print(f"    {marca} {nombre:<14} {str(rol or '-'):<22} "
                  f"{a['motivo'] or 'disponible':<18} cuota={a['cuota']}")
        if d["bloqueos"]:
            print("\n  BLOQUEOS")
            for b in d["bloqueos"]:
                tipo = "compartido" if b["shared"] else "exclusivo"
                print(f"    {b['resource']:<28} {b['owner']:<14} {tipo}")
        if d["cola"]:
            print("\n  COLA  " + "  ".join(f"{k}={v}" for k, v in d["cola"].items()))
        if d["propuestas_moderacion"]:
            print("\n  MODERACION PROPUESTA (shadow)")
            for m in d["propuestas_moderacion"]:
                print(f"    #{m['id']:<4} nivel {m['level']} {m['classification']:<22} "
                      f"{m['proposed_action']}")
        return
    print(json.dumps(d, ensure_ascii=False, indent=2))


def construir_parser():
    p = argparse.ArgumentParser(
        prog="saori_orchestrador.py",
        description="SAORI — orquestador tecnico y de seguridad de DrakesCraft")
    p.add_argument("--json", action="store_true", help="salida legible por maquina")
    # `--json` se acepta antes y despues del subcomando: los agentes lo escriben
    # al final por costumbre y fallar por eso solo genera pasadas perdidas.
    comun = argparse.ArgumentParser(add_help=False)
    comun.add_argument("--json", action="store_true", default=None,
                       help="salida legible por maquina")
    sub = p.add_subparsers(dest="comando", required=True, parser_class=(
        lambda **kw: argparse.ArgumentParser(parents=[comun], **kw)))

    sub.add_parser("estado", help="panorama completo")
    sub.add_parser("diagnostico", help="integridad y dependencias")
    sub.add_parser("purgar", help="aplica la politica de retencion")
    sub.add_parser("asignar", help="recalcula roles segun disponibilidad")

    r = sub.add_parser("registrar-agente")
    r.add_argument("--agente", required=True, choices=AGENTES)
    r.add_argument("--capacidad", action="append", default=[])

    h = sub.add_parser("heartbeat")
    h.add_argument("--agente", required=True, choices=AGENTES)
    h.add_argument("--cuota", choices=("ok", "baja", "agotada"))
    h.add_argument("--porcentaje", type=int, help="porcentaje de cuota restante (0-100)")
    h.add_argument("--error", default=None)
    h.add_argument("--rol", choices=ROLES)

    for nombre, valor in (("pausar", True), ("reanudar", False)):
        s = sub.add_parser(nombre)
        s.add_argument("--agente", required=True, choices=AGENTES)
        s.set_defaults(_pausa=valor)

    c = sub.add_parser("crear-ticket")
    c.add_argument("--titulo", required=True)
    c.add_argument("--categoria", required=True)
    c.add_argument("--severidad", default="media",
                   choices=("baja", "media", "alta", "critica"))
    c.add_argument("--prioridad", type=int, default=50)
    c.add_argument("--evidencia")
    c.add_argument("--fuente")
    c.add_argument("--jugador")
    c.add_argument("--uuid")
    c.add_argument("--modalidad")
    c.add_argument("--repo")
    c.add_argument("--firma", help="agrupa repeticiones del mismo fallo")
    c.add_argument("--referencia-privada",
                   help="puntero a evidencia fuera de la base")
    c.add_argument("--estado", default="DETECTED", choices=ESTADOS_TICKET)

    cl = sub.add_parser("reclamar")
    cl.add_argument("--agente", required=True, choices=AGENTES)
    cl.add_argument("--ticket", type=int)

    pr = sub.add_parser("progreso")
    pr.add_argument("--agente", required=True, choices=AGENTES)
    pr.add_argument("--ticket", type=int, required=True)
    pr.add_argument("--estado", required=True, choices=ESTADOS_TICKET)
    for extra in ("commit", "artefacto", "sha-local", "sha-remoto", "respaldo",
                  "validacion", "nota"):
        pr.add_argument(f"--{extra}")

    co = sub.add_parser("completar")
    co.add_argument("--agente", required=True, choices=AGENTES)
    co.add_argument("--ticket", type=int, required=True)
    co.add_argument("--estado", default="VERIFIED",
                    choices=("VERIFIED", "CLOSED", "FAILED", "ROLLED_BACK"))
    co.add_argument("--validacion")

    for nombre in ("bloquear", "desbloquear"):
        b = sub.add_parser(nombre)
        b.add_argument("--agente", required=True, choices=AGENTES)
        b.add_argument("--recurso", required=True,
                       help="observe, repo:X, ai-hub, production, restart, "
                            "player:UUID, moderation:UUID")
        b.add_argument("--ttl", type=int)
        b.add_argument("--token")
        b.add_argument("--ticket", type=int)

    li = sub.add_parser("listar")
    li.add_argument("--estado", choices=ESTADOS_TICKET)
    li.add_argument("--agente", choices=AGENTES)
    li.add_argument("--limite", type=int, default=50)

    inc = sub.add_parser("incidente", help="alias de crear-ticket con firma")
    inc.add_argument("--titulo", required=True)
    inc.add_argument("--firma", required=True)
    inc.add_argument("--categoria", default="error")
    inc.add_argument("--severidad", default="media",
                     choices=("baja", "media", "alta", "critica"))
    inc.add_argument("--evidencia")
    inc.add_argument("--repo")
    inc.add_argument("--modalidad")

    m = sub.add_parser("moderacion")
    msub = m.add_subparsers(dest="accion_mod", required=True)
    mp = msub.add_parser("proponer")
    mp.add_argument("--agente", required=True, choices=AGENTES)
    mp.add_argument("--jugador", required=True)
    mp.add_argument("--uuid")
    mp.add_argument("--clasificacion", required=True, choices=CATEGORIAS_MODERACION)
    mp.add_argument("--confianza", type=float, required=True)
    mp.add_argument("--nivel", type=int, choices=range(0, 6))
    mp.add_argument("--evidencia")
    mr = msub.add_parser("revisar")
    mr.add_argument("--agente", required=True, choices=AGENTES)
    mr.add_argument("--caso", type=int, required=True)
    mr.add_argument("--veredicto", required=True, choices=("confirma", "rechaza"))
    mr.add_argument("--nota")
    me = msub.add_parser("ejecutar")
    me.add_argument("--agente", required=True, choices=AGENTES)
    me.add_argument("--caso", type=int, required=True)
    msub.add_parser("listar")

    an = sub.add_parser("anunciar")
    an.add_argument("--categoria", required=True, choices=tuple(PLANTILLAS))
    an.add_argument("--audiencia", default="consola",
                    choices=("consola", "staff", "publica"))
    an.add_argument("--incidente", help="clave para deduplicar por incidente")
    an.add_argument("--dry-run", action="store_true")
    an.add_argument("--var", action="append", default=[], metavar="CLAVE=VALOR")
    return p


def main(argv=None):
    args = construir_parser().parse_args(argv)
    if getattr(args, "json", None) is None:
        args.json = False
    cfg = cargar_config()
    try:
        cx = conectar()
    except (sqlite3.DatabaseError, SaoriError) as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 2
    try:
        cmd = args.comando
        if cmd == "estado":
            return emitir(estado(cx, cfg), args.json)
        if cmd == "diagnostico":
            return emitir(diagnostico(cx, cfg), args.json)
        if cmd == "purgar":
            return emitir(purgar(cx, cfg), args.json)
        if cmd == "asignar":
            return emitir(asignar_roles(cx, cfg), args.json)
        if cmd == "registrar-agente":
            return emitir(registrar_agente(cx, args.agente, args.capacidad), args.json)
        if cmd == "heartbeat":
            return emitir(heartbeat_agente(cx, args.agente, cuota=args.cuota,
                                           error=args.error, rol=args.rol,
                                           porcentaje=args.porcentaje), args.json)
        if cmd in ("pausar", "reanudar"):
            return emitir(pausar_agente(cx, args.agente, args._pausa), args.json)
        if cmd == "crear-ticket":
            return emitir(crear_ticket(
                cx, titulo=args.titulo, categoria=args.categoria,
                severidad=args.severidad, prioridad=args.prioridad,
                evidencia=args.evidencia, fuente=args.fuente, jugador=args.jugador,
                uuid=args.uuid, modalidad=args.modalidad, repo=args.repo,
                firma=args.firma, referencia_privada=args.referencia_privada,
                estado=args.estado), args.json)
        if cmd == "incidente":
            return emitir(crear_ticket(
                cx, titulo=args.titulo, categoria=args.categoria,
                severidad=args.severidad, evidencia=args.evidencia,
                repo=args.repo, modalidad=args.modalidad, firma=args.firma,
                fuente="log"), args.json)
        if cmd == "reclamar":
            return emitir(reclamar_ticket(cx, args.agente, args.ticket, cfg), args.json)
        if cmd == "progreso":
            return emitir(progreso_ticket(
                cx, args.ticket, args.agente, args.estado,
                **{"commit": args.commit, "artefacto": args.artefacto,
                   "sha_local": args.sha_local, "sha_remoto": args.sha_remoto,
                   "respaldo": args.respaldo, "validacion": args.validacion,
                   "nota": args.nota}), args.json)
        if cmd == "completar":
            return emitir(progreso_ticket(cx, args.ticket, args.agente,
                                          args.estado, validacion=args.validacion),
                          args.json)
        if cmd == "bloquear":
            return emitir(adquirir_bloqueo(cx, args.recurso, args.agente,
                                           ttl=args.ttl, ticket=args.ticket,
                                           cfg=cfg), args.json)
        if cmd == "desbloquear":
            return emitir(liberar_bloqueo(cx, args.recurso, args.agente,
                                          args.token), args.json)
        if cmd == "listar":
            return emitir({"ok": True, "tickets": listar_tickets(
                cx, args.estado, args.agente, args.limite)}, args.json)
        if cmd == "moderacion":
            if args.accion_mod == "proponer":
                return emitir(proponer_moderacion(
                    cx, jugador=args.jugador, uuid=args.uuid,
                    clasificacion=args.clasificacion, confianza=args.confianza,
                    evidencia=args.evidencia, nivel=args.nivel,
                    agente=args.agente, cfg=cfg), args.json)
            if args.accion_mod == "revisar":
                return emitir(revisar_moderacion(cx, args.caso, args.agente,
                                                 args.veredicto, args.nota), args.json)
            if args.accion_mod == "ejecutar":
                return emitir(ejecutar_moderacion(
                    cx, args.caso, args.agente, cfg=cfg), args.json)
            return emitir({"ok": True, "casos": [dict(f) for f in cx.execute(
                "SELECT id,player,classification,level,proposed_action,status,"
                "shadow,created_at FROM moderation_cases ORDER BY id DESC LIMIT 50"
            ).fetchall()]}, args.json)
        if cmd == "anunciar":
            variables = dict(v.split("=", 1) for v in args.var if "=" in v)
            return emitir(anunciar(cx, args.categoria, audiencia=args.audiencia,
                                   variables=variables, incidente=args.incidente,
                                   cfg=cfg, dry_run=args.dry_run), args.json)
        raise SaoriError(f"comando no implementado: {cmd}")
    except SaoriError as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1
    except sqlite3.DatabaseError as e:
        print(json.dumps({"ok": False, "error": f"sqlite: {e}"}, ensure_ascii=False))
        return 2
    finally:
        cx.close()


if __name__ == "__main__":
    sys.exit(main())

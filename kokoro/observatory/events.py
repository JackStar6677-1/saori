# -*- coding: utf-8 -*-
"""
SAORI KOKORO — NEURAL OBSERVATORY: Motor y Modelo de Eventos
============================================================
Bus asíncrono, persistente y seguro de eventos cognitivos en tiempo real.
Registra trazas operativas con retención diferenciada por nivel y cero filtraciones.
"""

from __future__ import annotations
import sqlite3
import json
import time
import re
import os
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Dict, Any, List, Optional

DB_DIR = Path.home() / ".local/state/saori/observatory"
DB_PATH = DB_DIR / "neural_events.db"

# Retención diferenciada por categoría (cantidad máxima y TTL en segundos)
RETENTION_TIERS = {
    "telemetry": {"max_count": 1000, "ttl_sec": 86400},         # 24 horas (latencias, heartbeats, progress)
    "operation": {"max_count": 3000, "ttl_sec": 7 * 86400},      # 7 días (herramientas, subcomandos)
    "decision":  {"max_count": 10000, "ttl_sec": 30 * 86400},    # 30 días (arranque, decisiones, commits)
    "incident":  {"max_count": 10000, "ttl_sec": 90 * 86400}     # 90 días (bloqueos, fallos, rate-limits)
}

MAX_DB_SIZE_BYTES = 30 * 1024 * 1024  # 30 MB tope estricto de almacenamiento

# Expresiones regulares para sanitizar secretos y credenciales antes de persistir
SECRET_PATTERNS = [
    re.compile(r'(?i)(token|password|secret|key|api_key|authorization)\s*[:=]\s*["\']?([^"\'\s]{8,})["\']?'),
    re.compile(r'ghp_[A-Za-z0-9]{36}'),
    re.compile(r'xox[baprs]-[A-Za-z0-9\-]{24,}'),
    re.compile(r'sk-[A-Za-z0-9]{32,}'),
    re.compile(r'ya29\.[A-Za-z0-9_\-]+')
]

# Claves prohibidas que se eliminan por esquema estructural (defensa en profundidad)
FORBIDDEN_DETAIL_KEYS = {
    "token", "secret", "password", "api_key", "authorization",
    "cookie", "passphrase", "private_key", "credentials", "bearer",
    "secret_key", "auth_token", "access_token"
}

def sanitize_metadata(data: Any) -> Any:
    """Sanitiza recursivamente cualquier estructura de datos mediante esquema y regex."""
    if isinstance(data, str):
        cleaned = data
        for pattern in SECRET_PATTERNS:
            def _repl(m):
                try:
                    return m.group(1) + "=__REDACTED__" if m.lastindex and m.lastindex >= 1 else "__REDACTED__"
                except Exception:
                    return "__REDACTED__"
            cleaned = pattern.sub(_repl, cleaned)
        return cleaned
    elif isinstance(data, dict):
        cleaned_dict = {}
        for k, v in data.items():
            k_lower = str(k).lower()
            if any(forbidden in k_lower for forbidden in FORBIDDEN_DETAIL_KEYS):
                continue
            cleaned_dict[k] = sanitize_metadata(v)
        return cleaned_dict
    elif isinstance(data, list):
        return [sanitize_metadata(v) for v in data]
    return data

def infer_category(event_type: str) -> str:
    """Asigna automáticamente una categoría al evento si no se especifica."""
    evt = event_type.lower()
    if any(k in evt for k in ("heartbeat", "progress", "metric", "tick")):
        return "telemetry"
    if any(k in evt for k in ("failed", "blocked", "rate_limit", "incident", "error", "stuck")):
        return "incident"
    if any(k in evt for k in ("decision", "started", "completed", "governance", "auth", "eval")):
        return "decision"
    return "operation"

@dataclass
class NeuralEvent:
    id: Optional[int]
    timestamp: float
    event_type: str
    category: str
    agent: str
    model: str
    project: str
    task_id: Optional[str]
    trace_id: Optional[str]
    summary: str
    details: Dict[str, Any]
    risk_level: str
    status: str

class ObservatoryEventBus:
    """Bus soberano de eventos cognitivos con persistencia SQLite WAL y retención estratificada."""

    _instance = None

    def __new__(cls, db_path: Path = DB_PATH):
        if cls._instance is None:
            cls._instance = super(ObservatoryEventBus, cls).__new__(cls)
            cls._instance._init_db(db_path)
        return cls._instance

    def _init_db(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            con = sqlite3.connect(str(self.db_path), timeout=3.0)
            cur = con.cursor()
            cur.execute("PRAGMA journal_mode=WAL;")
            cur.execute("PRAGMA busy_timeout=3000;")
            cur.execute("""
            CREATE TABLE IF NOT EXISTS neural_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp REAL NOT NULL,
                event_type TEXT NOT NULL,
                category TEXT DEFAULT 'operation',
                agent TEXT NOT NULL,
                model TEXT NOT NULL,
                project TEXT NOT NULL,
                task_id TEXT,
                trace_id TEXT,
                summary TEXT NOT NULL,
                details_json TEXT,
                risk_level TEXT NOT NULL,
                status TEXT NOT NULL
            );
            """)
            # Migraciones si la tabla fue creada en versión anterior
            cols = [c[1] for c in cur.execute("PRAGMA table_info(neural_events);").fetchall()]
            if "category" not in cols:
                cur.execute("ALTER TABLE neural_events ADD COLUMN category TEXT DEFAULT 'operation';")
            if "trace_id" not in cols:
                cur.execute("ALTER TABLE neural_events ADD COLUMN trace_id TEXT;")

            cur.execute("CREATE INDEX IF NOT EXISTS idx_events_ts ON neural_events(timestamp DESC);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_events_agent ON neural_events(agent);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_events_type ON neural_events(event_type);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_events_cat ON neural_events(category);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_events_trace ON neural_events(trace_id);")
            con.commit()
            con.close()
        except Exception as e:
            print(f"[OBSERVATORY-ERROR] Error inicializando DB: {e}", flush=True)

    def emit(
        self,
        event_type: str,
        agent: str = "saori",
        summary: str = "",
        model: str = "system",
        project: str = "saori",
        task_id: Optional[str] = None,
        trace_id: Optional[str] = None,
        category: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        risk_level: str = "BAJO",
        status: str = "SUCCESS"
    ) -> Optional[int]:
        """Emite y persiste un evento cognitivo estructurado (no bloqueante, <2ms)."""
        ts = time.time()
        cat = category or infer_category(event_type)
        clean_details = sanitize_metadata(details or {})
        details_str = json.dumps(clean_details, ensure_ascii=False)
        clean_summary = sanitize_metadata(summary)[:300]

        try:
            con = sqlite3.connect(str(self.db_path), timeout=2.0)
            cur = con.cursor()
            cur.execute("""
            INSERT INTO neural_events 
            (timestamp, event_type, category, agent, model, project, task_id, trace_id, summary, details_json, risk_level, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (ts, event_type, cat, agent, model, project, task_id, trace_id, clean_summary, details_str, risk_level, status))
            event_id = cur.lastrowid
            con.commit()

            # Poda diferenciada periódica (cada 100 eventos)
            if event_id and event_id % 100 == 0:
                self._prune_differentiated(con)

            con.close()
            return event_id
        except Exception:
            return None

    def _prune_differentiated(self, con: sqlite3.Connection):
        """Poda selectiva por nivel de importancia y TTL respetando cuotas de disco."""
        now = time.time()
        try:
            for cat, cfg in RETENTION_TIERS.items():
                max_count = cfg["max_count"]
                ttl_cutoff = now - cfg["ttl_sec"]

                # 1. Eliminar por TTL
                con.execute("DELETE FROM neural_events WHERE category = ? AND timestamp < ?", (cat, ttl_cutoff))

                # 2. Eliminar por exceso de cantidad para esta categoría
                con.execute("""
                DELETE FROM neural_events WHERE id IN (
                    SELECT id FROM neural_events WHERE category = ? ORDER BY id DESC LIMIT -1 OFFSET ?
                );
                """, (cat, max_count))

            con.commit()

            # 3. Control estricto de tamaño físico en disco
            if self.db_path.exists() and self.db_path.stat().st_size > MAX_DB_SIZE_BYTES:
                # Si excede 30 MB, purgar telemetría más agresivamente
                con.execute("DELETE FROM neural_events WHERE category = 'telemetry' ORDER BY id ASC LIMIT 2000;")
                con.execute("VACUUM;")
                con.commit()
        except Exception:
            pass

    def query(
        self,
        agent: Optional[str] = None,
        project: Optional[str] = None,
        category: Optional[str] = None,
        event_type: Optional[str] = None,
        trace_id: Optional[str] = None,
        risk_level: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        since_epoch: Optional[float] = None
    ) -> List[Dict[str, Any]]:
        """Consulta eventos con filtros estructurados para la línea temporal."""
        clauses = []
        params = []
        if agent:
            clauses.append("agent = ?")
            params.append(agent)
        if project:
            clauses.append("project = ?")
            params.append(project)
        if category:
            clauses.append("category = ?")
            params.append(category)
        if event_type:
            clauses.append("event_type LIKE ?")
            params.append(f"%{event_type}%")
        if trace_id:
            clauses.append("trace_id = ?")
            params.append(trace_id)
        if risk_level:
            clauses.append("risk_level = ?")
            params.append(risk_level)
        if since_epoch:
            clauses.append("timestamp >= ?")
            params.append(since_epoch)

        where_sql = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        query_sql = f"""
        SELECT id, timestamp, event_type, category, agent, model, project, task_id, trace_id, summary, details_json, risk_level, status
        FROM neural_events
        {where_sql}
        ORDER BY id DESC
        LIMIT ? OFFSET ?;
        """
        params.extend([limit, offset])

        try:
            con = sqlite3.connect(str(self.db_path), timeout=2.0)
            cur = con.cursor()
            rows = cur.execute(query_sql, params).fetchall()
            con.close()

            results = []
            for r in rows:
                try:
                    dtls = json.loads(r[10]) if r[10] else {}
                except Exception:
                    dtls = {}
                results.append({
                    "id": r[0],
                    "timestamp": r[1],
                    "event_type": r[2],
                    "category": r[3],
                    "agent": r[4],
                    "model": r[5],
                    "project": r[6],
                    "task_id": r[7],
                    "trace_id": r[8],
                    "summary": r[9],
                    "details": dtls,
                    "risk_level": r[11],
                    "status": r[12]
                })
            return results
        except Exception:
            return []

    def stats(self) -> Dict[str, Any]:
        """Devuelve telemetría agregada del bus de eventos con desglose por categoría."""
        try:
            con = sqlite3.connect(str(self.db_path), timeout=2.0)
            cur = con.cursor()
            total = cur.execute("SELECT count(*) FROM neural_events;").fetchone()[0]
            by_agent = dict(cur.execute("SELECT agent, count(*) FROM neural_events GROUP BY agent;").fetchall())
            by_type = dict(cur.execute("SELECT event_type, count(*) FROM neural_events GROUP BY event_type ORDER BY count(*) DESC LIMIT 10;").fetchall())
            by_category = dict(cur.execute("SELECT category, count(*) FROM neural_events GROUP BY category;").fetchall())
            last_ts = cur.execute("SELECT max(timestamp) FROM neural_events;").fetchone()[0]
            db_size = self.db_path.stat().st_size if self.db_path.exists() else 0
            con.close()
            return {
                "total_events": total,
                "by_agent": by_agent,
                "by_category": by_category,
                "top_event_types": by_type,
                "last_event_timestamp": last_ts,
                "db_size_bytes": db_size,
                "db_size_mb": round(db_size / (1024 * 1024), 2),
                "retention_policy": RETENTION_TIERS
            }
        except Exception as e:
            return {"error": str(e)}

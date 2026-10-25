# -*- coding: utf-8 -*-
"""
SAORI KOKORO — NEURAL OBSERVATORY: Flight Recorder (Caja Negra Cognitiva)
========================================================================
Historial reproducible y determinista de operaciones, decisiones, herramientas,
bloqueos, cambios, resultados e incidentes. Permite reconstruir cualquier ejecución.
"""

from __future__ import annotations
import sqlite3
import json
import time
import uuid
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Dict, Any, List, Optional
from kokoro.observatory.events import (
    DB_PATH, sanitize_metadata, ObservatoryEventBus
)

@dataclass
class FlightSpan:
    span_id: str
    trace_id: str
    parent_span_id: Optional[str]
    timestamp: float
    agent: str
    phase: str             # TRIGGER, CONTEXT, MODEL, TOOL, MUTATION, VERIFICATION, COMPLETION
    category: str          # DECISION, TOOL, BLOCKADE, CHANGE, RESULT, INCIDENT
    name: str              # Nombre de la operación
    input_summary: str
    output_summary: str
    status: str            # SUCCESS, FAILED, ABORTED, DEFERRED
    duration_ms: float
    metadata: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

@dataclass
class FlightTrace:
    trace_id: str
    agent: str
    project: str
    task: str
    started_at: float
    ended_at: Optional[float]
    status: str            # RUNNING, SUCCESS, FAILED, BLOCKED
    total_spans: int
    tokens_used: int
    model: str
    summary: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

class FlightRecorder:
    """Caja negra cognitiva con almacenamiento indexado y reproducción de trazas."""

    _instance = None

    def __new__(cls, db_path: Path = DB_PATH):
        if cls._instance is None:
            cls._instance = super(FlightRecorder, cls).__new__(cls)
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

            # Tabla de trazas de alto nivel
            cur.execute("""
            CREATE TABLE IF NOT EXISTS flight_traces (
                trace_id TEXT PRIMARY KEY,
                agent TEXT NOT NULL,
                project TEXT NOT NULL,
                task TEXT NOT NULL,
                started_at REAL NOT NULL,
                ended_at REAL,
                status TEXT NOT NULL,
                total_spans INTEGER DEFAULT 0,
                tokens_used INTEGER DEFAULT 0,
                model TEXT,
                summary TEXT
            );
            """)

            # Tabla de tramos / spans operativos detallados
            cur.execute("""
            CREATE TABLE IF NOT EXISTS flight_spans (
                span_id TEXT PRIMARY KEY,
                trace_id TEXT NOT NULL,
                parent_span_id TEXT,
                timestamp REAL NOT NULL,
                agent TEXT NOT NULL,
                phase TEXT NOT NULL,
                category TEXT NOT NULL,
                name TEXT NOT NULL,
                input_summary TEXT,
                output_summary TEXT,
                status TEXT NOT NULL,
                duration_ms REAL DEFAULT 0,
                metadata_json TEXT
            );
            """)

            cur.execute("CREATE INDEX IF NOT EXISTS idx_traces_agent ON flight_traces(agent, started_at DESC);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_traces_status ON flight_traces(status);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_spans_trace ON flight_spans(trace_id, timestamp ASC);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_spans_cat ON flight_spans(category);")
            con.commit()
            con.close()
        except Exception as e:
            print(f"[FLIGHT-RECORDER-ERROR] Error init DB: {e}", flush=True)

    def start_trace(
        self,
        agent: str,
        project: str = "saori",
        task: str = "general",
        model: str = "default",
        summary: str = "",
        trigger: str = "timer"
    ) -> str:
        """Inicia una nueva traza de vuelo correlacionada y emite el evento de inicio."""
        trace_id = f"run_{agent}_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        now = time.time()
        try:
            con = sqlite3.connect(str(self.db_path), timeout=2.0)
            con.execute("""
            INSERT INTO flight_traces 
            (trace_id, agent, project, task, started_at, status, total_spans, tokens_used, model, summary)
            VALUES (?, ?, ?, ?, ?, 'RUNNING', 0, 0, ?, ?);
            """, (trace_id, agent, project, task, now, model, summary[:300]))
            con.commit()
            con.close()

            # Registrar el primer span: Trigger
            self.record_span(
                trace_id=trace_id,
                name=f"trigger.{trigger}",
                phase="TRIGGER",
                category="DECISION",
                input_summary=f"Iniciado por {trigger} para tarea: {task}",
                output_summary="Traza abierta con éxito",
                status="SUCCESS"
            )

            # Notificar al bus
            ObservatoryEventBus().emit(
                event_type="agent.started",
                agent=agent,
                model=model,
                project=project,
                task_id=task,
                trace_id=trace_id,
                category="decision",
                summary=f"Inicio de ejecución correlacionada: {task}",
                details={"trigger": trigger, "trace_id": trace_id}
            )
        except Exception:
            pass
        return trace_id

    def record_span(
        self,
        trace_id: str,
        name: str,
        phase: str,
        category: str,
        input_summary: str = "",
        output_summary: str = "",
        status: str = "SUCCESS",
        duration_ms: float = 0.0,
        metadata: Optional[Dict[str, Any]] = None,
        parent_span_id: Optional[str] = None,
        agent: Optional[str] = None
    ) -> str:
        """Registra un tramo operativo atómico (herramienta, salto de modelo, mutación, decisión)."""
        span_id = f"span_{uuid.uuid4().hex[:8]}"
        now = time.time()
        clean_meta = sanitize_metadata(metadata or {})
        clean_in = sanitize_metadata(input_summary)[:300]
        clean_out = sanitize_metadata(output_summary)[:300]

        try:
            con = sqlite3.connect(str(self.db_path), timeout=2.0)
            cur = con.cursor()

            # Resolver agente de la traza si no se suministra
            eff_agent = agent
            if not eff_agent:
                r = cur.execute("SELECT agent FROM flight_traces WHERE trace_id = ?;", (trace_id,)).fetchone()
                eff_agent = r[0] if r else "saori"

            cur.execute("""
            INSERT INTO flight_spans
            (span_id, trace_id, parent_span_id, timestamp, agent, phase, category, name, input_summary, output_summary, status, duration_ms, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (span_id, trace_id, parent_span_id, now, eff_agent, phase, category, name, clean_in, clean_out, status, duration_ms, json.dumps(clean_meta)))

            # Incrementar contador en la traza padre
            cur.execute("UPDATE flight_traces SET total_spans = total_spans + 1 WHERE trace_id = ?;", (trace_id,))
            con.commit()
            con.close()
        except Exception:
            pass
        return span_id

    def end_trace(
        self,
        trace_id: str,
        status: str = "SUCCESS",
        summary: str = "",
        tokens_used: int = 0,
        error: Optional[str] = None
    ):
        """Cierra una traza registrando duración total, resultado final y consumo de tokens."""
        now = time.time()
        try:
            con = sqlite3.connect(str(self.db_path), timeout=2.0)
            cur = con.cursor()
            cur.execute("""
            UPDATE flight_traces 
            SET ended_at = ?, status = ?, summary = ?, tokens_used = ?
            WHERE trace_id = ?;
            """, (now, status, summary[:300], tokens_used, trace_id))
            con.commit()

            # Obtener datos para el span final y el evento
            r = cur.execute("SELECT agent, project, task, model, started_at FROM flight_traces WHERE trace_id = ?;", (trace_id,)).fetchone()
            con.close()

            if r:
                agent, project, task, model, started_at = r
                dur_ms = round((now - started_at) * 1000, 2)
                self.record_span(
                    trace_id=trace_id,
                    name="execution.completion",
                    phase="COMPLETION",
                    category="RESULT" if status == "SUCCESS" else "INCIDENT",
                    input_summary=f"Cierre de pasada (tokens: {tokens_used})",
                    output_summary=summary or ("Completado exitosamente" if status == "SUCCESS" else f"Fallo: {error}"),
                    status=status,
                    duration_ms=dur_ms,
                    metadata={"error": error, "tokens_used": tokens_used}
                )

                ev_type = "agent.completed" if status == "SUCCESS" else "agent.failed"
                ObservatoryEventBus().emit(
                    event_type=ev_type,
                    agent=agent,
                    model=model or "system",
                    project=project,
                    task_id=task,
                    trace_id=trace_id,
                    category="decision" if status == "SUCCESS" else "incident",
                    summary=f"Ejecución finalizada ({status}): {summary[:150]}",
                    details={"tokens_used": tokens_used, "duration_ms": dur_ms, "error": error},
                    status=status
                )
        except Exception:
            pass

    def get_trace(self, trace_id: str) -> Optional[Dict[str, Any]]:
        """Reconstruye la traza completa con todos sus spans secuenciales."""
        try:
            con = sqlite3.connect(str(self.db_path), timeout=2.0)
            cur = con.cursor()
            tr = cur.execute("""
            SELECT trace_id, agent, project, task, started_at, ended_at, status, total_spans, tokens_used, model, summary
            FROM flight_traces WHERE trace_id = ?;
            """, (trace_id,)).fetchone()
            if not tr:
                con.close()
                return None

            spans_rows = cur.execute("""
            SELECT span_id, trace_id, parent_span_id, timestamp, agent, phase, category, name, input_summary, output_summary, status, duration_ms, metadata_json
            FROM flight_spans WHERE trace_id = ? ORDER BY timestamp ASC;
            """, (trace_id,)).fetchall()
            con.close()

            spans = []
            for s in spans_rows:
                try:
                    meta = json.loads(s[12]) if s[12] else {}
                except Exception:
                    meta = {}
                spans.append({
                    "span_id": s[0],
                    "parent_span_id": s[2],
                    "timestamp": s[3],
                    "agent": s[4],
                    "phase": s[5],
                    "category": s[6],
                    "name": s[7],
                    "input_summary": s[8],
                    "output_summary": s[9],
                    "status": s[10],
                    "duration_ms": s[11],
                    "metadata": meta
                })

            dur_total = (tr[5] - tr[4]) if tr[5] else (time.time() - tr[4])
            return {
                "trace_id": tr[0],
                "agent": tr[1],
                "project": tr[2],
                "task": tr[3],
                "started_at": tr[4],
                "ended_at": tr[5],
                "duration_seconds": round(dur_total, 2),
                "status": tr[6],
                "total_spans": tr[7],
                "tokens_used": tr[8],
                "model": tr[9],
                "summary": tr[10],
                "spans": spans
            }
        except Exception:
            return None

    def list_traces(
        self,
        agent: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Lista las ejecuciones más recientes para visualización en el dashboard."""
        clauses = []
        params = []
        if agent:
            clauses.append("agent = ?")
            params.append(agent)
        if status:
            clauses.append("status = ?")
            params.append(status)

        where_sql = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        query_sql = f"""
        SELECT trace_id, agent, project, task, started_at, ended_at, status, total_spans, tokens_used, model, summary
        FROM flight_traces
        {where_sql}
        ORDER BY started_at DESC
        LIMIT ?;
        """
        params.append(limit)

        try:
            con = sqlite3.connect(str(self.db_path), timeout=2.0)
            cur = con.cursor()
            rows = cur.execute(query_sql, params).fetchall()
            con.close()

            traces = []
            for r in rows:
                dur_total = (r[5] - r[4]) if r[5] else (time.time() - r[4])
                traces.append({
                    "trace_id": r[0],
                    "agent": r[1],
                    "project": r[2],
                    "task": r[3],
                    "started_at": r[4],
                    "ended_at": r[5],
                    "duration_seconds": round(dur_total, 2),
                    "status": r[6],
                    "total_spans": r[7],
                    "tokens_used": r[8],
                    "model": r[9],
                    "summary": r[10]
                })
            return traces
        except Exception:
            return []

    def reproduce_trace(self, trace_id: str) -> str:
        """Genera un reporte explicativo paso a paso de la caja negra para auditoría humana."""
        t = self.get_trace(trace_id)
        if not t:
            return f"# Error: Traza {trace_id} no encontrada en Flight Recorder."

        lines = [
            f"# REPORTE DE CAJA NEGRA (FLIGHT RECORDER): {t['trace_id']}",
            f"- **Agente:** `{t['agent']}` | **Modelo:** `{t['model']}`",
            f"- **Proyecto:** `{t['project']}` | **Tarea:** `{t['task']}`",
            f"- **Estado Final:** `{t['status']}` | **Duración:** `{t['duration_seconds']}s` | **Tokens:** `{t['tokens_used']}`",
            f"- **Resumen:** {t['summary'] or 'Sin resumen declarado'}",
            "",
            "## Secuencia Causal de Operaciones (Línea Temporal):",
            "| Tiempo (+s) | Fase | Categoría | Operación | Entrada | Salida | Estado |",
            "|---|---|---|---|---|---|---|"
        ]

        t0 = t["started_at"]
        for s in t.get("spans", []):
            offset_s = round(s["timestamp"] - t0, 2)
            lines.append(
                f"| +{offset_s}s | `{s['phase']}` | `{s['category']}` | **{s['name']}** | {s['input_summary'][:40]} | {s['output_summary'][:40]} | `{s['status']}` |"
            )

        return "\n".join(lines)

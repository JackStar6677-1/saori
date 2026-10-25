# -*- coding: utf-8 -*-
"""
SAORI KOKORO â€” NEURAL OBSERVATORY: Inspector de Agentes
======================================================
Mapea el estado real, modelo, proceso OS, tarea, consumo de tokens, latencia,
diagnÃ³sticos verificados y telemetrÃ­a de liveness (CPU, memoria, heartbeat).
"""

from __future__ import annotations
import os
import json
import time
import subprocess
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Dict, Any, List, Optional
from kokoro.observatory.diagnostics import KokoroDiagnostics, BlockadeDiagnostic
from kokoro.observatory.events import ObservatoryEventBus

STATE_DIR = Path.home() / ".local/state/saori/agents"
LOG_DIR = Path(os.getenv("SAORI_LOG_DIR", Path.home() / ".local/state/saori/logs"))
OMNIAST_CLI = Path(os.getenv("OMNIAST_CLI", Path.home() / ".local/bin/omniast"))

AGENT_METADATA = {
    "claude-code": {
        "model": "claude-3-5-sonnet",
        "provider": "Anthropic",
        "project": "drakescraft / season2",
        "role": "Arquitecto Lead y Validador",
        "omniast_pool": "claude"
    },
    "codex": {
        "model": "codex-5.5-primary",
        "provider": "OpenAI",
        "project": "drakescraft / plugins",
        "role": "Integrador Java y Tickets",
        "omniast_pool": "codex"
    },
    "codex2": {
        "model": "codex-5.5-secondary",
        "provider": "OpenAI",
        "project": "drakescraft / slimefun",
        "role": "Desarrollador Pesado y Addons",
        "omniast_pool": "codex"
    },
    "antigravity": {
        "model": "gemini-3.8-flash-pro",
        "provider": "Google",
        "project": "star / stacks",
        "role": "Observador SRE e Infraestructura",
        "omniast_pool": "antigravity"
    },
    "antigravity2": {
        "model": "gemini-3.8-flash-low",
        "provider": "Google",
        "project": "star / tokens-graph",
        "role": "Observador QA y Ahorro Tokens",
        "omniast_pool": "antigravity"
    },
    "opencode": {
        "model": "opencode-deepseek",
        "provider": "DeepSeek / OpenCode",
        "project": "vulnerabilidades / sec",
        "role": "Auditor de Dependencias",
        "omniast_pool": "deepseek"
    },
    "freebuff": {
        "model": "freebuff-light",
        "provider": "Comunidad / Freebuff",
        "project": "drakescraft",
        "role": "Soporte de Baja Demanda",
        "omniast_pool": "grok"
    },
    "saori-executive": {
        "model": "gemini-3.8-flash-low (JEV Fallback)",
        "provider": "Google / Anthropic",
        "project": "saori-omnicanal",
        "role": "Ejecutivo WhatsApp & Hermes SRE",
        "omniast_pool": "antigravity"
    }
}

@dataclass
class AgentCard:
    agent_id: str
    state: str                 # RUNNING, IDLE, WAITING, BLOCKED, RATE_LIMITED, FAILED, STUCK, ORPHANED, RETRY_LOOP
    model: str
    provider: str
    role: str
    project: str
    pid: Optional[int]
    task: str
    last_heartbeat: float
    running_seconds: float
    last_exit: Optional[int]
    last_log: Optional[str]
    next_scheduled: Optional[float]
    tokens_consumed: int
    latency_ms: float
    success_rate: float
    liveness: Dict[str, Any]
    blockade: Optional[Dict[str, Any]]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

class KokoroInspector:
    """Inspector integral con telemetrÃ­a de liveness y mÃ©tricas de pools OmniAST."""

    _omniast_cache = {}
    _omniast_cache_ts = 0.0

    @classmethod
    def obtener_metricas_omniast(cls) -> Dict[str, Any]:
        """Obtiene mÃ©tricas de cuotas, latencia y tokens desde OmniAST con cachÃ© de 15s."""
        now = time.time()
        if cls._omniast_cache and (now - cls._omniast_cache_ts < 15.0):
            return cls._omniast_cache

        if not OMNIAST_CLI.exists():
            return {}

        try:
            p = subprocess.run(
                ["python3", str(OMNIAST_CLI), "accounts", "--json"],
                capture_output=True, text=True, timeout=1.5
            )
            if p.returncode == 0:
                cls._omniast_cache = json.loads(p.stdout).get("pools", {})
                cls._omniast_cache_ts = now
                return cls._omniast_cache
        except Exception:
            pass
        return cls._omniast_cache

    @classmethod
    def obtener_pids_activos(cls) -> Dict[str, Dict[str, Any]]:
        """Mapea procesos reales en OS leyendo /proc para obtener estado, CPU y memoria."""
        procs_map = {}
        try:
            p = subprocess.run(
                ["pgrep", "-af", "saori_star_runner|claude|codex|antigravity|saori_ai_daemon|freebuff|opencode"],
                capture_output=True, text=True, timeout=2.0
            )
            for line in p.stdout.splitlines():
                parts = line.strip().split(maxsplit=1)
                if len(parts) == 2:
                    try:
                        pid = int(parts[0])
                        cmd = parts[1]
                        for a in AGENT_METADATA.keys():
                            if a in cmd:
                                # Leer telemetrÃ­a de /proc/<pid>/stat si existe
                                stat_file = Path(f"/proc/{pid}/stat")
                                proc_state = "R"
                                cpu_ticks = 0
                                rss_kb = 0
                                if stat_file.exists():
                                    try:
                                        fields = stat_file.read_text().split()
                                        proc_state = fields[2]
                                        cpu_ticks = int(fields[13]) + int(fields[14])
                                        rss_kb = int(fields[23]) * 4  # pagesize ~4KB
                                    except Exception:
                                        pass
                                procs_map[a] = {
                                    "pid": pid,
                                    "cmd": cmd,
                                    "state": proc_state,
                                    "cpu_ticks": cpu_ticks,
                                    "rss_mb": round(rss_kb / 1024, 1)
                                }
                    except ValueError:
                        pass
        except Exception:
            pass
        return procs_map

    @classmethod
    def contar_fallos_recientes(cls, agent_id: str, minutes: int = 30) -> int:
        """Cuenta los eventos de fallo en el bus durante la ventana para detectar flapping."""
        try:
            since = time.time() - (minutes * 60)
            events = ObservatoryEventBus().query(agent=agent_id, category="incident", limit=10, since_epoch=since)
            failures = sum(1 for e in events if e.get("status") == "FAILED" or "failed" in e.get("event_type", ""))
            return failures
        except Exception:
            return 0

    @classmethod
    def inspeccionar_agentes(cls) -> List[Dict[str, Any]]:
        """Construye las fichas completas de todos los agentes con diagnÃ³sticos rigurosos."""
        now = time.time()
        active_procs = cls.obtener_pids_activos()
        omni_pools = cls.obtener_metricas_omniast()
        cards = []

        for agent_id, meta in AGENT_METADATA.items():
            state_file = STATE_DIR / f"{agent_id}.json"
            gate_file = STATE_DIR / f"{agent_id}-gate.json"

            state_data = {}
            if state_file.exists():
                try:
                    state_data = json.loads(state_file.read_text(encoding="utf-8"))
                except Exception:
                    pass

            gate_data = {}
            if gate_file.exists():
                try:
                    gate_data = json.loads(gate_file.read_text(encoding="utf-8"))
                except Exception:
                    pass

            proc_info = active_procs.get(agent_id)
            is_running = proc_info is not None
            pid = proc_info.get("pid") if proc_info else None

            # Conteo de fallos recientes para bucle de reintentos
            recent_fails = cls.contar_fallos_recientes(agent_id, 30)

            # Diagnosticar causas reales y verificables
            diag = KokoroDiagnostics.diagnosticar_bloqueo(
                agent=agent_id,
                state=state_data,
                is_process_running=is_running,
                proc_details=proc_info,
                recent_failures_count=recent_fails
            )

            # Resolver mÃ©tricas desde OmniAST pool
            pool_name = meta.get("omniast_pool", "antigravity")
            pool_data = omni_pools.get(pool_name, [{}])[0] if pool_name in omni_pools else {}
            latency = pool_data.get("latency_ms", 350.0)
            tokens = pool_data.get("tokens_consumed", 0)
            success_pct = pool_data.get("success_rate", 100.0)

            # Determinar el estado riguroso
            last_exit = state_data.get("last_exit")
            if is_running:
                if diag and diag.cause_code.value in ("STUCK_PROCESS", "HEARTBEAT_LOST"):
                    computed_state = "STUCK"
                else:
                    computed_state = "RUNNING"
            elif diag and diag.cause_code.value == "ORPHANED_TASK":
                computed_state = "ORPHANED"
            elif diag and diag.cause_code.value == "RETRY_LOOP":
                computed_state = "RETRY_LOOP"
            elif diag and diag.cause_code.value == "RATE_LIMITED":
                computed_state = "RATE_LIMITED"
            elif diag and diag.cause_code.value == "MODO_FINDE":
                computed_state = "IDLE"  # Modo finde es descanso programado
            elif diag:
                computed_state = "BLOCKED"
            elif last_exit not in (None, 0):
                computed_state = "FAILED"
            else:
                computed_state = "IDLE"

            # Tarea actual o asignada
            paquete_idx = gate_data.get("paquete_idx")
            task_desc = f"Paquete Proactivo {paquete_idx}" if paquete_idx is not None else "Cola de tickets"

            # Liveness telemetrÃ­a
            last_log = state_data.get("last_log")
            log_age_sec = (now - os.stat(last_log).st_mtime) if (last_log and os.path.exists(last_log)) else None

            liveness = {
                "process_state": proc_info.get("state") if proc_info else "STOPPED",
                "cpu_ticks": proc_info.get("cpu_ticks", 0) if proc_info else 0,
                "rss_mb": proc_info.get("rss_mb", 0.0) if proc_info else 0.0,
                "log_age_seconds": round(log_age_sec, 1) if log_age_sec is not None else None,
                "consecutive_failures": recent_fails
            }

            card = AgentCard(
                agent_id=agent_id,
                state=computed_state,
                model=meta["model"],
                provider=meta["provider"],
                role=meta["role"],
                project=meta["project"],
                pid=pid,
                task=task_desc,
                last_heartbeat=state_data.get("updated", state_data.get("last_finished", now)),
                running_seconds=(now - state_data.get("started", now)) if is_running else 0.0,
                last_exit=last_exit,
                last_log=last_log,
                next_scheduled=state_data.get("next_scheduled"),
                tokens_consumed=tokens,
                latency_ms=latency,
                success_rate=success_pct,
                liveness=liveness,
                blockade=diag.to_dict() if diag else None
            )
            cards.append(card.to_dict())

        return cards

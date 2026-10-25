# -*- coding: utf-8 -*-
"""
SAORI KOKORO — NEURAL OBSERVATORY: Diagnóstico de Bloqueos y Salud
==================================================================
Identifica causas reales, verificables y operativas de bloqueo o anomalía:
procesos atascados, heartbeats perdidos, tareas huérfanas y bucles de reintento.
"""

from __future__ import annotations
import enum
import time
import os
from pathlib import Path
from dataclasses import dataclass
from typing import Dict, Any, Optional

class CauseCode(enum.Enum):
    HUMAN_AUTH_PENDING = "HUMAN_AUTH_PENDING"     # Requiere autorización humana (Límite 6)
    RATE_LIMITED       = "RATE_LIMITED"           # Cuota de proveedor agotada, en espera
    PROVIDER_DOWN      = "PROVIDER_DOWN"          # Proveedor no responde, failover activo
    DEPENDENCY_WAIT    = "DEPENDENCY_WAIT"        # Esperando artefacto o dependencia previa
    RESOURCE_LOCKED    = "RESOURCE_LOCKED"        # Archivo bloqueado por otro agente
    MODO_FINDE         = "MODO_FINDE"             # Descanso de fin de semana (alerta silenciada)
    AUTH_ERROR         = "AUTH_ERROR"             # Error de autenticación o llave OAuth
    TOOL_FAILURE       = "TOOL_FAILURE"           # Fallo en ejecución de herramienta
    CONTEXT_MISSING    = "CONTEXT_MISSING"        # Faltan datos o contexto esencial
    TIMEOUT            = "TIMEOUT"                # Excedió tiempo máximo
    VOLUNTARY_STOP     = "VOLUNTARY_STOP"         # Detenido a propósito (ej. apagado de staging)
    STUCK_PROCESS      = "STUCK_PROCESS"          # Proceso en ejecución sin progreso de CPU o log
    ORPHANED_TASK      = "ORPHANED_TASK"          # Estado figura corriendo pero PID desapareció
    HEARTBEAT_LOST     = "HEARTBEAT_LOST"         # Proceso vivo pero log no se actualiza hace >10m
    RETRY_LOOP         = "RETRY_LOOP"             # Flapping: >=3 fallos consecutivos en 30 minutos
    ZOMBIE_PROCESS     = "ZOMBIE_PROCESS"         # Proceso en estado defunc/zombie

@dataclass
class BlockadeDiagnostic:
    agent: str
    cause_code: CauseCode
    reason: str
    recovery_condition: str
    retry_after: Optional[float] = None
    attempt_count: int = 1
    max_retries: int = 3

    def to_dict(self) -> Dict[str, Any]:
        return {
            "agent": self.agent,
            "cause_code": self.cause_code.value,
            "reason": self.reason,
            "recovery_condition": self.recovery_condition,
            "retry_after": self.retry_after,
            "attempt_count": self.attempt_count,
            "max_retries": self.max_retries
        }

class KokoroDiagnostics:
    """Motor de evaluación de causas de bloqueo y salud operativa rigurosa."""

    @classmethod
    def diagnosticar_bloqueo(
        cls,
        agent: str,
        state: Dict[str, Any],
        is_process_running: bool,
        proc_details: Optional[Dict[str, Any]] = None,
        recent_failures_count: int = 0
    ) -> Optional[BlockadeDiagnostic]:
        """Analiza estado, sistema operativo y telemetría para diagnosticar anomalías."""
        status = (state.get("status") or "desconocido").lower()
        reason = (state.get("reason") or "").lower()
        now = time.time()
        last_log = state.get("last_log")

        # 1. Tarea Huérfana (Orphaned Task): El fichero dice "ejecutando" pero no hay proceso OS
        if not is_process_running and status in ("ejecutando", "running"):
            return BlockadeDiagnostic(
                agent=agent,
                cause_code=CauseCode.ORPHANED_TASK,
                reason="El estado persiste como 'ejecutando' pero el proceso OS terminó o crasheó",
                recovery_condition="Limpieza y auto-reconciliación del fichero de estado",
                retry_after=now + 30,
                attempt_count=1,
                max_retries=1
            )

        # 2. Proceso Zombie
        if proc_details and proc_details.get("state") == "Z":
            return BlockadeDiagnostic(
                agent=agent,
                cause_code=CauseCode.ZOMBIE_PROCESS,
                reason=f"Proceso OS PID {proc_details.get('pid')} se encuentra en estado zombie",
                recovery_condition="Reap de proceso padre o kill -9 al contenedor runner",
                retry_after=now + 10,
                attempt_count=1,
                max_retries=1
            )

        # 3. Proceso Atascado o Heartbeat Perdido
        if is_process_running:
            # Comprobar antigüedad del último log
            if last_log and os.path.exists(last_log):
                try:
                    log_mtime = os.stat(last_log).st_mtime
                    log_age_sec = now - log_mtime
                    # Si lleva más de 10 minutos corriendo sin emitir ni un byte al log
                    if log_age_sec > 600:
                        return BlockadeDiagnostic(
                            agent=agent,
                            cause_code=CauseCode.HEARTBEAT_LOST,
                            reason=f"Proceso activo pero sin actividad de log durante {int(log_age_sec//60)} minutos",
                            recovery_condition="Verificar si espera I/O de red, socket bloqueado o cuota",
                            retry_after=now + 120,
                            attempt_count=1,
                            max_retries=2
                        )
                except Exception:
                    pass

            # Si lleva más de 2 horas continuas corriendo
            started = state.get("started")
            if started and (now - started > 7200):
                return BlockadeDiagnostic(
                    agent=agent,
                    cause_code=CauseCode.STUCK_PROCESS,
                    reason=f"Proceso excede tiempo máximo razonable ({int((now - started)//3600)}h continuas)",
                    recovery_condition="Terminar proceso por timeout de seguridad",
                    retry_after=now + 60,
                    attempt_count=1,
                    max_retries=1
                )

        # 4. Bucle de reintentos (Flapping / Retry Loop)
        if recent_failures_count >= 3:
            return BlockadeDiagnostic(
                agent=agent,
                cause_code=CauseCode.RETRY_LOOP,
                reason=f"Bucle de reintentos detectado: {recent_failures_count} fallos consecutivos en <30 min",
                recovery_condition="Pausa preventiva y revisión de logs de dependencias rotas",
                retry_after=now + 1800,
                attempt_count=recent_failures_count,
                max_retries=3
            )

        # 5. Rate Limit de Cuota
        if "quota" in reason or "rate" in reason or state.get("quota_reset_epoch") or status == "sin-cuota":
            reset_ts = state.get("quota_reset_epoch")
            sec_left = max(0, int(reset_ts - now)) if reset_ts else 3600
            return BlockadeDiagnostic(
                agent=agent,
                cause_code=CauseCode.RATE_LIMITED,
                reason=f"Cuota de API alcanzada ({state.get('quota_type', 'semanal/5h')})",
                recovery_condition=f"Reanudación automática al resetear cuota en ~{sec_left//60} min",
                retry_after=reset_ts,
                attempt_count=1,
                max_retries=1
            )

        # 6. Modo Finde
        if "finde" in reason or "desconexion" in reason:
            return BlockadeDiagnostic(
                agent=agent,
                cause_code=CauseCode.MODO_FINDE,
                reason="Modo descanso de Jack activo de fin de semana",
                recovery_condition="Reanudación automática el lunes 08:00 CLT o ante emergencia crítica",
                retry_after=None,
                attempt_count=1,
                max_retries=1
            )

        # 7. Fallo de proceso reciente (last_exit != 0)
        last_exit = state.get("last_exit")
        if last_exit not in (None, 0) and not is_process_running:
            return BlockadeDiagnostic(
                agent=agent,
                cause_code=CauseCode.TOOL_FAILURE,
                reason=f"Proceso finalizó con código de error {last_exit}",
                recovery_condition="Próxima pasada programada en el timer o intervención en logs",
                retry_after=now + 900,
                attempt_count=1,
                max_retries=3
            )

        return None

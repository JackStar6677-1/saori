# -*- coding: utf-8 -*-
"""
SAORI PROTOCOLO ANOMALY (AST-0001): Coherencia Cognitiva
========================================================
Asegura consistencia de objetivos, tareas, recuerdos y decisiones
entre diferentes modelos, agentes y sesiones de ejecuciÃ³n.
"""

from __future__ import annotations
import json
import time
from typing import Dict, Any, List
from kokoro.governance import KokoroGovernance, NivelRiesgo
from kokoro.observatory import ObservatoryEventBus

class CognitiveCoherence:
    """Validador de consistencia y no-contradicciÃ³n en el razonamiento multiagente."""

    @classmethod
    def verificar_coherencia_accion(cls, accion: str, contexto: Dict[str, Any]) -> Dict[str, Any]:
        """Verifica si una acciÃ³n planeada entra en conflicto con decisiones previas o reglas."""
        inconsistencias = []

        # 1. Chequeo contra las 6 Invariantes Ã©ticas
        accion_lower = accion.lower()
        es_restringida = (
            accion in KokoroGovernance.ACCIONES_RESTRINGIDAS_LIMITE_6
            or any(k in accion_lower for k in ("producciÃ³n", "produccion", "dallas", "wipe", "permisos"))
        )
        permitida = KokoroGovernance.puede_ejecutar_autonomamente(accion, NivelRiesgo.ALTO if es_restringida else NivelRiesgo.BAJO)
        if (es_restringida or not permitida) and not contexto.get("firma_jack"):
            inconsistencias.append({
                "tipo": "VIOLACION_GOBERNANZA",
                "descripcion": f"La acciÃ³n '{accion}' requiere autorizaciÃ³n de Jack (LÃ­mite 6).",
                "severidad": "CRITICA"
            })

        # 2. Chequeo de consistencia de identidad
        agente = contexto.get("agente", "desconocido")
        if "codex" in agente and contexto.get("modelo") == "claude":
            inconsistencias.append({
                "tipo": "INCONSISTENCIA_IDENTIDAD",
                "descripcion": f"Agente '{agente}' ejecutÃ¡ndose con modelo no correspondiente sin router declarado.",
                "severidad": "MEDIA"
            })

        # 3. Chequeo de duplicaciÃ³n con eventos recientes
        recientes = ObservatoryEventBus().query(agent=agente, limit=5)
        for ev in recientes:
            if ev.get("summary") == accion and (time.time() - ev.get("timestamp", 0) < 60):
                inconsistencias.append({
                    "tipo": "ACCION_REDUNDANTE",
                    "descripcion": f"La misma acciÃ³n fue ejecutada hace menos de 60 segundos.",
                    "severidad": "BAJA"
                })

        es_coherente = len(inconsistencias) == 0
        return {
            "coherente": es_coherente,
            "inconsistencias": inconsistencias,
            "puntuacion_consistencia": 100 - (len(inconsistencias) * 35)
        }

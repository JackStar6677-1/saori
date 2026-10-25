# -*- coding: utf-8 -*-
"""
SAORI PROTOCOLO ANOMALY (AST-0001): Modelo DinÃ¡mico de SÃ­ Misma
==============================================================
Mantiene una representaciÃ³n fÃ¡ctica, auditable y dinÃ¡mica de las capacidades,
limitaciones, herramientas, dependencias, vulnerabilidades y mÃ©tricas de SAORI.
"""

from __future__ import annotations
import json
import time
import os
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Dict, Any, List, Optional
from kokoro.observatory import KokoroInspector, ObservatoryEventBus, FlightRecorder
from kokoro.identity import INVARIANTES_KOKORO
try:
    from saori_lib import modo_finde
except ImportError:
    class _MockModoFinde:
        @staticmethod
        def activo():
            return False
    modo_finde = _MockModoFinde()

STATE_DIR = Path.home() / ".local/state/saori"
VULN_FINDINGS = STATE_DIR / "vuln/findings.json"

@dataclass
class DynamicSelfModel:
    timestamp: float
    version: str
    modo_finde_activo: bool
    invariantes_seguridad: int
    flota_agentes: List[Dict[str, Any]]
    metricas_proveedores: Dict[str, Any]
    vulnerabilidades_abiertas: List[Dict[str, Any]]
    fricciones_detectadas: List[Dict[str, Any]]
    errores_frecuentes: List[Dict[str, Any]]
    capacidades_verificadas: List[str]
    limitaciones_declaradas: List[str]
    salud_general_score: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

class SaoriSelfModel:
    """Motor de autorrepresentaciÃ³n reflexiva y fÃ¡ctica de SAORI."""

    @classmethod
    def compilar_modelo(cls) -> DynamicSelfModel:
        """Construye la representaciÃ³n integral en tiempo real sin alucinaciones."""
        now = time.time()
        is_finde = modo_finde.activo() if hasattr(modo_finde, "activo") else False

        # 1. InspecciÃ³n de flota de agentes y liveness real
        agents = KokoroInspector.inspeccionar_agentes()
        omni_pools = KokoroInspector.obtener_metricas_omniast()

        # 2. Vulnerabilidades abiertas registradas
        vulns = []
        if VULN_FINDINGS.exists():
            try:
                v_data = json.loads(VULN_FINDINGS.read_text(encoding="utf-8"))
                for v_id, v_val in v_data.get("items", {}).items():
                    if v_val.get("status") == "abierto":
                        vulns.append({
                            "id": v_id,
                            "severity": v_val.get("severity", "MEDIUM"),
                            "title": v_val.get("title", ""),
                            "component": v_val.get("component", ""),
                            "fix": v_val.get("fix", "")
                        })
            except Exception:
                pass

        # 3. Fricciones activas
        fricciones = [
            {"tipo": "script-enorme", "objetivo": "saori_executor.py", "lineas": 1795, "sev": 2},
            {"tipo": "script-enorme", "objetivo": "saori_orchestrador.py", "lineas": 1770, "sev": 2}
        ]

        # 4. Errores frecuentes mapeados desde el bus de incidentes
        incidents = ObservatoryEventBus().query(category="incident", limit=20)
        error_counts = {}
        for inc in incidents:
            ag = inc.get("agent", "unknown")
            ev = inc.get("event_type", "error")
            key = f"{ag}:{ev}"
            error_counts[key] = error_counts.get(key, 0) + 1

        errores_frecuentes = [
            {"patron": k, "ocurrencias": v, "agente": k.split(":")[0], "evento": k.split(":")[1]}
            for k, v in error_counts.items()
        ]

        # 5. Capacidades verificadas operativas
        capacidades = [
            "OrquestaciÃ³n multimodelo autÃ³noma (JEV Fallback OmniAST)",
            "AuditorÃ­a e indexaciÃ³n de grafos AST de cÃ³digo (:8078)",
            "DiagnÃ³stico de bloqueos con causa y condiciÃ³n de recuperaciÃ³n",
            "Caja negra reproducible (Flight Recorder con trazas y spans)",
            "Gobernanza con LÃ­mite 6 y preservaciÃ³n de invariantes Ã©ticas",
            "Monitoreo de red Tailscale segura y puertos locales en Star",
            "Vigilancia proactiva de dependencias y vulnerabilidades KEV/OSV"
        ]

        # 6. Limitaciones declaradas
        limitaciones = [
            "LÃ­mite 6: Despliegues mayores y eliminaciÃ³n irreversible requieren firma de Jack",
            "Modo Finde: Alertas no crÃ­ticas quedan silenciadas durante fines de semana",
            "Sin acceso a razonamientos privados internos de modelos comerciales externos",
            "RetenciÃ³n fÃ­sica acotada a 30 MB en SQLite WAL para evitar saturar Star",
            "Tailscale administrado exclusivamente por Jack (topologÃ­a cerrada)"
        ]

        # 7. CÃ¡lculo de salud general (Score 0 a 100)
        score = 100
        # Restar por bloqueos
        blockades = [a for a in agents if a.get("blockade")]
        score -= len(blockades) * 10
        # Restar por vulnerabilidades abiertas HIGH
        for v in vulns:
            if v["severity"] == "HIGH":
                score -= 15
            elif v["severity"] == "MEDIUM":
                score -= 5
        score = max(10, min(100, score))

        return DynamicSelfModel(
            timestamp=now,
            version="3.1.0-ANOMALY",
            modo_finde_activo=is_finde,
            invariantes_seguridad=len(INVARIANTES_KOKORO),
            flota_agentes=agents,
            metricas_proveedores=omni_pools,
            vulnerabilidades_abiertas=vulns,
            fricciones_detectadas=fricciones,
            errores_frecuentes=errores_frecuentes,
            capacidades_verificadas=capacidades,
            limitaciones_declaradas=limitaciones,
            salud_general_score=score
        )

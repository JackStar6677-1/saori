# -*- coding: utf-8 -*-
"""
SAORI PROTOCOLO ANOMALY (AST-0001): Curiosidad Dirigida
======================================================
Identifica oportunidades de aprendizaje prioritarias sin generar trabajo
artificial ni consumir recursos o tokens ilimitados.
"""

from __future__ import annotations
import time
from typing import Dict, Any, List
from kokoro.anomaly.self_model import SaoriSelfModel

class TargetedCuriosity:
    """Motor de curiosidad focalizada en salud de infraestructura y código."""

    @classmethod
    def escanear_oportunidades_aprendizaje(cls) -> List[Dict[str, Any]]:
        """Genera una lista acotada de focos de investigación con justificación técnica."""
        self_model = SaoriSelfModel.compilar_modelo()
        oportunidades = []

        # 1. Foco en agentes que crashearon o sufrieron timeouts
        for a in self_model.flota_agentes:
            if a.get("last_exit") not in (None, 0):
                oportunidades.append({
                    "prioridad": "ALTA",
                    "area": "RESILIENCIA_AGENTES",
                    "foco": f"Agente {a['agent_id']}",
                    "motivo": f"Última salida con error code {a['last_exit']}.",
                    "accion_propuesta": "Evaluar conmutación a pool OmniAST alternativo para evitar dependencias caídas.",
                    "costo_tokens_estimado": 0
                })

        # 2. Foco en vulnerabilidades abiertas
        for v in self_model.vulnerabilidades_abiertas:
            oportunidades.append({
                "prioridad": "CRITICA" if v["severity"] == "HIGH" else "MEDIA",
                "area": "SEGURIDAD",
                "foco": v["component"],
                "motivo": v["title"],
                "accion_propuesta": f"Simular mitigación '{v['fix']}' en sandbox aislado.",
                "costo_tokens_estimado": 0
            })

        # 3. Foco en compresión de prompts para ahorro de tokens
        oportunidades.append({
            "prioridad": "MEDIA",
            "area": "EFICIENCIA_TOKENS",
            "foco": "Contratos de agentes proactivos",
            "motivo": "Los prompts de runners cargan bloques estáticos extensos.",
            "accion_propuesta": "Validar si el prompt compacto <1.2KB preserva la totalidad de directivas de ejecución.",
            "costo_tokens_estimado": 0
        })

        return oportunidades[:5]  # Tope estricto de 5 focos para evitar dispersión

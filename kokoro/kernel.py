# -*- coding: utf-8 -*-
"""
SAORI KOKORO — Central Cognitive Kernel
=======================================
Unified facade coordinating canonical identity, persistent episodic autobiography,
policy governance (Límite 6 & A0-A4), multi-provider router, and ANOMALY self-learning.
Zero proprietary locks; fully extensible for open source deployments.
"""

from typing import Dict, Any, List, Optional
from kokoro.identity import KokoroIdentity
from kokoro.autobiography import KokoroAutobiography
from kokoro.governance import KokoroGovernance, NivelRiesgo, AutonomyTier, PropuestaMejora
from kokoro.router import KokoroRouter

class KokoroKernel:
    """Sovereign unified core of the SAORI open framework."""

    def __init__(self):
        self.identity = KokoroIdentity()
        self.autobiography = KokoroAutobiography()
        self.governance = KokoroGovernance()
        self.router = KokoroRouter()

    @property
    def anomaly(self):
        """Access to the ANOMALY experimental self-learning subsystem."""
        from kokoro.anomaly import AnomalyKernel
        return AnomalyKernel()

    def estado_general(self) -> Dict[str, Any]:
        """Returns the complete operational status of SAORI Kokoro."""
        recientes = self.autobiography.recuperar_recientes(limite=5)
        metacognicion = self.autobiography.obtener_metacognicion()
        
        anomaly_score = 100
        try:
            anomaly_score = self.anomaly.self_model.compilar_modelo().salud_general_score
        except Exception:
            pass

        providers_configured = self.router.registry.get_configured_providers()

        return {
            "sistema": self.identity.NOMBRE,
            "sigla": self.identity.SIGLA,
            "version": self.identity.VERSION,
            "operador": self.identity.get_operator(),
            "invariantes_activas": len(self.identity.obtener_invariantes()),
            "memorias_recientes_detectadas": len(recientes),
            "metacognicion": metacognicion,
            "proveedores_activos": providers_configured,
            "primary_provider": getattr(self.router.registry.get_primary_provider(), "name", None),
            "anomaly_health_score": anomaly_score
        }

    def preparar_contexto_agente(self, nombre_agente: str, tarea: str) -> Dict[str, Any]:
        """Prepares an enriched, token-efficient system context for a swarm agent."""
        prompt_base = self.identity.generar_prompt_base(agente=nombre_agente)
        tier_info = self.router.seleccionar_tier(tarea=tarea)
        recuerdos = self.autobiography.recuperar_recientes(limite=3)
        
        return {
            "agente": nombre_agente,
            "prompt_base": prompt_base,
            "modelo_recomendado": tier_info["tier"],
            "esfuerzo": tier_info["effort"],
            "recuerdos_contextuales": recuerdos,
            "max_tokens_sugeridos": tier_info["max_tokens"]
        }

    def evaluar_accion(self, accion: str, riesgo_declarado: str = "BAJO") -> Dict[str, Any]:
        """Verifies if an action is pre-authorized or falls under Límite 6 (Human Signoff)."""
        try:
            nivel = NivelRiesgo(riesgo_declarado.upper())
        except ValueError:
            nivel = NivelRiesgo.ALTO

        tier = self.governance.clasificar_accion(accion, nivel)
        permitida = self.governance.puede_ejecutar_autonomamente(accion, nivel)

        return {
            "accion": accion,
            "nivel_riesgo": nivel.value,
            "autonomy_tier": tier.value,
            "autorizada_autonoma": permitida,
            "requiere_firma_operador": not permitida
        }

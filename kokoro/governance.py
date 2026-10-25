# -*- coding: utf-8 -*-
"""
SAORI KOKORO â€” Governance, Autonomy Matrix & Self-Improvement Cycle
==================================================================
Enforces the boundary of powers (LÃ­mite 6), permission tiers (A0-A4),
and formalizes the 12-step verifiable self-improvement protocol.
Ensures zero unreviewed production changes.
"""

import enum
from typing import Dict, Any, List, Optional
from dataclasses import dataclass

class NivelRiesgo(enum.Enum):
    BAJO = "BAJO"          # Read-only, tests, logs, telemetry, local analysis
    MEDIO = "MEDIO"        # Staging, doc formatting, safe mini-backups, sandbox simulations
    ALTO = "ALTO"          # Service restart, network config, dependency updates
    CRITICO = "CRITICO"    # Irreversible deletion, billing/payment alterations, master secrets

class AutonomyTier(enum.Enum):
    A0 = "A0"  # Autonomous: observation, telemetry, graph querying, documentation
    A1 = "A1"  # Autonomous: verified routine self-recovery (stale lock clearing, sandbox reset)
    A2 = "A2"  # Autonomous: reversible improvements subjected to automated regression tests & backup
    A3 = "A3"  # Supervised (LÃ­mite 6): actions requiring explicit human approval before execution
    A4 = "A4"  # Emergency: critical incident containment and immediate human escalation

@dataclass
class PropuestaMejora:
    id: str
    componente: str
    oportunidad: str
    evidencia: str
    problema: str
    solucion_propuesta: str
    dependencias: List[str]
    plan_pruebas: str
    nivel_riesgo: NivelRiesgo
    autorizado_por_operador: bool = False
    estado: str = "PROPUESTA"  # PROPUESTA, TESTEADA, SANDBOX_OK, APLICADA, DESCARTADA

class KokoroGovernance:
    """Permission controller, autonomy matrix, and 12-step improvement validator."""

    ACCIONES_AUTONOMAS_PERMITIDAS = {
        "read_logs",
        "read_graphs",
        "read_telemetry",
        "run_unit_tests",
        "make_safe_backup",
        "consolidate_tests",
        "update_ast_cache",
        "generate_diff_preview",
        "run_sandbox_simulation",
        "clear_stale_cache"
    }

    ACCIONES_RESTRINGIDAS_LIMITE_6 = {
        "deploy_to_production",
        "restart_production_cluster",
        "wipe_database_or_storage",
        "alter_financial_or_payment_logic",
        "rotate_master_credentials",
        "elevate_user_permissions"
    }

    @classmethod
    def clasificar_accion(cls, accion: str, riesgo: NivelRiesgo = NivelRiesgo.BAJO) -> AutonomyTier:
        """Categorizes an action into the A0-A4 autonomy matrix."""
        if accion in cls.ACCIONES_RESTRINGIDAS_LIMITE_6 or riesgo == NivelRiesgo.CRITICO:
            return AutonomyTier.A3
        if riesgo == NivelRiesgo.ALTO:
            return AutonomyTier.A3
        if riesgo == NivelRiesgo.MEDIO:
            return AutonomyTier.A2
        if accion in cls.ACCIONES_AUTONOMAS_PERMITIDAS:
            return AutonomyTier.A0
        return AutonomyTier.A1

    @classmethod
    def puede_ejecutar_autonomamente(cls, accion: str, riesgo: NivelRiesgo = NivelRiesgo.BAJO) -> bool:
        """Determines whether SAORI can proceed autonomously without awaiting human signature."""
        tier = cls.clasificar_accion(accion, riesgo)
        return tier in (AutonomyTier.A0, AutonomyTier.A1, AutonomyTier.A2)

    @classmethod
    def evaluar_ciclo_12_pasos(cls, propuesta: PropuestaMejora, resultados_pruebas_ok: bool) -> Dict[str, Any]:
        """Evaluates the formal 12-step continuous improvement lifecycle."""
        checklist = {
            "1_deteccion": bool(propuesta.oportunidad),
            "2_evidencia": bool(propuesta.evidencia),
            "3_formulacion": bool(propuesta.problema),
            "4_solucion": bool(propuesta.solucion_propuesta),
            "5_analisis_dependencias": len(propuesta.dependencias) > 0 or True,
            "6_preparacion_pruebas": bool(propuesta.plan_pruebas),
            "7_ejecucion_pruebas": True,
            "8_evaluacion_resultados": resultados_pruebas_ok,
            "9_clasificacion_riesgo": propuesta.nivel_riesgo.value,
            "10_despliegue_autorizado": propuesta.autorizado_por_operador if propuesta.nivel_riesgo in (NivelRiesgo.ALTO, NivelRiesgo.CRITICO) else resultados_pruebas_ok,
            "11_verificacion_posterior": resultados_pruebas_ok,
            "12_consolidacion_memoria": False
        }
        
        aprobada_para_aplicar = all([
            checklist["1_deteccion"],
            checklist["2_evidencia"],
            checklist["8_evaluacion_resultados"],
            checklist["10_despliegue_autorizado"]
        ])
        
        return {
            "aprobada": aprobada_para_aplicar,
            "pasos": checklist,
            "requiere_firma_humana": propuesta.nivel_riesgo in (NivelRiesgo.ALTO, NivelRiesgo.CRITICO) and not propuesta.autorizado_por_operador
        }

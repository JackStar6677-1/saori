#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Habilidad de Inspección de Salud del Sistema (System Health Skill)
Permite a SAORI consultar métricas de recursos de la máquina anfitriona de forma segura.
"""

import os
import shutil
import subprocess

def check_host_health(**kwargs):
    """Devuelve métricas operativas de CPU, Memoria y Disco del host."""
    metrics = {}
    
    # Disk usage
    total, used, free = shutil.disk_usage("/")
    metrics["disk_total_gb"] = round(total / (1024**3), 2)
    metrics["disk_used_gb"] = round(used / (1024**3), 2)
    metrics["disk_free_gb"] = round(free / (1024**3), 2)
    metrics["disk_percent"] = round((used / total) * 100, 1)

    # Load average
    try:
        load1, load5, load15 = os.getloadavg()
        metrics["load_avg"] = {"1m": load1, "5m": load5, "15m": load15}
    except Exception:
        metrics["load_avg"] = "no_disponible"

    return metrics


def register_skills(registry):
    from core.skill_loader import SaoriSkill

    registry.register(SaoriSkill(
        name="check_host_health",
        description="Obtiene métricas operativas de disco y carga de la máquina host en tiempo real.",
        handler=check_host_health,
        schema={
            "type": "object",
            "properties": {},
            "additionalProperties": False
        },
        permission="staff"
    ))

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Habilidad de Consulta a la Base de Conocimiento de Slimefun (KB)
Conecta a SAORI y agentes con los 16,000 ítems, recetas, energía e investigaciones
del proyecto Slimefun-Knowledge-Drake sin consumir memoria excesiva en Star VPS.
"""

import sys
import gzip
import json
from pathlib import Path
from typing import Dict, Any, List, Optional

KB_DUMP_GZ = Path("/home/jack/Documentos/Desarrollo/Repositorios/personal/Slimefun-Knowledge-Drake/data/slimefun-dump.json.gz")

_KB_CACHE = None

def _load_kb():
    global _KB_CACHE
    if _KB_CACHE is not None:
        return _KB_CACHE

    if not KB_DUMP_GZ.exists():
        return None

    try:
        with gzip.open(KB_DUMP_GZ, "rt", encoding="utf-8") as f:
            data = json.load(f)
        
        # Mapeo optimizado por ID y búsqueda en minúsculas
        items_map = {}
        for item in data.get("items", []):
            if not item.get("disabled"):
                items_map[item["id"]] = item

        _KB_CACHE = {
            "meta": {k: data[k] for k in ("slimefun", "server", "generated_at") if k in data},
            "items": items_map
        }
        return _KB_CACHE
    except Exception as e:
        return None


def search_slimefun_item(query: str, max_results: int = 5, **kwargs) -> Dict[str, Any]:
    """
    Busca ítems en la base de datos de Slimefun por ID o nombre.
    """
    kb = _load_kb()
    if not kb:
        return {"ok": False, "error": "Base de datos de Slimefun no disponible en el nodo local."}

    q = query.strip().upper()
    q_low = query.strip().lower()

    # Coincidencia exacta de ID
    exact = kb["items"].get(q)
    results = []
    if exact:
        results.append(exact)

    for item_id, item in kb["items"].items():
        if exact and item_id == exact["id"]:
            continue
        name = str(item.get("name", "")).lower()
        if q_low in item_id.lower() or q_low in name:
            results.append(item)
            if len(results) >= max_results:
                break

    # Comprimir formato para ahorro de tokens
    compact_results = []
    for r in results:
        compact_results.append({
            "id": r.get("id"),
            "name": r.get("name"),
            "recipe_type": r.get("recipe_type"),
            "energy_consumption": r.get("energy_consumption", 0),
            "energy_capacity": r.get("energy_capacity", 0),
            "radioactive": r.get("radioactive", False)
        })

    return {
        "ok": True,
        "query": query,
        "count": len(compact_results),
        "items": compact_results
    }


def register_skills(registry):
    from core.skill_loader import SaoriSkill

    registry.register(SaoriSkill(
        name="search_slimefun_item",
        description="Consulta la base de conocimiento canónica de Slimefun (16,000 ítems, máquinas, recetas y consumo energético).",
        handler=search_slimefun_item,
        schema={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Nombre o ID del ítem de Slimefun a buscar (ej: 'ELECTRIC_FURNACE', 'QUANTUM_STORAGE', 'solar')"
                }
            },
            "required": ["query"],
            "additionalProperties": False
        },
        permission="user"
    ))

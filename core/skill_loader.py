#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAORI Dynamic Skill & Tool Engine
Inspirado en arquitecturas modernas de agentes autónomos (OpenClaw / Hermes Agent).
Permite carga en caliente, descubrimiento determinista y ejecución segura de habilidades
sin acoplar lógica propietaria al núcleo.
"""

import os
import sys
import glob
import json
import logging
import importlib.util
from pathlib import Path
from typing import Dict, Any, Callable, List, Optional

logger = logging.getLogger("SAORI-Skills")

class SaoriSkill:
    def __init__(self, name: str, description: str, handler: Callable, schema: Optional[Dict[str, Any]] = None, permission: str = "user"):
        self.name = name
        self.description = description
        self.handler = handler
        self.schema = schema or {}
        self.permission = permission  # 'user', 'staff', 'admin'

    def execute(self, **kwargs) -> Any:
        return self.handler(**kwargs)


class SkillRegistry:
    def __init__(self, skills_dir: Optional[str] = None):
        if skills_dir:
            self.skills_dir = Path(skills_dir)
        else:
            self.skills_dir = Path(__file__).resolve().parent.parent / "skills"
        
        self.skills: Dict[str, SaoriSkill] = {}

    def register(self, skill: SaoriSkill):
        self.skills[skill.name] = skill
        logger.info(f"[Skills] Habilidad registrada: {skill.name} (Permiso: {skill.permission})")

    def load_all_skills(self):
        """Descubre y carga dinámicamente todos los módulos de habilidades en la carpeta skills/."""
        if not self.skills_dir.exists():
            self.skills_dir.mkdir(parents=True, exist_ok=True)
            return

        skill_files = glob.glob(str(self.skills_dir / "*.py"))
        for file_path in skill_files:
            file_name = Path(file_path).name
            if file_name.startswith("__"):
                continue

            module_name = f"saori.skills.{Path(file_path).stem}"
            try:
                spec = importlib.util.spec_from_file_location(module_name, file_path)
                if spec and spec.loader:
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)
                    
                    if hasattr(module, "register_skills"):
                        module.register_skills(self)
                        logger.info(f"[Skills] Módulo cargado con éxito: {file_name}")
            except Exception as e:
                logger.error(f"[Skills] Error cargando habilidad desde {file_name}: {e}", exc_info=True)

    def get_tool_definitions(self, max_permission: str = "admin") -> List[Dict[str, Any]]:
        """
        Retorna la especificación en formato Function Calling (OpenAI / Hermes / Anthropic compatible)
        filtrando según el nivel de permisos del solicitante.
        """
        role_ranks = {"user": 1, "staff": 2, "admin": 3}
        target_rank = role_ranks.get(max_permission.lower(), 1)

        tools = []
        for name, skill in self.skills.items():
            skill_rank = role_ranks.get(skill.permission.lower(), 1)
            if skill_rank <= target_rank:
                tools.append({
                    "type": "function",
                    "function": {
                        "name": skill.name,
                        "description": skill.description,
                        "parameters": skill.schema
                    }
                })
        return tools

    def execute_tool(self, name: str, arguments: Dict[str, Any], user_role: str = "user") -> Dict[str, Any]:
        """Ejecuta una herramienta validando permisos."""
        role_ranks = {"user": 1, "staff": 2, "admin": 3}
        user_rank = role_ranks.get(user_role.lower(), 1)

        skill = self.skills.get(name)
        if not skill:
            return {"status": "error", "message": f"Herramienta '{name}' no encontrada"}

        skill_rank = role_ranks.get(skill.permission.lower(), 1)
        if user_rank < skill_rank:
            return {"status": "error", "message": f"Acceso denegado: se requiere rol '{skill.permission}'"}

        try:
            result = skill.execute(**arguments)
            return {"status": "ok", "result": result}
        except Exception as e:
            return {"status": "error", "message": str(e)}


# Instancia singleton accesible
skill_registry = SkillRegistry()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    registry = SkillRegistry()
    registry.load_all_skills()
    print("Herramientas cargadas:", [t["function"]["name"] for t in registry.get_tool_definitions()])

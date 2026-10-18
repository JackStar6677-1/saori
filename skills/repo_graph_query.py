#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Habilidad de Consulta de Grafos de Repositorios (Graph Knowledge Skill)
Permite a SAORI consultar el AST y dependencias de cualquier repositorio
ahorrando hasta 90% de tokens de contexto.
"""

from core.graph_retriever import graph_retriever

def query_repository_graph(repository_name: str, query: str, **kwargs):
    """
    Consulta nodos del grafo de conocimiento de un repositorio (AST, clases, funciones).
    Args:
        repository_name: Nombre del repo (ej: 'AxGraves-Drakes', 'Drakes-Suites', 'Slimefun4-Drake')
        query: Concepto, clase o función a buscar (ej: 'spawn height', 'EnergyNet', 'Vault')
    """
    return graph_retriever.query_graph_context(repository_name, query)


def list_knowledge_repositories(**kwargs):
    """Lista todos los repositorios mapeados en grafos de conocimiento."""
    repos = graph_retriever.list_available_repositories()
    return {
        "total_repositories": len(repos),
        "repositories": repos
    }


def register_skills(registry):
    from core.skill_loader import SaoriSkill

    registry.register(SaoriSkill(
        name="query_repository_graph",
        description="Consulta arquitectura y nodos de código (clases, funciones) de un repo mediante su grafo de conocimiento con ahorro extremo de tokens.",
        handler=query_repository_graph,
        schema={
            "type": "object",
            "properties": {
                "repository_name": {
                    "type": "string",
                    "description": "Nombre del repositorio (ej. AxGraves-Drakes, Drakes-Suites, saori)"
                },
                "query": {
                    "type": "string",
                    "description": "Término, clase, método o arquitectura a consultar"
                }
            },
            "required": ["repository_name", "query"],
            "additionalProperties": False
        },
        permission="user"
    ))

    registry.register(SaoriSkill(
        name="list_knowledge_repositories",
        description="Lista los repositorios disponibles indexados en grafos de conocimiento AST.",
        handler=list_knowledge_repositories,
        schema={
            "type": "object",
            "properties": {},
            "additionalProperties": False
        },
        permission="user"
    ))

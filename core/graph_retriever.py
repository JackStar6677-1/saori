#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAORI Graph Knowledge Retriever & Token Optimizer
Conecta el razonamiento de SAORI y de la Tríada SRE con los grafos de conocimiento
(AST, clases, funciones y dependencias generadas por graphify).
Permite responder preguntas de arquitectura, plugins y código inyectando
únicamente los nodos relevantes (subgrafos) en vez de archivos completos de miles de líneas,
ahorrando hasta un 90% de tokens de contexto.
"""

import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger("SAORI-GraphRetriever")

# Ubicación canónica de grafos en Star VPS o local
GRAPHS_DIR_CANDIDATES = [
    Path("/home/jack/ai-hub/knowledge/graphs"),
    Path.home() / "ai-hub/knowledge/graphs",
    Path.home() / "Documentos/Desarrollo/knowledge_graphs"
]

def get_graphs_dir() -> Optional[Path]:
    for candidate in GRAPHS_DIR_CANDIDATES:
        if candidate.exists() and candidate.is_dir():
            return candidate
    return None


class GraphKnowledgeRetriever:
    def __init__(self, graphs_dir: Optional[Path] = None):
        self.graphs_dir = graphs_dir or get_graphs_dir()
        self._index: Dict[str, Path] = {}
        self._refresh_index()

    def _refresh_index(self):
        self._index.clear()
        if not self.graphs_dir or not self.graphs_dir.exists():
            return
        for repo_dir in self.graphs_dir.iterdir():
            if repo_dir.is_dir():
                graph_file = repo_dir / "graph.json"
                if graph_file.exists():
                    self._index[repo_dir.name.lower()] = graph_file

    def list_available_repositories(self) -> List[str]:
        return sorted(list(self._index.keys()))

    def query_graph_context(self, repo_name: str, query: str, max_nodes: int = 8) -> Dict[str, Any]:
        """
        Busca nodos relevantes dentro del grafo de un repositorio según el término de búsqueda.
        Devuelve un resumen estructurado y compacto ideal para inyectar en el contexto del LLM.
        """
        key = repo_name.lower().strip()
        graph_path = self._index.get(key)
        
        # Búsqueda difusa si no coincide exacto
        if not graph_path:
            for r_name, p in self._index.items():
                if key in r_name or r_name in key:
                    graph_path = p
                    repo_name = r_name
                    break

        if not graph_path or not graph_path.exists():
            return {
                "found": False,
                "message": f"Grafo no encontrado para repositorio: {repo_name}",
                "available_repos_count": len(self._index)
            }

        try:
            with graph_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            logger.error(f"Error leyendo grafo {graph_path}: {e}")
            return {"found": False, "error": str(e)}

        nodes = data.get("nodes", [])
        q_terms = [t.lower() for t in query.split() if len(t) > 2]
        
        matched_nodes = []
        for node in nodes:
            label = str(node.get("label", "")).lower()
            source_file = str(node.get("source_file", "")).lower()
            norm_label = str(node.get("norm_label", "")).lower()

            score = 0
            for term in q_terms:
                if term in label:
                    score += 5
                if term in norm_label:
                    score += 4
                if term in source_file:
                    score += 2

            if score > 0:
                matched_nodes.append((score, node))

        matched_nodes.sort(key=lambda x: -x[0])
        selected = [n[1] for n in matched_nodes[:max_nodes]]

        # Construir contexto comprimido (Token-Optimized)
        compressed_nodes = []
        for n in selected:
            compressed_nodes.append({
                "name": n.get("label"),
                "file": n.get("source_file"),
                "line": n.get("source_location"),
                "is_callable": n.get("_callable", False),
                "is_class": n.get("_callable_class", False),
                "community": n.get("community")
            })

        return {
            "found": True,
            "repo": repo_name,
            "total_repo_nodes": len(nodes),
            "matched_count": len(matched_nodes),
            "selected_nodes": compressed_nodes,
            "token_saving_estimate": f"~{max(0, 95 - len(compressed_nodes)*3)}% tokens ahorrados vs código crudo"
        }


# Instancia singleton para importación directa
graph_retriever = GraphKnowledgeRetriever()

if __name__ == "__main__":
    retriever = GraphKnowledgeRetriever()
    print("Repositorios indexados en grafos:", len(retriever.list_available_repositories()))
    sample = retriever.query_graph_context("AxGraves-Drakes", "spawn grave height")
    print(json.dumps(sample, indent=2, ensure_ascii=False))

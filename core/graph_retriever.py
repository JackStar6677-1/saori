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
import sys
import json
import shutil
import logging
import argparse
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger("SAORI-GraphRetriever")

# Ubicación canónica de grafos en Star VPS o local
GRAPHS_DIR_CANDIDATES = [
    Path("/home/jack/ai-hub/knowledge/graphs"),
    Path.home() / "ai-hub/knowledge/graphs",
    Path.home() / "Documentos/Desarrollo/knowledge_graphs"
]

WORKSPACE_DIR_CANDIDATES = [
    Path("/home/jack/workspace/drakescraft"),
    Path("/home/jack/workspace/personal"),
    Path("/home/jack/workspace")
]


def get_graphs_dir() -> Optional[Path]:
    for candidate in GRAPHS_DIR_CANDIDATES:
        if candidate.exists() and candidate.is_dir():
            return candidate
    return None


class GraphKnowledgeRetriever:
    def __init__(self, graphs_dir: Optional[Path] = None, workspace_dirs: Optional[List[Path]] = None):
        self.graphs_dir = graphs_dir or get_graphs_dir()
        self.workspace_dirs = workspace_dirs or [d for d in WORKSPACE_DIR_CANDIDATES if d.exists() and d.is_dir()]
        self._index: Dict[str, Path] = {}
        self._workspace_index: Dict[str, Path] = {}
        self._refresh_index()

    def _refresh_index(self):
        self._index.clear()
        self._workspace_index.clear()

        # 1. Indexar grafos en knowledge/graphs
        if self.graphs_dir and self.graphs_dir.exists():
            for repo_dir in self.graphs_dir.iterdir():
                if repo_dir.is_dir():
                    graph_file = repo_dir / "graph.json"
                    if graph_file.exists():
                        self._index[repo_dir.name.lower()] = graph_file

        # 2. Indexar grafos locales en workspace/ (graphify-out)
        for ws_dir in self.workspace_dirs:
            if not ws_dir.exists():
                continue
            for repo_dir in ws_dir.iterdir():
                if repo_dir.is_dir():
                    ws_graph = repo_dir / "graphify-out" / "graph.json"
                    if ws_graph.exists():
                        self._workspace_index[repo_dir.name.lower()] = ws_graph
                        # Si no existe en knowledge/graphs, exponerlo en el índice
                        if repo_dir.name.lower() not in self._index:
                            self._index[repo_dir.name.lower()] = ws_graph

    def list_available_repositories(self) -> List[str]:
        return sorted(list(self._index.keys()))

    def _resolve_graph_path(self, repo_name: str) -> Tuple[Optional[Path], str]:
        key = repo_name.lower().strip()

        # Comprobar si hay versión local en workspace más reciente que knowledge/graphs
        ws_path = self._workspace_index.get(key)
        kg_path = self._index.get(key)

        # Búsqueda difusa si no coincide exacto
        resolved_name = repo_name
        if not kg_path:
            for r_name, p in self._index.items():
                if key in r_name or r_name in key:
                    kg_path = p
                    resolved_name = r_name
                    ws_path = self._workspace_index.get(r_name)
                    break

        if ws_path and ws_path.exists():
            if not kg_path or not kg_path.exists():
                return ws_path, resolved_name
            try:
                if ws_path.stat().st_mtime > kg_path.stat().st_mtime:
                    return ws_path, resolved_name
            except OSError:
                pass

        return kg_path, resolved_name

    def query_graph_context(self, repo_name: str, query: str, max_nodes: int = 8) -> Dict[str, Any]:
        """
        Busca nodos relevantes dentro del grafo de un repositorio según el término de búsqueda.
        Devuelve un resumen estructurado y compacto ideal para inyectar en el contexto del LLM.
        """
        graph_path, resolved_repo = self._resolve_graph_path(repo_name)

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
        q_terms = [t.lower() for t in query.split() if len(t) > 1]

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
            "repo": resolved_repo,
            "source_graph": str(graph_path),
            "total_repo_nodes": len(nodes),
            "matched_count": len(matched_nodes),
            "selected_nodes": compressed_nodes,
            "token_saving_estimate": f"~{max(0, 95 - len(compressed_nodes)*3)}% tokens ahorrados vs código crudo"
        }

    def query_all_repos(self, query: str, max_repos: int = 5, nodes_per_repo: int = 4) -> Dict[str, Any]:
        """
        Busca un símbolo o concepto a lo largo de TODOS los repositorios indexados.
        Devuelve los mejores repositorios ordenados por relevancia.
        """
        results_by_repo = []
        for repo_key in self.list_available_repositories():
            res = self.query_graph_context(repo_key, query, max_nodes=nodes_per_repo)
            if res.get("found") and res.get("matched_count", 0) > 0:
                results_by_repo.append(res)

        results_by_repo.sort(key=lambda x: -x.get("matched_count", 0))
        top_repos = results_by_repo[:max_repos]

        total_matches = sum(r.get("matched_count", 0) for r in results_by_repo)
        return {
            "found": len(top_repos) > 0,
            "query": query,
            "total_matching_repos": len(results_by_repo),
            "total_matches": total_matches,
            "top_repos": top_repos,
            "token_saving_estimate": f"~{max(0, 96 - len(top_repos)*2)}% tokens ahorrados vs búsqueda exhaustiva de texto"
        }

    def sync_workspace_graphs(self) -> Dict[str, Any]:
        """
        Sincroniza grafos generados en workspace (graphify-out/graph.json) hacia knowledge/graphs/.
        Garantiza que el catálogo central de SAORI refleje el código más reciente.
        """
        if not self.graphs_dir:
            return {"ok": False, "error": "No graphs_dir configured"}

        self.graphs_dir.mkdir(parents=True, exist_ok=True)
        synced = []
        skipped = []

        for ws_dir in self.workspace_dirs:
            if not ws_dir.exists():
                continue
            for repo_dir in ws_dir.iterdir():
                if not repo_dir.is_dir():
                    continue
                ws_graph = repo_dir / "graphify-out" / "graph.json"
                if not ws_graph.exists():
                    continue

                # Destino canónico
                target_repo_dir = self.graphs_dir / repo_dir.name
                # Buscar si ya existe con distinta mayúscula/minúscula
                for cand in self.graphs_dir.iterdir():
                    if cand.is_dir() and cand.name.lower() == repo_dir.name.lower():
                        target_repo_dir = cand
                        break

                target_graph = target_repo_dir / "graph.json"
                should_copy = False

                if not target_graph.exists():
                    should_copy = True
                else:
                    try:
                        if ws_graph.stat().st_mtime > target_graph.stat().st_mtime:
                            should_copy = True
                    except OSError:
                        should_copy = True

                if should_copy:
                    target_repo_dir.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(ws_graph, target_graph)

                    # Copiar también HTML y reporte si existen
                    ws_html = repo_dir / "graphify-out" / "graph.html"
                    if ws_html.exists():
                        shutil.copy2(ws_html, target_repo_dir / "graph.html")
                    ws_report = repo_dir / "graphify-out" / "GRAPH_REPORT.md"
                    if ws_report.exists():
                        shutil.copy2(ws_report, target_repo_dir / "GRAPH_REPORT.md")

                    synced.append({
                        "repo": repo_dir.name,
                        "target": str(target_repo_dir),
                        "size_bytes": ws_graph.stat().st_size
                    })
                else:
                    skipped.append(repo_dir.name)

        self._refresh_index()
        return {
            "ok": True,
            "synced_count": len(synced),
            "synced_repos": synced,
            "skipped_count": len(skipped),
            "total_indexed": len(self._index)
        }


# Instancia singleton para importación directa
graph_retriever = GraphKnowledgeRetriever()


def main():
    parser = argparse.ArgumentParser(
        description="SAORI Graph Knowledge Retriever & Token Optimizer (Graph-First Architecture)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )
    parser.add_argument("--query", "-q", type=str, default=None, help="Término de búsqueda, clase o función a localizar")
    parser.add_argument("--repo", "-r", type=str, default=None, help="Nombre del repositorio (ej. Odysseia, DrakesRankup)")
    parser.add_argument("--max-nodes", "-n", type=int, default=8, help="Máximo de nodos a devolver")
    parser.add_argument("--list-repos", "-l", action="store_true", help="Listar todos los repositorios indexados")
    parser.add_argument("--sync", action="store_true", help="Sincronizar grafos actualizados desde repositorios del workspace a knowledge/graphs")
    parser.add_argument("--json", action="store_true", help="Salida en formato JSON puro")

    args = parser.parse_args()
    retriever = GraphKnowledgeRetriever()

    if args.sync:
        res = retriever.sync_workspace_graphs()
        if args.json:
            print(json.dumps(res, indent=2, ensure_ascii=False))
        else:
            print(f"✅ Sincronización completada: {res['synced_count']} repos actualizados, {res['skipped_count']} sin cambios.")
            for s in res.get("synced_repos", []):
                print(f"   • {s['repo']} ({s['size_bytes']:,} bytes)")
            print(f"Total repos indexados: {res['total_indexed']}")
        return 0

    if args.list_repos:
        repos = retriever.list_available_repositories()
        if args.json:
            print(json.dumps({"total": len(repos), "repositories": repos}, indent=2, ensure_ascii=False))
        else:
            print(f"Repositorios indexados ({len(repos)}):")
            for r in repos:
                print(f"  • {r}")
        return 0

    if args.query and args.repo:
        res = retriever.query_graph_context(args.repo, args.query, max_nodes=args.max_nodes)
        print(json.dumps(res, indent=2, ensure_ascii=False))
        return 0 if res.get("found") else 1

    if args.query and not args.repo:
        res = retriever.query_all_repos(args.query, max_repos=5, nodes_per_repo=args.max_nodes)
        print(json.dumps(res, indent=2, ensure_ascii=False))
        return 0 if res.get("found") else 1

    # Sin argumentos: imprimir ayuda y resumen de estado
    if args.json:
        print(json.dumps({
            "status": "active",
            "indexed_repositories": len(retriever.list_available_repositories()),
            "graphs_dir": str(retriever.graphs_dir)
        }, indent=2, ensure_ascii=False))
    else:
        print("=" * 65)
        print("SAORI Graph Knowledge Retriever & Token Optimizer")
        print("=" * 65)
        print(f"Repositorios indexados en grafos: {len(retriever.list_available_repositories())}")
        print("Uso recomendado (Token-Saver):")
        print('  python3 graph_retriever.py --query "<clase o función>" --repo "<repo>"')
        print('  python3 graph_retriever.py --query "<concepto o clase>"')
        print("  python3 graph_retriever.py --list-repos")
        print("  python3 graph_retriever.py --sync")
        print()
        sample = retriever.query_graph_context("AxGraves-Drakes", "spawn grave height")
        print("Ejemplo de consulta en AxGraves-Drakes:")
        print(json.dumps(sample, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

# -*- coding: utf-8 -*-
"""
SAORI KOKORO — Episodic Autobiography & Metacognition
====================================================
Manages persistent chronological memory of milestones, operational decisions,
lessons learned, and explicit uncertainty tracking with local SQLite WAL storage
and optional external REST/MCP memory synchronization.
Zero personal data leaks by default.
"""

import os
import json
import sqlite3
import datetime
import urllib.request
import urllib.parse
from pathlib import Path
from typing import Dict, Any, List, Optional

DEFAULT_MEMORY_DIR = Path(os.getenv("SAORI_DATA_DIR", Path.home() / ".local" / "state" / "saori"))
DEFAULT_MEMORY_DB = DEFAULT_MEMORY_DIR / "memory.db"

class KokoroAutobiography:
    """Episodic memory connector with automatic local SQLite WAL mode & optional API sync."""

    def __init__(self, api_url: Optional[str] = None, db_path: Optional[Path] = None):
        self.api_url = (api_url or os.getenv("SAORI_MEMORY_URL", "")).rstrip("/")
        self.db_path = Path(db_path or os.getenv("SAORI_MEMORY_DB", str(DEFAULT_MEMORY_DB)))
        self._incertidumbres: List[Dict[str, Any]] = []
        self._init_sqlite()

    def _init_sqlite(self):
        """Initializes SQLite schema with Write-Ahead Logging (WAL) for high concurrency."""
        try:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            con = sqlite3.connect(str(self.db_path), timeout=10.0)
            cur = con.cursor()
            cur.execute("PRAGMA journal_mode=WAL;")
            cur.execute("""CREATE TABLE IF NOT EXISTS memorias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fecha TEXT NOT NULL,
                tema TEXT NOT NULL,
                contenido TEXT NOT NULL,
                agente TEXT NOT NULL,
                tipo TEXT NOT NULL,
                proyecto TEXT NOT NULL
            );""")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_memorias_proyecto ON memorias(proyecto);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_memorias_fecha ON memorias(fecha);")
            con.commit()
            con.close()
        except Exception:
            pass

    def recuperar_recientes(self, limite: int = 10, proyecto: Optional[str] = None) -> List[Dict[str, Any]]:
        """Recovers recent operational milestones and learnings."""
        if self.api_url:
            try:
                params = {"limite": limite}
                if proyecto:
                    params["proyecto"] = proyecto
                qs = urllib.parse.urlencode(params)
                url = f"{self.api_url}/recuperar?{qs}"
                req = urllib.request.Request(url, headers={"Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=3) as res:
                    data = json.loads(res.read().decode("utf-8"))
                    return data.get("memorias", [])
            except Exception:
                pass
        return self._recuperar_sqlite(limite, proyecto)

    def _recuperar_sqlite(self, limite: int, proyecto: Optional[str]) -> List[Dict[str, Any]]:
        if not self.db_path.exists():
            return []
        try:
            con = sqlite3.connect(str(self.db_path), timeout=5.0)
            cur = con.cursor()
            if proyecto:
                cur.execute(
                    "SELECT id, fecha, tema, contenido, agente, tipo, proyecto FROM memorias WHERE proyecto = ? ORDER BY id DESC LIMIT ?",
                    (proyecto, limite)
                )
            else:
                cur.execute(
                    "SELECT id, fecha, tema, contenido, agente, tipo, proyecto FROM memorias ORDER BY id DESC LIMIT ?",
                    (limite,)
                )
            rows = cur.fetchall()
            con.close()
            return [
                {"id": r[0], "fecha": r[1], "tema": r[2], "contenido": r[3], "agente": r[4], "tipo": r[5], "proyecto": r[6]}
                for r in rows
            ]
        except Exception:
            return []

    def consolidar_recuerdo(self, tema: str, contenido: str, agente: str = "kokoro-kernel", tipo: str = "hito", proyecto: str = "saori") -> bool:
        """Stores a verified learning or milestone into persistent memory."""
        payload = {
            "tema": tema,
            "contenido": contenido,
            "agente": agente,
            "tipo": tipo,
            "proyecto": proyecto
        }
        if self.api_url:
            try:
                req = urllib.request.Request(
                    f"{self.api_url}/recordar",
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json"}
                )
                with urllib.request.urlopen(req, timeout=3) as res:
                    if res.status in (200, 201):
                        self._guardar_sqlite(payload)
                        return True
            except Exception:
                pass
        return self._guardar_sqlite(payload)

    def _guardar_sqlite(self, payload: Dict[str, Any]) -> bool:
        try:
            con = sqlite3.connect(str(self.db_path), timeout=5.0)
            cur = con.cursor()
            fecha = datetime.datetime.now().astimezone().isoformat()
            cur.execute(
                "INSERT INTO memorias (fecha, tema, contenido, agente, tipo, proyecto) VALUES (?, ?, ?, ?, ?, ?)",
                (fecha, payload["tema"], payload["contenido"], payload["agente"], payload["tipo"], payload["proyecto"])
            )
            con.commit()
            con.close()
            return True
        except Exception:
            return False

    def registrar_incertidumbre(self, componente: str, hipotesis: str, riesgo: str, accion_verificacion: str):
        """Metacognition: explicitly log when an inference is not yet empirically proven."""
        self._incertidumbres.append({
            "componente": componente,
            "hipotesis": hipotesis,
            "riesgo": riesgo,
            "verificacion": accion_verificacion
        })

    def obtener_metacognicion(self) -> Dict[str, Any]:
        return {
            "incertidumbres_activas": self._incertidumbres,
            "errores_frecuentes_mitigados": [
                "Unbounded codebase grep (mitigated by AST graph indexing)",
                "Silent API quota exhaustion (mitigated by circuit breakers & multi-provider fallback)",
                "Oversized 60KB context prompts (mitigated by Kokoro compressed identity base)"
            ]
        }

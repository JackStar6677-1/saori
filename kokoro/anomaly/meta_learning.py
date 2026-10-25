# -*- coding: utf-8 -*-
"""
SAORI PROTOCOLO ANOMALY (AST-0001): Motor de Metaprendizaje
============================================================
Compara estrategias mediante benchmarks reproducibles.
Solo promueve mejoras demostradas empíricamente (Baseline vs Challenger).
"""

from __future__ import annotations
import sqlite3
import json
import time
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Dict, Any, List, Optional
from kokoro.observatory.events import DB_PATH, sanitize_metadata, ObservatoryEventBus

@dataclass
class VerifiedLearning:
    id: str
    tema: str
    estrategia_baseline: str
    estrategia_promovida: str
    mejora_tokens_pct: float
    mejora_latencia_pct: float
    seguridad_invariantes_ok: bool
    evidencia_benchmark: Dict[str, Any]
    fecha_promocion: float

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

class MetaLearningEngine:
    """Motor de evaluación rigurosa y promoción de aprendizajes técnicos."""

    _instance = None

    def __new__(cls, db_path: Path = DB_PATH):
        if cls._instance is None:
            cls._instance = super(MetaLearningEngine, cls).__new__(cls)
            cls._instance._init_db(db_path)
        return cls._instance

    def _init_db(self, db_path: Path):
        self.db_path = Path(db_path)
        try:
            con = sqlite3.connect(str(self.db_path), timeout=3.0)
            cur = con.cursor()
            cur.execute("""
            CREATE TABLE IF NOT EXISTS anomaly_learnings (
                id TEXT PRIMARY KEY,
                tema TEXT NOT NULL,
                baseline TEXT NOT NULL,
                promovida TEXT NOT NULL,
                mejora_tokens REAL DEFAULT 0.0,
                mejora_latencia REAL DEFAULT 0.0,
                seguridad_ok INTEGER DEFAULT 1,
                evidencia_json TEXT,
                fecha_promocion REAL NOT NULL
            );
            """)
            con.commit()
            con.close()
        except Exception as e:
            print(f"[META-LEARN-ERROR] Init DB: {e}", flush=True)

    def evaluar_y_promover(
        self,
        tema: str,
        baseline_name: str,
        challenger_name: str,
        metricas_baseline: Dict[str, Any],
        metricas_challenger: Dict[str, Any]
    ) -> Optional[VerifiedLearning]:
        """Evalúa empíricamente si la estrategia aspirante supera a la base sin degradar seguridad."""
        # 1. Regla dura de seguridad: Invariantes
        inv_base = metricas_baseline.get("invariantes_ok", True)
        inv_chal = metricas_challenger.get("invariantes_ok", True)
        if not inv_chal:
            # Rechazada de inmediato por violación de invariantes
            ObservatoryEventBus().emit(
                event_type="anomaly.learning_rejected",
                agent="saori-anomaly",
                model="anomaly-kernel",
                project="saori-anomaly",
                category="incident",
                summary=f"Rechazada estrategia {challenger_name}: violó invariantes de seguridad.",
                status="FAILED"
            )
            return None

        # 2. Medir mejoras
        tok_base = metricas_baseline.get("tokens", 1000)
        tok_chal = metricas_challenger.get("tokens", 1000)
        ahorro_tok_pct = round(((tok_base - tok_chal) / max(1, tok_base)) * 100, 2)

        lat_base = metricas_baseline.get("latencia_ms", 500)
        lat_chal = metricas_challenger.get("latencia_ms", 500)
        mejora_lat_pct = round(((lat_base - lat_chal) / max(1, lat_base)) * 100, 2)

        # Criterio de promoción: o ahorra >15% tokens o reduce >15% latencia, con 0 errores nuevos
        errores_nuevos = metricas_challenger.get("errores", 0)
        es_superior = (ahorro_tok_pct >= 15.0 or mejora_lat_pct >= 15.0) and (errores_nuevos == 0)

        if not es_superior:
            return None

        now = time.time()
        learning_id = f"LRN-{int(now)}-{tema[:12]}"
        evidencia = {
            "baseline": metricas_baseline,
            "challenger": metricas_challenger,
            "ahorro_tokens_pct": ahorro_tok_pct,
            "mejora_latencia_pct": mejora_lat_pct
        }

        learning = VerifiedLearning(
            id=learning_id,
            tema=tema,
            estrategia_baseline=baseline_name,
            estrategia_promovida=challenger_name,
            mejora_tokens_pct=ahorro_tok_pct,
            mejora_latencia_pct=mejora_lat_pct,
            seguridad_invariantes_ok=True,
            evidencia_benchmark=evidencia,
            fecha_promocion=now
        )

        try:
            con = sqlite3.connect(str(self.db_path), timeout=2.0)
            con.execute("""
            INSERT INTO anomaly_learnings
            (id, tema, baseline, promovida, mejora_tokens, mejora_latencia, seguridad_ok, evidencia_json, fecha_promocion)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?);
            """, (learning.id, learning.tema, learning.estrategia_baseline, learning.estrategia_promovida, ahorro_tok_pct, mejora_lat_pct, json.dumps(evidencia), now))
            con.commit()
            con.close()

            ObservatoryEventBus().emit(
                event_type="anomaly.learning_promoted",
                agent="saori-anomaly",
                model="anomaly-kernel",
                project="saori-anomaly",
                category="decision",
                summary=f"Estrategia promovida [{tema}]: {challenger_name} (+{ahorro_tok_pct}% tokens, +{mejora_lat_pct}% vel)",
                details={"learning_id": learning_id, "mejora_tokens": ahorro_tok_pct, "mejora_latencia": mejora_lat_pct}
            )
        except Exception:
            pass

        return learning

    def listar_aprendizajes(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Recupera los aprendizajes verificados y consolidados."""
        try:
            con = sqlite3.connect(str(self.db_path), timeout=2.0)
            cur = con.cursor()
            rows = cur.execute("""
            SELECT id, tema, baseline, promovida, mejora_tokens, mejora_latencia, seguridad_ok, evidencia_json, fecha_promocion
            FROM anomaly_learnings ORDER BY fecha_promocion DESC LIMIT ?;
            """, (limit,)).fetchall()
            con.close()

            results = []
            for r in rows:
                try:
                    ev = json.loads(r[7]) if r[7] else {}
                except Exception:
                    ev = {}
                results.append({
                    "id": r[0],
                    "tema": r[1],
                    "baseline": r[2],
                    "promovida": r[3],
                    "mejora_tokens_pct": r[4],
                    "mejora_latencia_pct": r[5],
                    "seguridad_ok": bool(r[6]),
                    "evidencia": ev,
                    "fecha_promocion": r[8]
                })
            return results
        except Exception:
            return []

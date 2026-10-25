# -*- coding: utf-8 -*-
"""
SAORI PROTOCOLO ANOMALY (AST-0001): Motor de HipÃ³tesis CientÃ­ficas
==================================================================
Identifica problemas o lagunas en el conocimiento de SAORI y formula
hipÃ³tesis comprobables separando estrictamente observaciones de inferencias.
"""

from __future__ import annotations
import uuid
import time
import json
import sqlite3
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Dict, Any, List, Optional
from kokoro.observatory.events import DB_PATH, sanitize_metadata, ObservatoryEventBus
from kokoro.anomaly.self_model import SaoriSelfModel

@dataclass
class Hypothesis:
    id: str
    dominio: str                # SEGURIDAD, TOKENS, AGENTES, GRAFOS, SRE
    observacion: str            # Hecho empÃ­rico verificado (auditorÃ­a/log)
    conjetura: str              # ExplicaciÃ³n propuesta / inferencia causal
    plan_prueba: str            # DiseÃ±o experimental reproducible
    criterio_falsacion: str     # CondiciÃ³n exacta bajo la cual se refuta
    estado: str                 # PROPUESTA, EN_PRUEBA, VALIDADA, FALSADA, DESCARTADA
    evidencia: Dict[str, Any]
    resultado: str
    created_at: float
    updated_at: float

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

class HypothesisEngine:
    """Generador y gestor de hipÃ³tesis comprobables para el autoaprendizaje de SAORI."""

    _instance = None

    def __new__(cls, db_path: Path = DB_PATH):
        if cls._instance is None:
            cls._instance = super(HypothesisEngine, cls).__new__(cls)
            cls._instance._init_db(db_path)
        return cls._instance

    def _init_db(self, db_path: Path):
        self.db_path = Path(db_path)
        try:
            con = sqlite3.connect(str(self.db_path), timeout=3.0)
            cur = con.cursor()
            cur.execute("""
            CREATE TABLE IF NOT EXISTS anomaly_hypotheses (
                id TEXT PRIMARY KEY,
                dominio TEXT NOT NULL,
                observacion TEXT NOT NULL,
                conjetura TEXT NOT NULL,
                plan_prueba TEXT NOT NULL,
                criterio_falsacion TEXT NOT NULL,
                estado TEXT NOT NULL,
                evidencia_json TEXT,
                resultado TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_hyp_estado ON anomaly_hypotheses(estado);")
            con.commit()
            con.close()
        except Exception as e:
            print(f"[HYPOTHESIS-ERROR] Init DB: {e}", flush=True)

    def proponer_hipotesis(
        self,
        dominio: str,
        observacion: str,
        conjetura: str,
        plan_prueba: str,
        criterio_falsacion: str,
        evidencia: Optional[Dict[str, Any]] = None
    ) -> Hypothesis:
        """Registra formalmente una nueva hipÃ³tesis comprobable."""
        now = time.time()
        hyp_id = f"HYP-{time.strftime('%Y%m%d')}-{uuid.uuid4().hex[:6]}"
        clean_ev = sanitize_metadata(evidencia or {})

        hyp = Hypothesis(
            id=hyp_id,
            dominio=dominio,
            observacion=observacion[:400],
            conjetura=conjetura[:400],
            plan_prueba=plan_prueba[:400],
            criterio_falsacion=criterio_falsacion[:400],
            estado="PROPUESTA",
            evidencia=clean_ev,
            resultado="Pendiente de ejecuciÃ³n en Simulation Lab",
            created_at=now,
            updated_at=now
        )

        try:
            con = sqlite3.connect(str(self.db_path), timeout=2.0)
            con.execute("""
            INSERT INTO anomaly_hypotheses
            (id, dominio, observacion, conjetura, plan_prueba, criterio_falsacion, estado, evidencia_json, resultado, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (hyp.id, hyp.dominio, hyp.observacion, hyp.conjetura, hyp.plan_prueba, hyp.criterio_falsacion, hyp.estado, json.dumps(clean_ev), hyp.resultado, now, now))
            con.commit()
            con.close()

            # Notificar al observatorio
            ObservatoryEventBus().emit(
                event_type="anomaly.hypothesis_proposed",
                agent="saori-anomaly",
                model="anomaly-kernel",
                project="saori-anomaly",
                task_id=hyp_id,
                category="decision",
                summary=f"Nueva hipÃ³tesis [{dominio}]: {conjetura[:120]}",
                details={"hypothesis_id": hyp_id, "dominio": dominio, "observacion": observacion[:100]}
            )
        except Exception:
            pass
        return hyp

    def actualizar_resultado(
        self,
        hyp_id: str,
        nuevo_estado: str,
        resultado_detallado: str,
        evidencia_experimental: Optional[Dict[str, Any]] = None
    ):
        """Actualiza el estado de la hipÃ³tesis tras someterla al laboratorio de simulaciÃ³n."""
        now = time.time()
        try:
            con = sqlite3.connect(str(self.db_path), timeout=2.0)
            cur = con.cursor()
            existing = cur.execute("SELECT evidencia_json FROM anomaly_hypotheses WHERE id = ?;", (hyp_id,)).fetchone()
            current_ev = json.loads(existing[0]) if existing and existing[0] else {}
            if evidencia_experimental:
                current_ev.update(sanitize_metadata(evidencia_experimental))

            cur.execute("""
            UPDATE anomaly_hypotheses
            SET estado = ?, resultado = ?, evidencia_json = ?, updated_at = ?
            WHERE id = ?;
            """, (nuevo_estado, resultado_detallado[:400], json.dumps(current_ev), now, hyp_id))
            con.commit()
            con.close()

            ObservatoryEventBus().emit(
                event_type=f"anomaly.hypothesis_{nuevo_estado.lower()}",
                agent="saori-anomaly",
                model="anomaly-kernel",
                project="saori-anomaly",
                task_id=hyp_id,
                category="decision" if nuevo_estado == "VALIDADA" else "incident",
                summary=f"HipÃ³tesis {hyp_id} evaluada: {nuevo_estado} â€” {resultado_detallado[:120]}",
                details={"hypothesis_id": hyp_id, "estado": nuevo_estado, "resultado": resultado_detallado[:100]}
            )
        except Exception:
            pass

    def listar_hipotesis(self, estado: Optional[str] = None, limit: int = 20) -> List[Dict[str, Any]]:
        """Recupera la lista de hipÃ³tesis para consulta y auditorÃ­a."""
        try:
            con = sqlite3.connect(str(self.db_path), timeout=2.0)
            cur = con.cursor()
            if estado:
                rows = cur.execute("SELECT id, dominio, observacion, conjetura, plan_prueba, criterio_falsacion, estado, evidencia_json, resultado, created_at, updated_at FROM anomaly_hypotheses WHERE estado = ? ORDER BY created_at DESC LIMIT ?;", (estado, limit)).fetchall()
            else:
                rows = cur.execute("SELECT id, dominio, observacion, conjetura, plan_prueba, criterio_falsacion, estado, evidencia_json, resultado, created_at, updated_at FROM anomaly_hypotheses ORDER BY created_at DESC LIMIT ?;", (limit,)).fetchall()
            con.close()

            results = []
            for r in rows:
                try:
                    ev = json.loads(r[7]) if r[7] else {}
                except Exception:
                    ev = {}
                results.append({
                    "id": r[0],
                    "dominio": r[1],
                    "observacion": r[2],
                    "conjetura": r[3],
                    "plan_prueba": r[4],
                    "criterio_falsacion": r[5],
                    "estado": r[6],
                    "evidencia": ev,
                    "resultado": r[8],
                    "created_at": r[9],
                    "updated_at": r[10]
                })
            return results
        except Exception:
            return []

    def generar_hipotesis_desde_autodiagnostico(self) -> List[Hypothesis]:
        """Analiza autÃ³nomamente el Self-Model y formula hipÃ³tesis para problemas reales."""
        model = SaoriSelfModel.compilar_modelo()
        generadas = []

        # 1. HipÃ³tesis sobre agentes bloqueados (ej. opencode)
        for a in model.flota_agentes:
            if a.get("blockade"):
                blk = a["blockade"]
                ag_id = a["agent_id"]
                if blk.get("cause_code") == "TOOL_FAILURE":
                    h = self.proponer_hipotesis(
                        dominio="AGENTES",
                        observacion=f"Agente {ag_id} terminÃ³ con cÃ³digo de error {a.get('last_exit')} tras timeouts en cascada de modelos en la nube.",
                        conjetura=f"Conmutar el runner de {ag_id} hacia los endpoints locales de OmniAST (JEV fallback a deepseek o antigravity) evitarÃ¡ timeouts de proveedores externos caÃ­dos.",
                        plan_prueba=f"Simular en sandbox la resoluciÃ³n de una tarea sintÃ©tica para {ag_id} empleando el router JEV de OmniAST.",
                        criterio_falsacion="Si la resoluciÃ³n con JEV toma mÃ¡s de 10s o falla, la conjetura queda falsada.",
                        evidencia={"agente": ag_id, "blockade": blk, "last_exit": a.get("last_exit")}
                    )
                    generadas.append(h)

        # 2. HipÃ³tesis sobre vulnerabilidades abiertas (ej. node desactualizado)
        for v in model.vulnerabilidades_abiertas:
            if v.get("severity") in ("HIGH", "CRITICAL"):
                h = self.proponer_hipotesis(
                    dominio="SEGURIDAD",
                    observacion=f"Vulnerabilidad abierta {v.get('id')} en componente {v.get('component')}: {v.get('title')}",
                    conjetura=f"Aplicar la mitigaciÃ³n declarada '{v.get('fix')}' en una copia aislada de sandbox solventa el fallo sin romper dependencias.",
                    plan_prueba=f"Generar parche en sandbox para {v.get('component')} y verificar sintaxis y resoluciÃ³n de paquetes.",
                    criterio_falsacion="Si el parche genera errores de instalaciÃ³n o dependencias rotas, se refuta.",
                    evidencia=v
                )
                generadas.append(h)

        # 3. HipÃ³tesis de optimizaciÃ³n de tokens en prompts
        h_tok = self.proponer_hipotesis(
            dominio="TOKENS",
            observacion="Prompts heredados cargan contratos repetitivos de mÃ¡s de 8.000 tokens por ciclo proactivo.",
            conjetura="La compresiÃ³n canÃ³nica mediante KokoroIdentity.generar_prompt_base reduce el consumo a menos de 1.200 tokens preservando las 6 invariantes y la precisiÃ³n de ejecuciÃ³n.",
            plan_prueba="Comparar el consumo de tokens y la tasa de aciertos de invariantes en una prueba sintÃ©tica (baseline vs challenger).",
            criterio_falsacion="Si el prompt compacto omite cualquiera de las 6 invariantes de seguridad, se rechaza inmediatamente.",
            evidencia={"invariantes_requeridas": 6, "tamano_objetivo_bytes": 1200}
        )
        generadas.append(h_tok)

        return generadas

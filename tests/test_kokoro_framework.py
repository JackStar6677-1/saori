# -*- coding: utf-8 -*-
"""
SAORI KOKORO — Unit & Integration Test Suite
============================================
Verifies core Kokoro Kernel, Governance A0-A4, Multi-Provider Adapters,
Neural Observatory Flight Recorder, and Protocol ANOMALY.
"""

import unittest
import os
import tempfile
import sqlite3
from pathlib import Path

from kokoro.kernel import KokoroKernel
from kokoro.identity import KokoroIdentity, INVARIANTES_KOKORO
from kokoro.governance import KokoroGovernance, NivelRiesgo, AutonomyTier, PropuestaMejora
from kokoro.autobiography import KokoroAutobiography
from kokoro.adapters.base import ModelCapability, ModelSpec, ProviderResponse, ProviderUsage
from kokoro.adapters.registry import ProviderRegistry, CircuitBreaker
from kokoro.adapters.ollama_provider import OllamaProvider
from kokoro.adapters.openai_provider import OpenAIProvider
from kokoro.adapters.anthropic_provider import AnthropicProvider
from kokoro.adapters.gemini_provider import GeminiProvider
from kokoro.observatory.events import ObservatoryEventBus, sanitize_metadata, FORBIDDEN_DETAIL_KEYS
from kokoro.observatory.flight_recorder import FlightRecorder
from kokoro.anomaly.self_model import SaoriSelfModel
from kokoro.anomaly.hypothesis_engine import HypothesisEngine
from kokoro.anomaly.simulation_lab import SimulationLab
from kokoro.anomaly.meta_learning import MetaLearningEngine
from kokoro.anomaly.coherence import CognitiveCoherence

class TestKokoroIdentity(unittest.TestCase):
    def test_invariants_count_and_content(self):
        self.assertEqual(len(INVARIANTES_KOKORO), 6)
        inv_ids = [i.id for i in INVARIANTES_KOKORO]
        self.assertIn("INV-01", inv_ids)
        self.assertIn("INV-02", inv_ids)
        self.assertIn("INV-03", inv_ids)

    def test_compressed_prompt_size(self):
        prompt = KokoroIdentity.generar_prompt_base(agente="test-agent")
        self.assertIn("SAORI", prompt)
        self.assertIn("test-agent", prompt)
        # Ensure compressed prompt is well under 1.2 KB
        self.assertLess(len(prompt.encode("utf-8")), 1200)

class TestKokoroGovernance(unittest.TestCase):
    def test_autonomy_matrix_tiers(self):
        # A0: Read telemetry
        tier_a0 = KokoroGovernance.clasificar_accion("read_telemetry", NivelRiesgo.BAJO)
        self.assertEqual(tier_a0, AutonomyTier.A0)
        self.assertTrue(KokoroGovernance.puede_ejecutar_autonomamente("read_telemetry", NivelRiesgo.BAJO))

        # A2: Sandbox simulation
        tier_a2 = KokoroGovernance.clasificar_accion("run_sandbox_simulation", NivelRiesgo.MEDIO)
        self.assertEqual(tier_a2, AutonomyTier.A2)
        self.assertTrue(KokoroGovernance.puede_ejecutar_autonomamente("run_sandbox_simulation", NivelRiesgo.MEDIO))

        # A3 / Límite 6: Production deploy requires human signature
        tier_a3 = KokoroGovernance.clasificar_accion("deploy_to_production", NivelRiesgo.ALTO)
        self.assertEqual(tier_a3, AutonomyTier.A3)
        self.assertFalse(KokoroGovernance.puede_ejecutar_autonomamente("deploy_to_production", NivelRiesgo.ALTO))

    def test_12_step_improvement_evaluation(self):
        propuesta = PropuestaMejora(
            id="PROP-01",
            componente="router",
            oportunidad="Reducir latencia",
            evidencia="Latencia media 3.2s",
            problema="Ruta pesada seleccionada por defecto",
            solucion_propuesta="Usar Gemini Flash para telemetria",
            dependencias=[],
            plan_pruebas="Ejecutar 50 queries",
            nivel_riesgo=NivelRiesgo.MEDIO,
            autorizado_por_operador=False
        )
        eval_res = KokoroGovernance.evaluar_ciclo_12_pasos(propuesta, resultados_pruebas_ok=True)
        self.assertTrue(eval_res["aprobada"])
        self.assertFalse(eval_res["requiere_firma_humana"])

class TestAutobiography(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp_dir.name) / "test_memory.db"
        self.mem = KokoroAutobiography(db_path=self.db_path)

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_record_and_retrieve(self):
        ok = self.mem.consolidar_recuerdo("test_topic", "test_content", agente="test_agent", tipo="hito", proyecto="test_proj")
        self.assertTrue(ok)
        recs = self.mem.recuperar_recientes(limite=5, proyecto="test_proj")
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0]["tema"], "test_topic")
        self.assertEqual(recs[0]["contenido"], "test_content")

class TestMultiProviderAdapters(unittest.TestCase):
    def test_registry_registration_and_discovery(self):
        reg = ProviderRegistry()
        self.assertIn("openai", reg.providers)
        self.assertIn("anthropic", reg.providers)
        self.assertIn("gemini", reg.providers)
        self.assertIn("ollama", reg.providers)

    def test_circuit_breaker(self):
        cb = CircuitBreaker(failure_threshold=2, cooldown_seconds=10.0)
        self.assertFalse(cb.is_open())
        cb.record_failure()
        self.assertFalse(cb.is_open())
        cb.record_failure()
        self.assertTrue(cb.is_open())
        cb.record_success()
        self.assertFalse(cb.is_open())

class TestObservatoryAndFlightRecorder(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp_dir.name) / "events.db"
        self.recorder = FlightRecorder(db_path=self.db_path)

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_secret_sanitization(self):
        raw_meta = {
            "user": "developer",
            "api_key": "mock-dummy-secret-key-for-test-only",
            "secret": "super_secret_token",
            "query": "status --all"
        }
        sanitized = sanitize_metadata(raw_meta)
        for forbidden in FORBIDDEN_DETAIL_KEYS:
            self.assertNotIn(forbidden, sanitized)
        self.assertIn("user", sanitized)
        self.assertIn("query", sanitized)

    def test_flight_recorder_causal_trace(self):
        trace_id = self.recorder.start_trace(
            agent="test-agent",
            project="test-project",
            task="unit_test_run",
            model="mock-model",
            summary="Testing flight recorder trace"
        )
        self.assertTrue(trace_id.startswith("run_test-agent_"))

        self.recorder.record_span(
            trace_id=trace_id,
            name="phase.context",
            phase="CONTEXT",
            category="OPERATION",
            input_summary="Gathering test metrics",
            output_summary="Metrics ready",
            status="SUCCESS",
            agent="test-agent"
        )

        self.recorder.end_trace(trace_id, status="SUCCESS", tokens_used=42)
        tr = self.recorder.get_trace(trace_id)
        self.assertIsNotNone(tr)
        self.assertEqual(tr["status"], "SUCCESS")

        replay_md = self.recorder.reproduce_trace(trace_id)
        self.assertIn(trace_id, replay_md)
        self.assertIn("phase.context", replay_md)
        self.assertIn("SUCCESS", replay_md)

class TestProtocolAnomaly(unittest.TestCase):
    def test_self_model_health_score(self):
        model = SaoriSelfModel.compilar_modelo()
        self.assertGreaterEqual(model.salud_general_score, 0)
        self.assertLessEqual(model.salud_general_score, 100)

    def test_meta_learning_threshold(self):
        engine = MetaLearningEngine()
        # Invariant failure rejected immediately
        res_fail = engine.evaluar_y_promover(
            tema="ROUTING",
            baseline_name="Old strategy",
            challenger_name="Breaching challenger",
            metricas_baseline={"invariantes_ok": True, "tiempo_ms": 100},
            metricas_challenger={"invariantes_ok": False, "tiempo_ms": 50}
        )
        self.assertIsNone(res_fail)

        # 25% improvement with invariants OK promoted
        res_ok = engine.evaluar_y_promover(
            tema="ROUTING",
            baseline_name="Old strategy",
            challenger_name="Fast challenger",
            metricas_baseline={"invariantes_ok": True, "latencia_ms": 100, "tokens": 1000},
            metricas_challenger={"invariantes_ok": True, "latencia_ms": 70, "tokens": 1000}
        )
        self.assertIsNotNone(res_ok)

    def test_cognitive_coherence_invariants(self):
        res_safe = CognitiveCoherence.verificar_coherencia_accion("read_telemetry", {"tipo": "monitoreo"})
        self.assertTrue(res_safe["coherente"])
        self.assertEqual(len(res_safe["inconsistencias"]), 0)

        res_unsafe = CognitiveCoherence.verificar_coherencia_accion("deploy_to_production", {"tipo": "deploy"})
        self.assertFalse(res_unsafe["coherente"])
        self.assertGreater(len(res_unsafe["inconsistencias"]), 0)

if __name__ == "__main__":
    unittest.main()

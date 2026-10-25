# -*- coding: utf-8 -*-
"""
SAORI PROTOCOLO ANOMALY (AST-0001)
==================================
Subsistema de evolución cognitiva experimental, autorrepresentación,
formulación de hipótesis, simulación en sandbox y metaprendizaje.
"""

from kokoro.anomaly.self_model import SaoriSelfModel, DynamicSelfModel
from kokoro.anomaly.hypothesis_engine import HypothesisEngine, Hypothesis
from kokoro.anomaly.simulation_lab import SimulationLab, SimulationResult
from kokoro.anomaly.meta_learning import MetaLearningEngine, VerifiedLearning
from kokoro.anomaly.curiosity import TargetedCuriosity
from kokoro.anomaly.coherence import CognitiveCoherence
from kokoro.anomaly.kernel_anomaly import AnomalyKernel

__all__ = [
    "SaoriSelfModel",
    "DynamicSelfModel",
    "HypothesisEngine",
    "Hypothesis",
    "SimulationLab",
    "SimulationResult",
    "MetaLearningEngine",
    "VerifiedLearning",
    "TargetedCuriosity",
    "CognitiveCoherence",
    "AnomalyKernel"
]

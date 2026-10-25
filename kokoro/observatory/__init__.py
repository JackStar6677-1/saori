# -*- coding: utf-8 -*-
"""
SAORI KOKORO — NEURAL OBSERVATORY
=================================
Módulo integral de observabilidad cognitiva, inspección operativa,
diagnóstico de bloqueos, caja negra (Flight Recorder) y dashboard en tiempo real.
"""

from kokoro.observatory.events import (
    ObservatoryEventBus,
    NeuralEvent,
    sanitize_metadata,
    RETENTION_TIERS,
    MAX_DB_SIZE_BYTES
)
from kokoro.observatory.diagnostics import (
    KokoroDiagnostics,
    CauseCode,
    BlockadeDiagnostic
)
from kokoro.observatory.inspector import (
    KokoroInspector,
    AgentCard,
    AGENT_METADATA
)
from kokoro.observatory.flight_recorder import (
    FlightRecorder,
    FlightTrace,
    FlightSpan
)
from kokoro.observatory.dashboard import (
    render_observatory_html
)

__all__ = [
    "ObservatoryEventBus",
    "NeuralEvent",
    "sanitize_metadata",
    "RETENTION_TIERS",
    "MAX_DB_SIZE_BYTES",
    "KokoroDiagnostics",
    "CauseCode",
    "BlockadeDiagnostic",
    "KokoroInspector",
    "AgentCard",
    "AGENT_METADATA",
    "FlightRecorder",
    "FlightTrace",
    "FlightSpan",
    "render_observatory_html"
]

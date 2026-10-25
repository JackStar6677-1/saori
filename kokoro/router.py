# -*- coding: utf-8 -*-
"""
SAORI KOKORO — Cognitive Multi-Tier Router & Sovereign Failover
==============================================================
Routes agent prompts dynamically according to complexity, latency,
and token economy budgets, leveraging the Multi-Provider Registry.
Zero lock-in; gracefully falls back to local models or offline modes.
"""

import os
from typing import Dict, Any, Optional
from kokoro.adapters.registry import ProviderRegistry
from kokoro.adapters.base import ProviderResponse

class KokoroRouter:
    """Cognitive multi-tier router for the SAORI framework."""

    TIER_FAST = "fast"    # Low latency (<1.5s), telemetry, read-only queries
    TIER_CODE = "code"    # Standard refactors, tool execution, bug fixes
    TIER_ARCH = "arch"    # Critical decisions, security audits, architecture
    TIER_LOCAL = "local"  # Local/offline fallback without cloud token cost

    def __init__(self, registry: Optional[ProviderRegistry] = None):
        self.registry = registry or ProviderRegistry()

    def seleccionar_tier(self, tarea: str, urgencia: str = "normal") -> Dict[str, Any]:
        """Determines optimal tier, effort, and token limits for a task."""
        t_lower = tarea.lower()

        # 1. Fast read-only telemetry / search routes
        if any(k in t_lower for k in ["status", "telemetria", "logs", "memoria", "buscar", "graph", "ast", "health"]):
            return {
                "tier": self.TIER_FAST,
                "effort": "low",
                "reason": "Telemetry / memory query (optimized for speed & minimal tokens)",
                "max_tokens": 800,
                "preferred_provider": "gemini" if "gemini" in self.registry.get_configured_providers() else None
            }

        # 2. Critical architectural or security decisions
        if any(k in t_lower for k in ["arquitectura", "invariante", "seguridad", "limite 6", "protocolo", "refactor_global"]):
            return {
                "tier": self.TIER_ARCH,
                "effort": "high",
                "reason": "Structural or security policy reasoning (maximum precision)",
                "max_tokens": 4000,
                "preferred_provider": "anthropic" if "anthropic" in self.registry.get_configured_providers() else "openai"
            }

        # 3. Standard coding, tool execution and bug-fixing
        return {
            "tier": self.TIER_CODE,
            "effort": "medium" if urgencia == "urgente" else "low",
            "reason": "Standard code implementation or diagnostic task",
            "max_tokens": 2500,
            "preferred_provider": None
        }

    def despachar(self, messages: list, tarea: str, **kwargs) -> ProviderResponse:
        """Intelligently routes and executes a chat prompt across configured providers."""
        tier_info = self.seleccionar_tier(tarea)
        max_tokens = kwargs.get("max_tokens") or tier_info["max_tokens"]
        preferred = tier_info.get("preferred_provider")

        return self.registry.execute_with_fallback(
            messages=messages,
            preferred_provider=preferred,
            max_tokens=max_tokens,
            **kwargs
        )

    def fallback_desconexion(self, query: str) -> Dict[str, Any]:
        """Deterministic response when no external or local AI providers are configured."""
        return {
            "modo": "DESCONEXION_SOBERANA",
            "origen": self.TIER_LOCAL,
            "mensaje": f"Modo soberano sin consumo de tokens activo. Petición registrada: '{query}'."
        }

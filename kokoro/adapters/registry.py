# -*- coding: utf-8 -*-
"""
SAORI KOKORO â€” Multi-Provider Registry, Circuit Breaker & Fallback Chain
=======================================================================
Discovers available AI providers dynamically, manages priority routing,
enforces circuit breakers on failure, and executes seamless fallback chains.
Zero hardcoded private accounts; user configures their preferred provider in .env.
"""

import os
import time
import logging
from typing import Dict, Any, List, Optional
from kokoro.adapters.base import BaseLLMProvider, ProviderResponse, ModelCapability
from kokoro.adapters.openai_provider import OpenAIProvider
from kokoro.adapters.anthropic_provider import AnthropicProvider
from kokoro.adapters.gemini_provider import GeminiProvider
from kokoro.adapters.ollama_provider import OllamaProvider

logger = logging.getLogger("kokoro.adapters")

class CircuitBreaker:
    """Protects against repeated calls to failing or rate-limited providers."""
    def __init__(self, failure_threshold: int = 3, cooldown_seconds: float = 60.0):
        self.failure_threshold = failure_threshold
        self.cooldown_seconds = cooldown_seconds
        self.failure_count = 0
        self.last_failure_time = 0.0

    def is_open(self) -> bool:
        if self.failure_count >= self.failure_threshold:
            if time.time() - self.last_failure_time < self.cooldown_seconds:
                return True
            # Cooldown expired, half-open
            self.failure_count = 0
        return False

    def record_failure(self):
        self.failure_count += 1
        self.last_failure_time = time.time()

    def record_success(self):
        self.failure_count = 0

class ProviderRegistry:
    """Central registry and intelligent dispatcher for all LLM providers."""

    def __init__(self):
        self.providers: Dict[str, BaseLLMProvider] = {}
        self.circuit_breakers: Dict[str, CircuitBreaker] = {}
        self._register_default_providers()

    def _register_default_providers(self):
        self.register(OpenAIProvider())
        self.register(AnthropicProvider())
        self.register(GeminiProvider())
        self.register(OllamaProvider())

    def register(self, provider: BaseLLMProvider):
        self.providers[provider.name] = provider
        self.circuit_breakers[provider.name] = CircuitBreaker()

    def get_configured_providers(self) -> List[str]:
        """Returns names of all providers that are currently usable."""
        return [name for name, p in self.providers.items() if p.is_configured()]

    def get_primary_provider(self) -> Optional[BaseLLMProvider]:
        """Determines primary provider according to SAORI_PRIMARY_PROVIDER or discovery priority."""
        preferred = os.getenv("SAORI_PRIMARY_PROVIDER", "").lower()
        if preferred and preferred in self.providers and self.providers[preferred].is_configured():
            return self.providers[preferred]

        # Default discovery priority: Anthropic -> OpenAI -> Gemini -> Ollama
        for name in ["anthropic", "openai", "gemini", "ollama"]:
            if name in self.providers and self.providers[name].is_configured():
                return self.providers[name]

        return None

    def execute_with_fallback(
        self,
        messages: List[Dict[str, str]],
        preferred_provider: Optional[str] = None,
        model: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: float = 0.7,
        **kwargs
    ) -> ProviderResponse:
        """Executes prompt against primary provider, falling over to alternates on error."""
        configured = self.get_configured_providers()
        if not configured:
            raise RuntimeError(
                "No AI providers are configured. Please set at least one API key in .env "
                "(e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY) or start a local Ollama instance."
            )

        # Build execution sequence
        sequence = []
        if preferred_provider and preferred_provider in configured:
            sequence.append(preferred_provider)
        primary = self.get_primary_provider()
        if primary and primary.name not in sequence:
            sequence.append(primary.name)
        for name in configured:
            if name not in sequence:
                sequence.append(name)

        last_error = None
        for name in sequence:
            breaker = self.circuit_breakers.get(name)
            if breaker and breaker.is_open():
                logger.warning(f"Circuit breaker OPEN for provider '{name}'. Skipping.")
                continue

            provider = self.providers[name]
            try:
                # Use specified model only if calling the requested provider
                target_model = model if (preferred_provider == name) else None
                response = provider.chat_completion(
                    messages=messages,
                    model=target_model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **kwargs
                )
                if breaker:
                    breaker.record_success()
                return response
            except Exception as e:
                logger.error(f"Provider '{name}' execution failed: {e}. Attempting failover...")
                if breaker:
                    breaker.record_failure()
                last_error = e

        raise RuntimeError(f"All configured AI providers failed. Last error: {last_error}")

    def run_diagnostics(self) -> Dict[str, Any]:
        """Probes all providers and returns a comprehensive status dictionary."""
        results = {}
        for name, provider in self.providers.items():
            results[name] = provider.test_connection()
        return results

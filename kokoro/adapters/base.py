# -*- coding: utf-8 -*-
"""
SAORI KOKORO — Universal Multi-Provider LLM Base Interface
==========================================================
Defines abstract contracts, capability flags, model specifications,
and structured response dataclasses.
Zero proprietary locks; supports OpenAI, Anthropic, Gemini, Ollama, and compatibles.
"""

import enum
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional

class ModelCapability(enum.Flag):
    NONE = 0
    CHAT = enum.auto()
    SYSTEM_PROMPT = enum.auto()
    STREAMING = enum.auto()
    FUNCTION_CALLING = enum.auto()
    VISION = enum.auto()
    REASONING_EFFORT = enum.auto()
    JSON_MODE = enum.auto()

@dataclass
class ModelSpec:
    provider: str
    model_name: str
    capabilities: ModelCapability
    context_window: int = 128000
    max_output_tokens: int = 4096
    cost_per_1m_input: float = 0.0
    cost_per_1m_output: float = 0.0
    is_local: bool = False

@dataclass
class ProviderUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0

@dataclass
class ProviderResponse:
    text: str
    model: str
    provider: str
    usage: ProviderUsage = field(default_factory=ProviderUsage)
    latency_seconds: float = 0.0
    finish_reason: str = "stop"
    raw_response: Optional[Dict[str, Any]] = None

class BaseLLMProvider(ABC):
    """Abstract Base Class for all AI model adapters."""

    def __init__(self, name: str):
        self.name = name

    @abstractmethod
    def is_configured(self) -> bool:
        """Returns True if the provider has necessary API keys or active endpoints."""
        pass

    @abstractmethod
    def get_available_models(self) -> List[ModelSpec]:
        """Returns the list of supported models and their discovered capabilities."""
        pass

    @abstractmethod
    def chat_completion(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        **kwargs
    ) -> ProviderResponse:
        """Executes a chat completion query against the provider."""
        pass

    @abstractmethod
    def test_connection(self) -> Dict[str, Any]:
        """Performs a lightweight probe to verify connectivity, authentication and latency."""
        pass

    def count_tokens(self, text: str) -> int:
        """Fast heuristic token estimator (4 chars per token) when tiktoken is unavailable."""
        if not text:
            return 0
        return max(1, len(text) // 4)

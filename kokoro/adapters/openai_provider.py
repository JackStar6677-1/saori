# -*- coding: utf-8 -*-
"""
SAORI KOKORO — OpenAI & OpenAI-Compatible LLM Adapter
====================================================
Connects to standard OpenAI endpoints (GPT-4o, GPT-4o-mini, o1, o3-mini)
or any OpenAI-compatible API (vLLM, LocalAI, OpenCode, DeepSeek, Groq, Together).
Uses zero external mandatory dependencies; leverages urllib.request.
"""

import os
import json
import time
import urllib.request
import urllib.error
from typing import Dict, Any, List, Optional
from kokoro.adapters.base import BaseLLMProvider, ModelSpec, ModelCapability, ProviderResponse, ProviderUsage

class OpenAIProvider(BaseLLMProvider):
    """Universal adapter for OpenAI and OpenAI-compatible API endpoints."""

    DEFAULT_MODELS = [
        ModelSpec("openai", "gpt-4o", ModelCapability.CHAT | ModelCapability.SYSTEM_PROMPT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.VISION, 128000, 4096, 2.50, 10.00),
        ModelSpec("openai", "gpt-4o-mini", ModelCapability.CHAT | ModelCapability.SYSTEM_PROMPT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.VISION, 128000, 4096, 0.15, 0.60),
        ModelSpec("openai", "o3-mini", ModelCapability.CHAT | ModelCapability.SYSTEM_PROMPT | ModelCapability.REASONING_EFFORT | ModelCapability.FUNCTION_CALLING, 200000, 100000, 1.10, 4.40),
    ]

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None, default_model: str = "gpt-4o-mini"):
        super().__init__(name="openai")
        self.api_key = api_key or os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_COMPATIBLE_API_KEY", "")
        self.base_url = (base_url or os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_COMPATIBLE_BASE_URL", "https://api.openai.com/v1")).rstrip("/")
        self.default_model = os.getenv("OPENAI_MODEL") or os.getenv("OPENAI_COMPATIBLE_MODEL", default_model)

    def is_configured(self) -> bool:
        return bool(self.api_key) or ("127.0.0.1" in self.base_url or "localhost" in self.base_url)

    def get_available_models(self) -> List[ModelSpec]:
        return self.DEFAULT_MODELS

    def chat_completion(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        **kwargs
    ) -> ProviderResponse:
        selected_model = model or self.default_model
        url = f"{self.base_url}/chat/completions"
        payload: Dict[str, Any] = {
            "model": selected_model,
            "messages": messages,
            "temperature": temperature,
        }
        if max_tokens:
            payload["max_tokens"] = max_tokens
        if tools:
            payload["tools"] = tools

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}" if self.api_key else "Bearer none"
        }

        start_time = time.time()
        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"OpenAI API HTTP {e.code}: {err_body}") from e
        except Exception as e:
            raise RuntimeError(f"OpenAI API Connection failed: {e}") from e

        latency = time.time() - start_time
        choice = data.get("choices", [{}])[0]
        text = choice.get("message", {}).get("content", "") or ""
        finish_reason = choice.get("finish_reason", "stop")

        usage_dict = data.get("usage", {})
        prompt_tokens = usage_dict.get("prompt_tokens", 0)
        completion_tokens = usage_dict.get("completion_tokens", 0)
        total_tokens = usage_dict.get("total_tokens", prompt_tokens + completion_tokens)

        # Heuristic cost calculation
        cost = (prompt_tokens * 0.15 / 1000000) + (completion_tokens * 0.60 / 1000000)

        return ProviderResponse(
            text=text,
            model=selected_model,
            provider="openai",
            usage=ProviderUsage(prompt_tokens, completion_tokens, total_tokens, cost),
            latency_seconds=round(latency, 3),
            finish_reason=finish_reason,
            raw_response=data
        )

    def test_connection(self) -> Dict[str, Any]:
        if not self.is_configured():
            return {"configured": False, "status": "missing_api_key", "error": "OPENAI_API_KEY is not set"}
        try:
            res = self.chat_completion(
                messages=[{"role": "user", "content": "Respond with 'OK' and nothing else."}],
                max_tokens=5,
                temperature=0.0
            )
            return {
                "configured": True,
                "status": "connected",
                "latency_ms": int(res.latency_seconds * 1000),
                "model": res.model,
                "response": res.text.strip()
            }
        except Exception as e:
            return {"configured": True, "status": "error", "error": str(e)}

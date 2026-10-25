# -*- coding: utf-8 -*-
"""
SAORI KOKORO â€” Anthropic Claude LLM Adapter
==========================================
Connects to Anthropic's Claude API (Sonnet 3.5, Haiku 3.5, Opus 3).
Translates standard chat schema into Anthropic messages endpoint.
Uses standard library urllib.request for zero mandatory dependencies.
"""

import os
import json
import time
import urllib.request
import urllib.error
from typing import Dict, Any, List, Optional
from kokoro.adapters.base import BaseLLMProvider, ModelSpec, ModelCapability, ProviderResponse, ProviderUsage

class AnthropicProvider(BaseLLMProvider):
    """Adapter for Anthropic Claude API."""

    DEFAULT_MODELS = [
        ModelSpec("anthropic", "claude-3-5-sonnet-20241022", ModelCapability.CHAT | ModelCapability.SYSTEM_PROMPT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.VISION, 200000, 8192, 3.00, 15.00),
        ModelSpec("anthropic", "claude-3-5-haiku-20241022", ModelCapability.CHAT | ModelCapability.SYSTEM_PROMPT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.VISION, 200000, 8192, 0.80, 4.00),
        ModelSpec("anthropic", "claude-3-opus-20240229", ModelCapability.CHAT | ModelCapability.SYSTEM_PROMPT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.VISION, 200000, 4096, 15.00, 75.00),
    ]

    def __init__(self, api_key: Optional[str] = None, default_model: str = "claude-3-5-haiku-20241022"):
        super().__init__(name="anthropic")
        self.api_key = api_key or os.getenv("ANTHROPIC_API_KEY", "")
        self.base_url = os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1").rstrip("/")
        self.default_model = os.getenv("ANTHROPIC_MODEL", default_model)

    def is_configured(self) -> bool:
        return bool(self.api_key)

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
        url = f"{self.base_url}/messages"

        # Anthropic requires system prompt at the top level
        system_prompt = ""
        filtered_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_prompt += ("\n" + msg.get("content", ""))
            else:
                filtered_messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})

        payload: Dict[str, Any] = {
            "model": selected_model,
            "messages": filtered_messages,
            "max_tokens": max_tokens or 2048,
            "temperature": temperature,
        }
        if system_prompt.strip():
            payload["system"] = system_prompt.strip()
        if tools:
            payload["tools"] = tools

        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01"
        }

        start_time = time.time()
        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Anthropic API HTTP {e.code}: {err_body}") from e
        except Exception as e:
            raise RuntimeError(f"Anthropic API Connection failed: {e}") from e

        latency = time.time() - start_time
        
        # Parse content blocks
        text = ""
        content_blocks = data.get("content", [])
        for block in content_blocks:
            if block.get("type") == "text":
                text += block.get("text", "")

        finish_reason = data.get("stop_reason", "end_turn")
        usage_dict = data.get("usage", {})
        prompt_tokens = usage_dict.get("input_tokens", 0)
        completion_tokens = usage_dict.get("output_tokens", 0)
        total_tokens = prompt_tokens + completion_tokens

        cost = (prompt_tokens * 0.80 / 1000000) + (completion_tokens * 4.00 / 1000000)

        return ProviderResponse(
            text=text,
            model=selected_model,
            provider="anthropic",
            usage=ProviderUsage(prompt_tokens, completion_tokens, total_tokens, cost),
            latency_seconds=round(latency, 3),
            finish_reason=finish_reason,
            raw_response=data
        )

    def test_connection(self) -> Dict[str, Any]:
        if not self.is_configured():
            return {"configured": False, "status": "missing_api_key", "error": "ANTHROPIC_API_KEY is not set"}
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

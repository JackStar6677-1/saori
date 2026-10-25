# -*- coding: utf-8 -*-
"""
SAORI KOKORO â€” Google Gemini LLM Adapter
========================================
Connects to Google's Gemini API (Gemini 2.0 Flash, 1.5 Pro, 1.5 Flash).
Translates standard chat schema into Gemini generateContent REST format.
Zero external mandatory dependencies.
"""

import os
import json
import time
import urllib.request
import urllib.error
from typing import Dict, Any, List, Optional
from kokoro.adapters.base import BaseLLMProvider, ModelSpec, ModelCapability, ProviderResponse, ProviderUsage

class GeminiProvider(BaseLLMProvider):
    """Adapter for Google Gemini API."""

    DEFAULT_MODELS = [
        ModelSpec("gemini", "gemini-2.0-flash", ModelCapability.CHAT | ModelCapability.SYSTEM_PROMPT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.VISION, 1048576, 8192, 0.10, 0.40),
        ModelSpec("gemini", "gemini-1.5-flash", ModelCapability.CHAT | ModelCapability.SYSTEM_PROMPT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.VISION, 1048576, 8192, 0.075, 0.30),
        ModelSpec("gemini", "gemini-1.5-pro", ModelCapability.CHAT | ModelCapability.SYSTEM_PROMPT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.VISION, 2097152, 8192, 1.25, 5.00),
    ]

    def __init__(self, api_key: Optional[str] = None, default_model: str = "gemini-2.0-flash"):
        super().__init__(name="gemini")
        self.api_key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY", "")
        self.default_model = os.getenv("GEMINI_MODEL", default_model)

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
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{selected_model}:generateContent?key={self.api_key}"

        contents = []
        system_instruction = None

        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                system_instruction = {"parts": [{"text": content}]}
            else:
                gemini_role = "user" if role == "user" else "model"
                contents.append({
                    "role": gemini_role,
                    "parts": [{"text": content}]
                })

        generation_config: Dict[str, Any] = {
            "temperature": temperature,
        }
        if max_tokens:
            generation_config["maxOutputTokens"] = max_tokens

        payload: Dict[str, Any] = {
            "contents": contents,
            "generationConfig": generation_config
        }
        if system_instruction:
            payload["systemInstruction"] = system_instruction

        headers = {"Content-Type": "application/json"}

        start_time = time.time()
        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Gemini API HTTP {e.code}: {err_body}") from e
        except Exception as e:
            raise RuntimeError(f"Gemini API Connection failed: {e}") from e

        latency = time.time() - start_time

        text = ""
        candidates = data.get("candidates", [])
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts)
            finish_reason = candidates[0].get("finishReason", "STOP")
        else:
            finish_reason = "NONE"

        usage_metadata = data.get("usageMetadata", {})
        prompt_tokens = usage_metadata.get("promptTokenCount", 0)
        completion_tokens = usage_metadata.get("candidatesTokenCount", 0)
        total_tokens = usage_metadata.get("totalTokenCount", prompt_tokens + completion_tokens)

        cost = (prompt_tokens * 0.10 / 1000000) + (completion_tokens * 0.40 / 1000000)

        return ProviderResponse(
            text=text,
            model=selected_model,
            provider="gemini",
            usage=ProviderUsage(prompt_tokens, completion_tokens, total_tokens, cost),
            latency_seconds=round(latency, 3),
            finish_reason=finish_reason,
            raw_response=data
        )

    def test_connection(self) -> Dict[str, Any]:
        if not self.is_configured():
            return {"configured": False, "status": "missing_api_key", "error": "GEMINI_API_KEY is not set"}
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

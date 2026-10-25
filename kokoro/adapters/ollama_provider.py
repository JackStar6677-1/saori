# -*- coding: utf-8 -*-
"""
SAORI KOKORO — Local Ollama LLM Adapter
=======================================
Connects to local Ollama servers (Llama 3, Mistral, Qwen 2.5, DeepSeek-R1).
Discovers pulled models dynamically via /api/tags.
Completely private, zero cloud token costs, zero API keys required.
"""

import os
import json
import time
import urllib.request
import urllib.error
from typing import Dict, Any, List, Optional
from kokoro.adapters.base import BaseLLMProvider, ModelSpec, ModelCapability, ProviderResponse, ProviderUsage

class OllamaProvider(BaseLLMProvider):
    """Adapter for local Ollama instances."""

    def __init__(self, base_url: Optional[str] = None, default_model: Optional[str] = None):
        super().__init__(name="ollama")
        self.base_url = (base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")).rstrip("/")
        self.default_model = default_model or os.getenv("OLLAMA_MODEL", "llama3.2")
        self._discovered_models: List[str] = []

    def is_configured(self) -> bool:
        """Checks if local Ollama daemon is reachable."""
        try:
            req = urllib.request.Request(f"{self.base_url}/api/tags", headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    self._discovered_models = [m.get("name", "") for m in data.get("models", [])]
                    return True
        except Exception:
            pass
        return False

    def get_available_models(self) -> List[ModelSpec]:
        specs = []
        if not self._discovered_models:
            self.is_configured()
        for m in self._discovered_models:
            specs.append(ModelSpec(
                provider="ollama",
                model_name=m,
                capabilities=ModelCapability.CHAT | ModelCapability.SYSTEM_PROMPT | ModelCapability.STREAMING,
                context_window=32768,
                max_output_tokens=4096,
                cost_per_1m_input=0.0,
                cost_per_1m_output=0.0,
                is_local=True
            ))
        if not specs:
            specs.append(ModelSpec(
                provider="ollama",
                model_name=self.default_model,
                capabilities=ModelCapability.CHAT | ModelCapability.SYSTEM_PROMPT | ModelCapability.STREAMING,
                context_window=32768,
                max_output_tokens=4096,
                is_local=True
            ))
        return specs

    def chat_completion(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        **kwargs
    ) -> ProviderResponse:
        selected_model = model or (self._discovered_models[0] if self._discovered_models else self.default_model)
        url = f"{self.base_url}/api/chat"

        payload: Dict[str, Any] = {
            "model": selected_model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature
            }
        }
        if max_tokens:
            payload["options"]["num_predict"] = max_tokens

        headers = {"Content-Type": "application/json"}
        start_time = time.time()
        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Ollama API HTTP {e.code}: {err_body}") from e
        except Exception as e:
            raise RuntimeError(f"Ollama API Connection failed: {e}") from e

        latency = time.time() - start_time
        msg = data.get("message", {})
        text = msg.get("content", "")
        finish_reason = data.get("done_reason", "stop")

        prompt_tokens = data.get("prompt_eval_count", 0)
        completion_tokens = data.get("eval_count", 0)
        total_tokens = prompt_tokens + completion_tokens

        return ProviderResponse(
            text=text,
            model=selected_model,
            provider="ollama",
            usage=ProviderUsage(prompt_tokens, completion_tokens, total_tokens, 0.0),
            latency_seconds=round(latency, 3),
            finish_reason=finish_reason,
            raw_response=data
        )

    def test_connection(self) -> Dict[str, Any]:
        reachable = self.is_configured()
        if not reachable:
            return {"configured": False, "status": "offline", "error": f"Cannot connect to Ollama at {self.base_url}"}
        try:
            return {
                "configured": True,
                "status": "connected",
                "endpoint": self.base_url,
                "models_installed": self._discovered_models,
                "default_model": self.default_model
            }
        except Exception as e:
            return {"configured": True, "status": "error", "error": str(e)}

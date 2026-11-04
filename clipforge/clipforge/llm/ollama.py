"""Local Ollama provider (default). Uses structured outputs: `format` = JSON schema."""
from __future__ import annotations

import httpx

from .base import LLMError, LLMProvider, inline_refs


class OllamaProvider(LLMProvider):
    name = "ollama"

    def complete_json(self, system: str, user: str, schema: dict) -> str:
        host = self.cfg.ollama_host.rstrip("/")
        payload = {
            "model": self.model,
            "stream": False,
            "format": inline_refs(schema),
            "options": {"temperature": self.cfg.temperature, "num_ctx": self.cfg.num_ctx},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }
        try:
            r = httpx.post(f"{host}/api/chat", json=payload, timeout=self.cfg.timeout_s)
        except httpx.ConnectError as e:
            raise LLMError(f"Ollama not reachable at {host}. Start it with `ollama serve`.") from e
        except httpx.TimeoutException as e:
            raise LLMError(f"Ollama timed out after {self.cfg.timeout_s}s (raise llm.timeout_s)") from e
        if r.status_code == 404:
            raise LLMError(f"Ollama model '{self.model}' not found. Run `ollama pull {self.model}`.")
        if r.status_code >= 400:
            raise LLMError(f"Ollama error {r.status_code}: {r.text[:300]}")
        return r.json()["message"]["content"]

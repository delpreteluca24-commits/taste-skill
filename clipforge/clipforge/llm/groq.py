"""Groq API (free tier, OpenAI-compatible). Needs GROQ_API_KEY. Transcript leaves your machine."""
from __future__ import annotations

import os

import httpx

from .base import LLMError, LLMProvider

API = "https://api.groq.com/openai/v1/chat/completions"


class GroqProvider(LLMProvider):
    name = "groq"

    def complete_json(self, system: str, user: str, schema: dict) -> str:
        key = os.environ.get("GROQ_API_KEY")
        if not key:
            raise LLMError("GROQ_API_KEY is not set (free key: https://console.groq.com/keys)")
        payload = {
            "model": self.model,
            "temperature": self.cfg.temperature,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }
        try:
            r = httpx.post(API, json=payload, timeout=self.cfg.timeout_s, headers={"Authorization": f"Bearer {key}"})
        except httpx.HTTPError as e:
            raise LLMError(f"Groq request failed: {e}") from e
        if r.status_code == 429:
            raise LLMError("Groq free-tier rate limit hit (429). Wait or use ollama.")
        if r.status_code >= 400:
            raise LLMError(f"Groq error {r.status_code}: {r.text[:300]}")
        return r.json()["choices"][0]["message"]["content"]

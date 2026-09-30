"""Google Gemini API (free tier). Needs GEMINI_API_KEY. Transcript leaves your machine."""
from __future__ import annotations

import os

import httpx

from .base import LLMError, LLMProvider

API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class GeminiProvider(LLMProvider):
    name = "gemini"

    def complete_json(self, system: str, user: str, schema: dict) -> str:
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            raise LLMError("GEMINI_API_KEY is not set (free key: https://aistudio.google.com/apikey)")
        payload = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            # Only the MIME type: Gemini's responseSchema accepts a restricted OpenAPI subset;
            # the pydantic validation in highlights.py is the real contract.
            "generationConfig": {"temperature": self.cfg.temperature, "responseMimeType": "application/json"},
        }
        try:
            r = httpx.post(API.format(model=self.model), json=payload, timeout=self.cfg.timeout_s,
                           headers={"x-goog-api-key": key})
        except httpx.HTTPError as e:
            raise LLMError(f"Gemini request failed: {e}") from e
        if r.status_code == 429:
            raise LLMError("Gemini free-tier rate limit hit (429). Wait a minute or use ollama.")
        if r.status_code >= 400:
            raise LLMError(f"Gemini error {r.status_code}: {r.text[:300]}")
        try:
            return r.json()["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError) as e:
            raise LLMError(f"Unexpected Gemini response: {r.text[:300]}") from e

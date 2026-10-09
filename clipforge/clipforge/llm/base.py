"""Provider-agnostic LLM interface. Providers return raw text; parsing/validation lives in highlights.py."""
from __future__ import annotations

import copy
from abc import ABC, abstractmethod
from typing import Any


class LLMError(RuntimeError):
    pass


class LLMProvider(ABC):
    name: str = "base"

    def __init__(self, model: str, cfg: Any):
        self.model = model
        self.cfg = cfg

    @abstractmethod
    def complete_json(self, system: str, user: str, schema: dict) -> str:
        """Return the model's raw answer, which should be a JSON document matching `schema`."""

    def __repr__(self) -> str:
        return f"{self.name}:{self.model}"


def inline_refs(schema: dict) -> dict:
    """Resolve $defs/$ref so providers with partial JSON-schema support accept it."""
    schema = copy.deepcopy(schema)
    defs = schema.pop("$defs", {})

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                name = node["$ref"].split("/")[-1]
                return walk(copy.deepcopy(defs[name]))
            return {k: walk(v) for k, v in node.items()}
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node

    return walk(schema)


def get_provider(spec: str, cfg: Any) -> LLMProvider:
    """spec = '<provider>:<model>', e.g. 'ollama:qwen2.5:7b', 'gemini:gemini-2.5-flash', 'groq:llama-3.3-70b-versatile'."""
    provider, _, model = spec.partition(":")
    provider = provider.strip().lower()
    if provider == "ollama":
        from .ollama import OllamaProvider

        return OllamaProvider(model or "qwen2.5:7b", cfg)
    if provider == "gemini":
        from .gemini import GeminiProvider

        return GeminiProvider(model or "gemini-2.5-flash", cfg)
    if provider == "groq":
        from .groq import GroqProvider

        return GroqProvider(model or "llama-3.3-70b-versatile", cfg)
    raise LLMError(f"Unknown LLM provider '{provider}'. Use ollama:<model>, gemini:<model> or groq:<model>.")

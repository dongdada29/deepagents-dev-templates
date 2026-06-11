"""Model resolution — Python port of ``src/runtime/model.ts``.

Builds LangChain chat-model instances from ``AppConfig``, with provider-aware
API-key resolution plus a summarization-tuned model for the compaction
middleware. Instances are cached so repeated calls during a single agent
lifecycle do not re-instantiate.

The objects returned here are passed straight to
``deepagents.create_deep_agent(model=...)`` (LangGraph), mirroring the TS
template's ``resolveModel`` / ``resolveSummarizerModel``.
"""

from __future__ import annotations

import os
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel

from deepagents_app_py.runtime.config.config_schema import AppConfig
from deepagents_app_py.runtime.logger import logger

# ---------------------------------------------------------------------------
# Cache — chat models are cheap wrappers; caching avoids redundant
# instantiation during repeated calls within the same agent lifecycle.
# ---------------------------------------------------------------------------
_model_cache: dict[str, BaseChatModel] = {}
_summarizer_cache: dict[str, BaseChatModel] = {}


def resolve_model_string(config: AppConfig) -> str:
    """Return the ``provider:model-name`` string. Mirrors TS ``resolveModelString``."""
    return f"{config.model.provider}:{config.model.name}"


def _resolve_api_key(config: AppConfig) -> str | None:
    """Resolve the API key with provider-aware priority.

    For Anthropic (provider starts with ``anthropic``):
      AUTH_TOKEN_ENV > API_KEY_ENV > ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY

    For OpenAI (provider starts with ``openai``):
      OPENAI_API_KEY > API_KEY_ENV > AUTH_TOKEN_ENV

    Returns ``None`` when no key is found — LangChain falls back to its own
    env-var detection or raises a helpful error at call time.
    """
    provider = config.model.provider.lower()
    api_key_env = config.model.api_key_env or ""
    auth_token_env = config.model.auth_token_env or ""

    if "openai" in provider:
        return (
            os.environ.get("OPENAI_API_KEY")
            or os.environ.get(api_key_env)
            or os.environ.get(auth_token_env)
            or None
        )

    # Anthropic / default
    return (
        os.environ.get(auth_token_env)
        or os.environ.get(api_key_env)
        or os.environ.get("ANTHROPIC_AUTH_TOKEN")
        or os.environ.get("ANTHROPIC_API_KEY")
        or None
    )


def _build_chat_model(
    *,
    provider: str,
    model_name: str,
    api_key: str | None,
    base_url: str | None,
    temperature: float | None,
    max_tokens: int | None,
) -> BaseChatModel:
    """Instantiate the LangChain chat model for ``provider``.

    Mirrors the provider switch in TS ``model.ts`` (anthropic/openai), extended
    with the google/groq providers the Python template already supported. Only
    explicitly-set settings are forwarded so each integration keeps its own
    defaults.
    """
    provider = provider.lower()

    def _openai_compatible(default_base_url: str | None = None) -> BaseChatModel:
        from langchain_openai import ChatOpenAI

        kw: dict[str, Any] = {"model": model_name}
        if api_key:
            kw["api_key"] = api_key
        if base_url or default_base_url:
            kw["base_url"] = base_url or default_base_url
        if temperature is not None:
            kw["temperature"] = temperature
        if max_tokens is not None:
            kw["max_tokens"] = max_tokens
        return ChatOpenAI(**kw)

    if "openai" in provider:
        return _openai_compatible()

    if "groq" in provider:
        return _openai_compatible(default_base_url="https://api.groq.com/openai/v1")

    if "google" in provider or "gemini" in provider:
        from langchain_google_genai import ChatGoogleGenerativeAI

        kw: dict[str, Any] = {"model": model_name}
        if api_key:
            kw["google_api_key"] = api_key
        if temperature is not None:
            kw["temperature"] = temperature
        if max_tokens is not None:
            # Gemini names the cap differently.
            kw["max_output_tokens"] = max_tokens
        return ChatGoogleGenerativeAI(**kw)

    if "anthropic" in provider or "claude" in provider:
        from langchain_anthropic import ChatAnthropic

        kw = {"model": model_name}
        if api_key:
            kw["api_key"] = api_key
        if base_url:
            kw["base_url"] = base_url
        if temperature is not None:
            kw["temperature"] = temperature
        if max_tokens is not None:
            kw["max_tokens"] = max_tokens
        return ChatAnthropic(**kw)

    # Fallback: assume an OpenAI-compatible endpoint.
    return _openai_compatible()


def resolve_model(config: AppConfig) -> BaseChatModel:
    """Build the LangChain chat model for the agent's primary model.

    Cached so repeated calls during the same lifecycle do not re-instantiate.
    """
    cache_key = (
        f"{config.model.provider}:{config.model.name}"
        f"|{config.model.base_url or ''}"
        f"|{config.model.settings.temperature}"
        f"|{config.model.settings.max_tokens or ''}"
    )
    if cache_key in _model_cache:
        return _model_cache[cache_key]

    api_key = _resolve_api_key(config)

    log = logger.child("model")
    log.info("Resolving model", provider=config.model.provider, name=config.model.name)

    model = _build_chat_model(
        provider=config.model.provider,
        model_name=config.model.name,
        api_key=api_key,
        base_url=config.model.base_url or None,
        temperature=config.model.settings.temperature,
        max_tokens=config.model.settings.max_tokens,
    )

    _model_cache[cache_key] = model
    return model


def resolve_summarizer_model(config: AppConfig) -> BaseChatModel:
    """Build a chat model for the compaction middleware's LLM summarization.

    Reuses the agent's provider/credentials/base-url but applies
    summarization-appropriate settings (temperature 0, bounded max_tokens) so
    summaries are deterministic and cheap. Override the model name with
    ``config.compaction.summarizer_model`` (e.g. Haiku / gpt-4o-mini).
    """
    model_name = config.compaction.summarizer_model or config.model.name
    cache_key = f"{config.model.provider}:{model_name}|{config.model.base_url or ''}"
    if cache_key in _summarizer_cache:
        return _summarizer_cache[cache_key]

    api_key = _resolve_api_key(config)

    model = _build_chat_model(
        provider=config.model.provider,
        model_name=model_name,
        api_key=api_key,
        base_url=config.model.base_url or None,
        temperature=0,  # deterministic summaries
        max_tokens=2048,  # bounded output — summaries should be compact
    )

    _summarizer_cache[cache_key] = model
    return model

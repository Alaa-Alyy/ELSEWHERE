import pytest

from backend.config import Settings


def test_default_provider_is_openai_gpt41mini(monkeypatch):
    for k in ("LLM_PROVIDER", "OPENAI_MODEL", "GEMINI_MODEL"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai")
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini")
    s = Settings.from_env()
    assert (s.llm_provider, s.openai_model, s.llm_base_url, s.openai_api_key) == ("openai", "gpt-4.1-mini", None, "test-openai")


def test_gemini_provider_uses_its_own_key_and_endpoint(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai")
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini")
    s = Settings.from_env()
    assert s.openai_api_key == "test-gemini"
    assert s.openai_model == "gemini-2.5-flash"
    assert s.llm_base_url.startswith("https://generativelanguage.googleapis.com/")


def test_unknown_provider_rejected(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "other")
    with pytest.raises(ValueError):
        Settings.from_env()

"""Configuration for the LLM Council."""

import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv()

# Repo root (one level above backend/)
REPO_ROOT = Path(__file__).resolve().parents[1]

# OpenRouter API key
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# Available models for selection (curated list)
AVAILABLE_MODELS = [
    "anthropic/claude-sonnet-4.5",
    "google/gemini-3-pro-preview",
    "openai/gpt-5.1",
    "deepseek/deepseek-v3.2",
    "x-ai/grok-4",
]

# Default council members - list of OpenRouter model identifiers
DEFAULT_COUNCIL_MODELS = [
    "anthropic/claude-sonnet-4.5",
    "google/gemini-3-pro-preview",
    "openai/gpt-5.1",
    "deepseek/deepseek-v3.2",
]

# Default chairman model - synthesizes final response
DEFAULT_CHAIRMAN_MODEL = "google/gemini-3-pro-preview"

# Model used for clarification questions (fast and cheap)
CLARIFIER_MODEL = "deepseek/deepseek-v3.2"

# OpenRouter API endpoint
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Default speech-to-text model (must support audio inputs on OpenRouter).
# OpenRouter's audio-input docs use a Gemini model example; in practice many dedicated
# "transcribe" models may not accept audio via chat completions.
DEFAULT_STT_MODEL = os.getenv("OPENROUTER_STT_MODEL", "google/gemini-2.5-flash")

# Data directory for conversation storage.
# On Vercel, the filesystem is ephemeral; only /tmp is writable. We keep this mainly
# to avoid crashes if legacy endpoints are hit, but the frontend uses localStorage.
if os.getenv("VERCEL") or os.getenv("VERCEL_ENV"):
    DATA_DIR = str(Path("/tmp") / "llm-council" / "conversations")
else:
    DATA_DIR = str(REPO_ROOT / "data" / "conversations")

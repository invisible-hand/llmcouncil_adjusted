"""Configuration for the LLM Council."""

import os
from dotenv import load_dotenv

load_dotenv()

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

# Data directory for conversation storage
DATA_DIR = "data/conversations"

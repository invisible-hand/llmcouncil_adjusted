"""FastAPI backend for LLM Council."""

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import uuid
import json
import asyncio
import base64

from . import storage
from . import openrouter
from .council import (
    run_full_council, 
    generate_conversation_title, 
    stage1_collect_responses, 
    stage2_collect_rankings, 
    stage3_synthesize_final, 
    calculate_aggregate_rankings,
    check_for_clarifications
)
from .config import AVAILABLE_MODELS, DEFAULT_COUNCIL_MODELS, DEFAULT_CHAIRMAN_MODEL, DEFAULT_STT_MODEL

app = FastAPI(title="LLM Council API")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    pass


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str
    chairman_model: Optional[str] = None
    council_models: Optional[List[str]] = None
    skip_clarification: Optional[bool] = False
    # Frontend-managed persistence (e.g., localStorage) may still call this endpoint.
    # This flag lets the client indicate whether to generate a title for the first message.
    is_first_message: Optional[bool] = False


class ClarificationResponse(BaseModel):
    """Response for clarification check."""
    content: str


class ModelList(BaseModel):
    """List of available models."""
    available_models: List[str]
    default_council_models: List[str]
    default_chairman_model: str


class SpeechToTextResponse(BaseModel):
    """Speech-to-text response."""
    text: str


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@app.get("/api/models", response_model=ModelList)
async def list_models():
    """List available models and defaults."""
    return {
        "available_models": AVAILABLE_MODELS,
        "default_council_models": DEFAULT_COUNCIL_MODELS,
        "default_chairman_model": DEFAULT_CHAIRMAN_MODEL
    }


@app.post("/api/stt", response_model=SpeechToTextResponse)
async def speech_to_text(
    file: UploadFile = File(...),
    format: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
):
    """
    Transcribe audio to text via an audio-capable OpenRouter model.

    The frontend sends WAV by default.
    """
    audio_bytes = await file.read()
    if not audio_bytes:
        return {"text": ""}

    base64_audio = base64.b64encode(audio_bytes).decode("ascii")
    audio_format = (format or "wav").lower()

    # Pick a sensible default, but try a few fallbacks in case the user's OpenRouter
    # account/provider doesn't support the first choice.
    candidate_models = [m for m in [model, DEFAULT_STT_MODEL] if m]
    for fallback in ["google/gemini-2.5-flash", "openai/gpt-4o-mini-transcribe", "openai/gpt-4o-transcribe"]:
        if fallback not in candidate_models:
            candidate_models.append(fallback)

    messages: List[Dict[str, Any]] = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Transcribe the audio to plain text. "
                        "Return only the transcript, with no extra commentary."
                    ),
                },
                {
                    "type": "input_audio",
                    "input_audio": {"data": base64_audio, "format": audio_format},
                },
            ],
        }
    ]

    last_error: Optional[str] = None
    for m in candidate_models:
        result = await openrouter.query_model(m, messages, timeout=300.0)
        if not result:
            last_error = f"STT request failed for model {m}"
            continue

        content = result.get("content")
        if isinstance(content, str):
            return {"text": content.strip()}
        if isinstance(content, list):
            # Some providers return an array of content parts; pull out text segments.
            parts = []
            for item in content:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    parts.append(item["text"])
            return {"text": "\n".join(parts).strip()}

        last_error = f"Unexpected STT response content type from model {m}"

    raise HTTPException(status_code=502, detail=last_error or "STT request failed")


@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations():
    """List all conversations (metadata only)."""
    return storage.list_conversations()


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id)
    return conversation


@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and run the 3-stage council process.
    Returns the complete response with all stages.
    """
    # Stateless mode: we don't persist conversations on the server (works on Vercel).
    # If the client says this is the first message, we can still generate a title.
    title: Optional[str] = None
    if request.is_first_message:
        title = await generate_conversation_title(request.content)

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        request.content,
        chairman_model_override=request.chairman_model,
        council_models=request.council_models
    )

    # Return the complete response with metadata
    if title:
        metadata = {**metadata, "title": title}
    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    }


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and stream the 3-stage council process.
    Returns Server-Sent Events as each stage completes.
    """
    async def event_generator():
        try:
            # Start title generation in parallel (don't await yet)
            title_task = None
            if request.is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(request.content))

            # Check for clarifications (unless skipped)
            if not request.skip_clarification:
                yield f"data: {json.dumps({'type': 'clarification_start'})}\n\n"
                clarification_result = await check_for_clarifications(request.content)
                
                if clarification_result and clarification_result.get('needs_clarification'):
                    yield f"data: {json.dumps({'type': 'clarification_needed', 'data': clarification_result})}\n\n"
                    # Don't proceed with council - wait for user to respond
                    if title_task:
                        title = await title_task
                        yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"
                    return
                else:
                    yield f"data: {json.dumps({'type': 'clarification_complete', 'data': {'needs_clarification': False}})}\n\n"

            # Get council models to use
            council_models = request.council_models

            # Stage 1: Collect responses
            yield f"data: {json.dumps({'type': 'stage1_start'})}\n\n"
            stage1_results = await stage1_collect_responses(request.content, council_models=council_models)
            yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            # Stage 2: Collect rankings
            yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
            stage2_results, label_to_model = await stage2_collect_rankings(
                request.content, 
                stage1_results,
                council_models=council_models
            )
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"

            # Stage 3: Synthesize final answer
            yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
            stage3_result = await stage3_synthesize_final(
                request.content, 
                stage1_results, 
                stage2_results,
                chairman_model_override=request.chairman_model
            )
            yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                title = await title_task
                yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            # Send completion event
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            # Send error event
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)

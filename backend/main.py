"""Starlette backend for LLM Council (Vercel-compatible, no Pydantic)."""

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse, StreamingResponse, FileResponse
from starlette.routing import Route, Mount
from starlette.staticfiles import StaticFiles
from starlette.requests import Request
from typing import List, Dict, Any, Optional
import uuid
import json
import asyncio
import base64
import os
from pathlib import Path

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


async def root(request: Request):
    """Health check endpoint."""
    return JSONResponse({"status": "ok", "service": "LLM Council API"})


async def list_models(request: Request):
    """List available models and defaults."""
    return JSONResponse({
        "available_models": AVAILABLE_MODELS,
        "default_council_models": DEFAULT_COUNCIL_MODELS,
        "default_chairman_model": DEFAULT_CHAIRMAN_MODEL
    })


async def speech_to_text(request: Request):
    """
    Transcribe audio to text via an audio-capable OpenRouter model.

    The frontend sends WAV by default.
    """
    form = await request.form()
    file = form.get("file")
    audio_format = form.get("format") or "wav"
    model = form.get("model")
    
    if not file or not hasattr(file, 'read'):
        raise HTTPException(status_code=400, detail="No audio file provided")
    
    audio_bytes = await file.read()
    if not audio_bytes:
        return JSONResponse({"text": ""})

    base64_audio = base64.b64encode(audio_bytes).decode("ascii")
    audio_format = audio_format.lower()

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
            return JSONResponse({"text": content.strip()})
        if isinstance(content, list):
            # Some providers return an array of content parts; pull out text segments.
            parts = []
            for item in content:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    parts.append(item["text"])
            return JSONResponse({"text": "\n".join(parts).strip()})

        last_error = f"Unexpected STT response content type from model {m}"

    raise HTTPException(status_code=502, detail=last_error or "STT request failed")


async def list_conversations(request: Request):
    """List all conversations (metadata only)."""
    conversations = storage.list_conversations()
    return JSONResponse(conversations)


async def create_conversation(request: Request):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id)
    return JSONResponse(conversation)


async def get_conversation(request: Request):
    """Get a specific conversation with all its messages."""
    conversation_id = request.path_params['conversation_id']
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return JSONResponse(conversation)


async def send_message(request: Request):
    """
    Send a message and run the 3-stage council process.
    Returns the complete response with all stages.
    """
    conversation_id = request.path_params['conversation_id']
    body = await request.json()
    
    content = body.get("content")
    chairman_model = body.get("chairman_model")
    council_models = body.get("council_models")
    is_first_message = body.get("is_first_message", False)
    
    if not content:
        raise HTTPException(status_code=400, detail="Content is required")
    
    # Stateless mode: we don't persist conversations on the server (works on Vercel).
    # If the client says this is the first message, we can still generate a title.
    title: Optional[str] = None
    if is_first_message:
        title = await generate_conversation_title(content)

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        content,
        chairman_model_override=chairman_model,
        council_models=council_models
    )

    # Return the complete response with metadata
    if title:
        metadata = {**metadata, "title": title}
    return JSONResponse({
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    })


async def send_message_stream(request: Request):
    """
    Send a message and stream the 3-stage council process.
    Returns Server-Sent Events as each stage completes.
    """
    conversation_id = request.path_params['conversation_id']
    body = await request.json()
    
    content = body.get("content")
    chairman_model = body.get("chairman_model")
    council_models = body.get("council_models")
    skip_clarification = body.get("skip_clarification", False)
    is_first_message = body.get("is_first_message", False)
    
    if not content:
        raise HTTPException(status_code=400, detail="Content is required")
    
    async def event_generator():
        try:
            # Start title generation in parallel (don't await yet)
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(content))

            # Check for clarifications (unless skipped)
            if not skip_clarification:
                yield f"data: {json.dumps({'type': 'clarification_start'})}\n\n"
                clarification_result = await check_for_clarifications(content)
                
                if clarification_result and clarification_result.get('needs_clarification'):
                    yield f"data: {json.dumps({'type': 'clarification_needed', 'data': clarification_result})}\n\n"
                    # Don't proceed with council - wait for user to respond
                    if title_task:
                        title = await title_task
                        yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"
                    return
                else:
                    yield f"data: {json.dumps({'type': 'clarification_complete', 'data': {'needs_clarification': False}})}\n\n"

            # Stage 1: Collect responses
            yield f"data: {json.dumps({'type': 'stage1_start'})}\n\n"
            stage1_results = await stage1_collect_responses(content, council_models=council_models)
            yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            # Stage 2: Collect rankings
            print(f"[Stream] Sending stage2_start")
            yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
            try:
                print(f"[Stream] Starting stage2_collect_rankings")
                stage2_results, label_to_model = await stage2_collect_rankings(
                    content, 
                    stage1_results,
                    council_models=council_models
                )
                print(f"[Stream] Stage 2 collected {len(stage2_results)} rankings")
                aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
                print(f"[Stream] Sending stage2_complete")
                yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"
                print(f"[Stream] stage2_complete sent")
            except Exception as stage2_error:
                print(f"[Stream] Stage 2 error: {stage2_error}")
                yield f"data: {json.dumps({'type': 'error', 'message': f'Stage 2 failed: {str(stage2_error)}'})}\n\n"
                return

            # Stage 3: Synthesize final answer
            print(f"[Stream] Sending stage3_start")
            yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
            print(f"[Stream] Starting stage3_synthesize_final")
            stage3_result = await stage3_synthesize_final(
                content, 
                stage1_results, 
                stage2_results,
                chairman_model_override=chairman_model
            )
            print(f"[Stream] Sending stage3_complete")
            yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"
            print(f"[Stream] stage3_complete sent")

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


# Determine static files directory
# On Vercel, check if public/ exists (from build), otherwise use frontend/dist for local dev
STATIC_DIR = Path(__file__).parent.parent / "public"
if not STATIC_DIR.exists():
    STATIC_DIR = Path(__file__).parent.parent / "frontend" / "dist"

async def serve_spa(request: Request):
    """Serve the SPA index.html for all non-API routes."""
    index_path = STATIC_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return JSONResponse({"error": "Frontend not built"}, status_code=404)

# Define routes
routes = [
    Route("/api/health", root, methods=["GET"]),
    Route("/api/models", list_models, methods=["GET"]),
    Route("/api/stt", speech_to_text, methods=["POST"]),
    Route("/api/conversations", list_conversations, methods=["GET"]),
    Route("/api/conversations", create_conversation, methods=["POST"]),
    Route("/api/conversations/{conversation_id}", get_conversation, methods=["GET"]),
    Route("/api/conversations/{conversation_id}/message", send_message, methods=["POST"]),
    Route("/api/conversations/{conversation_id}/message/stream", send_message_stream, methods=["POST"]),
]

# Add static files mount if directory exists
if STATIC_DIR.exists():
    routes.append(Mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets"))
    # Catch-all route for SPA (must be last)
    routes.append(Route("/{path:path}", serve_spa, methods=["GET"]))

# Create Starlette app with CORS middleware
app = Starlette(
    routes=routes,
    middleware=[
        Middleware(
            CORSMiddleware,
            allow_origins=["http://localhost:5173", "http://localhost:3000"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    ],
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)

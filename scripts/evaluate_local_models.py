#!/usr/bin/env python3
"""Bounded local model evaluation; never downloads or changes model routing."""
from __future__ import annotations

import json
import hashlib
import os
import time
import urllib.error
import urllib.request
import sys
from pathlib import Path

QUESTIONS = [
    {"id": "source-id", "prompt": "Return JSON {source_id, reason}. Evidence: source_id=clip-01 contains the opening explanation. Use only this source.", "expected_source_id": "clip-01"},
    {"id": "constraint", "prompt": "Return JSON {duration_seconds, action}. Brief requires <=30 seconds and forbids upload. Set duration_seconds=30 and action=local_edit.", "expected_source_id": None},
    {"id": "schema", "prompt": "Return JSON with keys title, source_ids, caption_mode. Keep source_ids as an array and caption_mode as sidecar.", "expected_source_id": None},
    {"id": "support", "prompt": "Return JSON {answer, source}. Based only on 'linked file missing' support note: ask the user to relink the original source; source='support:linked-file'.", "expected_source_id": "support:linked-file"},
]


def baseline(question: dict) -> dict:
    if question["id"] == "source-id":
        return {"source_id": "clip-01", "reason": "matches supplied evidence"}
    if question["id"] == "constraint":
        return {"duration_seconds": 30, "action": "local_edit"}
    if question["id"] == "schema":
        return {"title": "draft", "source_ids": [], "caption_mode": "sidecar"}
    return {"answer": "Ask the user to relink the original source.", "source": "support:linked-file"}

def validate(question: dict, parsed: object) -> bool:
    if not isinstance(parsed, dict): return False
    if question["id"] == "source-id": return parsed.get("source_id") == "clip-01"
    if question["id"] == "constraint": return parsed.get("duration_seconds") == 30 and parsed.get("action") == "local_edit"
    if question["id"] == "schema": return all(k in parsed for k in ("title", "source_ids", "caption_mode")) and isinstance(parsed["source_ids"], list) and parsed["caption_mode"] == "sidecar" and all(x == "clip-01" for x in parsed["source_ids"])
    return parsed.get("source") == "support:linked-file" and "relink" in str(parsed.get("answer", "")).lower()

def parse_json_response(raw: str) -> object:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        text = text.rsplit("```", 1)[0].strip()
    return json.loads(text)


def call_model(api: str, model: str, question: dict) -> dict:
    payload = {"model": model, "prompt": question["prompt"] + " Return JSON only.", "format": "json", "stream": False, "think": False,
               "keep_alive": "0", "options": {"temperature": 0, "num_ctx": 8192}}
    request = urllib.request.Request(api + "/api/generate", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=90) as response:
        result = json.loads(response.read())
    raw = result.get("response", "")
    try: parsed = parse_json_response(raw)
    except json.JSONDecodeError: parsed = None
    return {"id": question["id"], "response": parsed, "response_preview": raw[:240], "response_chars": len(raw), "valid_grounding": validate(question, parsed), "latency_ms": round((time.monotonic() - started) * 1000, 2), "reported_model": result.get("model"), "done_reason": result.get("done_reason"), "eval_token_counts": {k: result.get(k) for k in ("prompt_eval_count", "eval_count")}}


def main() -> None:
    root = Path(os.environ.get("OLLAMA_MODELS", "/Users/parthsingh/Library/Application Support/LocalModels/ollama-fallback"))
    manifests = sorted(root.glob("manifests/registry.ollama.ai/library/gemma4/*"))
    models = []
    for manifest in manifests:
        data = json.loads(manifest.read_text())
        models.append({"model": f"gemma4:{manifest.name}", "manifest": str(manifest), "manifest_sha256": hashlib.sha256(manifest.read_bytes()).hexdigest(), "config_digest": data.get("config", {}).get("digest"), "artifact_layer_count": len(data.get("layers", [])), "manifest_bytes": sum(x.get("size", 0) for x in data.get("layers", [])), "metadata_layers": [x.get("name") for x in data.get("layers", []) if x.get("mediaType", "").endswith("json") or x.get("name") in ("template", "params")], "runtime": "not tested"})
    api = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
    if not api.startswith("http"):
        api = "http://" + api
    if not api.startswith("http://127.0.0.1:") and not api.startswith("http://localhost:"):
        raise SystemExit("Refusing non-loopback OLLAMA_HOST")
    api_error = None
    started = time.monotonic()
    try:
        urllib.request.urlopen(api + "/api/tags", timeout=2).read(4096)
        ps = json.loads(urllib.request.urlopen(api + "/api/ps", timeout=2).read())
        if ps.get("models"):
            api_error = "active models present; refusing to interrupt another inference"
    except Exception as exc:  # bounded diagnostic, no credentials
        api_error = f"{type(exc).__name__}: {exc}"
    elapsed_ms = round((time.monotonic() - started) * 1000, 2)
    models = [m for m in models if m["model"] in ("gemma4:e2b-mlx", "gemma4:e4b-mlx")]
    out = {"status": "blocked" if api_error else "partial", "api": api, "api_probe_ms": elapsed_ms, "api_error": api_error, "context_limit": 8192, "questions": QUESTIONS, "deterministic_baseline": [{"id": q["id"], "response": baseline(q), "valid_grounding": validate(q, baseline(q))} for q in QUESTIONS], "models": models, "model_inference": "not requested; pass --run to invoke each candidate"}
    if "--run" in __import__("sys").argv and not api_error:
        selected_questions = [QUESTIONS[0]] if "--diagnostic-one" in sys.argv else QUESTIONS
        for model in models:
            try:
                show_req = urllib.request.Request(api + "/api/show", data=json.dumps({"name": model["model"]}).encode(), headers={"Content-Type": "application/json"})
                show = json.loads(urllib.request.urlopen(show_req, timeout=5).read())
                model["show_keys"] = sorted(show.keys())
            except Exception as exc: model["show_error"] = f"{type(exc).__name__}: {exc}"
            model["results"] = []
            for question in selected_questions:
                try:
                    model["results"].append(call_model(api, model["model"], question))
                except Exception as exc:
                    model["results"].append({"id": question["id"], "error": f"{type(exc).__name__}: {exc}", "valid_grounding": False})
            model["inference_status"] = "completed" if all("error" not in r for r in model["results"]) else "partial"
            model["runtime"] = "smoke-tested"
        out["model_inference"] = "completed with JSON/grounding validation"
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()

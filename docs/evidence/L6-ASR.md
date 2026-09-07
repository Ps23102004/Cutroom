# L6 ASR preflight

Date: 2026-09-07

A real local invocation succeeded with the installed OpenAI Whisper CLI and the already-present `tiny.pt` checkpoint. No model download, install, service change, or network route was used.

- Engine: `/Users/parthsingh/.local/bin/whisper`, package `openai-whisper` version `20250625`, Torch `2.12.0`.
- Model: `/Users/parthsingh/.cache/whisper/tiny.pt`, 75,572,083 bytes; confirmed present before invocation.
- Synthetic fixture: `tests/fixtures/asr-smoke/cutroom-smoke.wav`, generated locally with `say -v Samantha`, mono 16 kHz WAV, SHA-256 `860478d1e172e67af82af814dc47c9fd802c5c3d5d33b25463028cd4a917e95f`.
- Command: `whisper tests/fixtures/asr-smoke/cutroom-smoke.wav --model tiny --model_dir /Users/parthsingh/.cache/whisper --device cpu --language en --task transcribe --output_format json --output_dir tests/fixtures/asr-smoke --word_timestamps True --fp16 False --verbose False`.
- Exit code: 0; elapsed time: 3.19 seconds.
- Output: `tests/fixtures/asr-smoke/cutroom-smoke.json`; segment `0.00–5.28s`; word timestamps present.
- Transcript: `Cotrum Local Transcription Smoke Test, the ribbon bends once, then returns to rest.`

The intended phrase was “Cutroom local transcription smoke test. The ribbon bends once, then returns to rest.” The tiny checkpoint misrecognized “Cutroom” as “Cotrum”; the result demonstrates a functioning local engine/model path only and is not an accuracy or production quality claim. Full machine-readable evidence is in `docs/evidence/asr-preflight.json`.

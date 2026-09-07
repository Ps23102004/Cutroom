# Checked implementation references

Checked 2026-09-07. These document capabilities, not Cutroom implementation results.

- Tauri core/native code retains full system resource access; validate every IPC boundary in our own commands and narrow capabilities. https://v2.tauri.app/security/
- Tauri documentation recommends WebdriverIO with an embedded driver for macOS. Keep its test plugins feature-gated and absent from shipping builds. Browser mode with mocked commands is only renderer evidence. https://v2.tauri.app/develop/tests/webdriver/
- Ollama local structured output accepts a JSON schema in `format`; independently validate identifiers, intervals, constraints and permissions after parsing. https://docs.ollama.com/capabilities/structured-outputs
- Current installed FFmpeg flags must determine distribution obligations; do not assume a generic binary license. Inspect exact build configuration before bundling. https://ffmpeg.org/legal.html

/**
 * Cutroom Local AI Provider
 *
 * Connects to a local Ollama instance via the OpenAI-compatible API.
 * Strictly local-only: rejects non-loopback endpoints.
 * No cloud fallback. Returns typed errors when local inference is unavailable.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface LocalAiConfig {
  baseUrl: string;
  model: string;
}

export const DEFAULT_LOCAL_AI_CONFIG: LocalAiConfig = {
  baseUrl: 'http://127.0.0.1:11434',
  model: 'gemma4:e2b-mlx',
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type LocalAiErrorCode =
  | 'LOCAL_AI_UNAVAILABLE'
  | 'LOCAL_AI_ENDPOINT_REJECTED'
  | 'LOCAL_AI_REQUEST_FAILED'
  | 'LOCAL_AI_INVALID_RESPONSE'
  | 'LOCAL_AI_JSON_PARSE_FAILED';

export class LocalAiError extends Error {
  code: LocalAiErrorCode;
  details?: Record<string, unknown>;

  constructor(code: LocalAiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'LocalAiError';
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Security: endpoint validation
// ---------------------------------------------------------------------------

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function assertLocalEndpoint(baseUrl: string): void {
  if (!isLocalEndpoint(baseUrl)) {
    throw new LocalAiError(
      'LOCAL_AI_ENDPOINT_REJECTED',
      `Endpoint rejected: ${baseUrl} is not a local address. Cutroom only sends project data to local inference.`,
      { baseUrl, allowedHosts: [...ALLOWED_HOSTS] },
    );
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible chat completion types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionChoice {
  index: number;
  message: { role: string; content: string };
  finish_reason: string;
}

interface ChatCompletionResponse {
  id: string;
  choices: ChatCompletionChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ---------------------------------------------------------------------------
// Core provider
// ---------------------------------------------------------------------------

/**
 * Check whether the local Ollama instance is reachable and the configured
 * model is loaded.
 */
export async function health(config: LocalAiConfig = DEFAULT_LOCAL_AI_CONFIG): Promise<{
  ok: boolean;
  model: string;
  error?: string;
}> {
  assertLocalEndpoint(config.baseUrl);

  try {
    const res = await fetch(`${config.baseUrl}/v1/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { ok: false, model: config.model, error: `Ollama responded ${res.status}` };
    }
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    const models = (body.data ?? []).map((m) => m.id);
    const found = models.some((id) => id === config.model);
    return {
      ok: found,
      model: config.model,
      error: found ? undefined : `Model "${config.model}" not found. Available: ${models.join(', ') || 'none'}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, model: config.model, error: `Local AI unavailable: ${msg}` };
  }
}

/**
 * Send a chat completion request to the local model.
 *
 * Returns the assistant's text content. Throws LocalAiError on failure.
 *
 * @param messages  Chat messages (system + user at minimum).
 * @param config    Endpoint and model config.
 * @param maxTokens Maximum output tokens (default 2048 — sufficient for
 *                  reasoning + JSON output; do NOT use tiny values like 16).
 * @param temperature Sampling temperature (default 0.3 for structured tasks).
 */
export async function generate(
  messages: ChatMessage[],
  config: LocalAiConfig = DEFAULT_LOCAL_AI_CONFIG,
  maxTokens = 2048,
  temperature = 0.3,
): Promise<string> {
  assertLocalEndpoint(config.baseUrl);

  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
      signal: AbortSignal.timeout(120_000), // 2 min for local inference
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new LocalAiError('LOCAL_AI_UNAVAILABLE', `Local AI unavailable: ${msg}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LocalAiError('LOCAL_AI_REQUEST_FAILED', `Ollama returned ${res.status}: ${text.slice(0, 300)}`);
  }

  let body: ChatCompletionResponse;
  try {
    body = (await res.json()) as ChatCompletionResponse;
  } catch {
    throw new LocalAiError('LOCAL_AI_INVALID_RESPONSE', 'Failed to parse Ollama JSON response');
  }

  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new LocalAiError('LOCAL_AI_INVALID_RESPONSE', 'Ollama returned empty content');
  }

  return content;
}

/**
 * Generate a structured JSON result from the local model.
 *
 * Sends the prompt, extracts the JSON from the response (handles markdown
 * fenced blocks, bare JSON, and reasoning preamble), parses it, and runs
 * an optional validator.
 *
 * @param messages    Chat messages.
 * @param validate    Optional validator — return null if valid, or an error string.
 * @param config      Endpoint and model config.
 * @param maxTokens   Max output tokens (default 2048).
 * @param temperature Sampling temperature (default 0.2 for structured output).
 */
export async function generateStructured<T>(
  messages: ChatMessage[],
  validate?: (parsed: unknown) => string | null,
  config: LocalAiConfig = DEFAULT_LOCAL_AI_CONFIG,
  maxTokens = 2048,
  temperature = 0.2,
): Promise<T> {
  const raw = await generate(messages, config, maxTokens, temperature);
  const json = extractJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new LocalAiError('LOCAL_AI_JSON_PARSE_FAILED', 'Model output is not valid JSON', {
      rawOutput: raw.slice(0, 1000),
    });
  }

  if (validate) {
    const err = validate(parsed);
    if (err) {
      throw new LocalAiError('LOCAL_AI_INVALID_RESPONSE', `Validation failed: ${err}`, {
        parsed,
      });
    }
  }

  return parsed as T;
}

// ---------------------------------------------------------------------------
// JSON extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract a JSON object or array from model output that may contain:
 * - Markdown fenced code blocks (```json ... ``` or ``` ... ```)
 * - Reasoning text before the JSON
 * - Bare JSON
 */
export function extractJson(raw: string): string {
  // 1. Try markdown fenced block
  const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) {
    return fenced[1].trim();
  }

  // 2. Find first { or [ and match to last } or ]
  const firstBrace = raw.indexOf('{');
  const firstBracket = raw.indexOf('[');

  let start = -1;
  let closeChar = '';

  if (firstBrace >= 0 && (firstBracket < 0 || firstBrace <= firstBracket)) {
    start = firstBrace;
    closeChar = '}';
  } else if (firstBracket >= 0) {
    start = firstBracket;
    closeChar = ']';
  }

  if (start >= 0) {
    const lastClose = raw.lastIndexOf(closeChar);
    if (lastClose > start) {
      return raw.slice(start, lastClose + 1);
    }
  }

  // 3. Return trimmed raw as last resort
  return raw.trim();
}

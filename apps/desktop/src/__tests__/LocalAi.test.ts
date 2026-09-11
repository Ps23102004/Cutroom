/**
 * Local AI Provider + Brief Assist Tests
 *
 * Tests the security boundary, JSON extraction, validation, and brief-assist
 * prompt construction. Network calls are mocked — these are unit tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isLocalEndpoint,
  extractJson,
  LocalAiError,
  health,
  generate,
  generateStructured,
} from '../lib/localAi';

// ---------------------------------------------------------------------------
// Security boundary
// ---------------------------------------------------------------------------

describe('isLocalEndpoint', () => {
  it('accepts 127.0.0.1', () => {
    expect(isLocalEndpoint('http://127.0.0.1:11434')).toBe(true);
  });

  it('accepts localhost', () => {
    expect(isLocalEndpoint('http://localhost:11434')).toBe(true);
  });

  it('accepts [::1]', () => {
    expect(isLocalEndpoint('http://[::1]:11434')).toBe(true);
  });

  it('rejects remote hosts', () => {
    expect(isLocalEndpoint('https://api.openai.com')).toBe(false);
    expect(isLocalEndpoint('http://192.168.1.50:11434')).toBe(false);
    expect(isLocalEndpoint('https://ollama.example.com')).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isLocalEndpoint('not-a-url')).toBe(false);
    expect(isLocalEndpoint('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

describe('extractJson', () => {
  it('extracts from markdown fenced block', () => {
    const raw = 'Here is the result:\n```json\n{"goal": "test"}\n```\nDone.';
    expect(JSON.parse(extractJson(raw))).toEqual({ goal: 'test' });
  });

  it('extracts from unfenced markdown block', () => {
    const raw = 'Result:\n```\n{"goal": "test"}\n```';
    expect(JSON.parse(extractJson(raw))).toEqual({ goal: 'test' });
  });

  it('extracts bare JSON after reasoning text', () => {
    const raw = 'Let me think about this...\n\n{"goal": "launch video", "audience": "devs"}';
    const parsed = JSON.parse(extractJson(raw));
    expect(parsed.goal).toBe('launch video');
    expect(parsed.audience).toBe('devs');
  });

  it('extracts bare JSON with no preamble', () => {
    const raw = '{"goal": "test"}';
    expect(JSON.parse(extractJson(raw))).toEqual({ goal: 'test' });
  });

  it('handles arrays', () => {
    const raw = 'Here: [1, 2, 3]';
    expect(JSON.parse(extractJson(raw))).toEqual([1, 2, 3]);
  });

  it('returns trimmed raw when no JSON structure found', () => {
    const raw = '  no json here  ';
    expect(extractJson(raw)).toBe('no json here');
  });
});

// ---------------------------------------------------------------------------
// Mocked network tests
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('health', () => {
  it('returns ok when model is found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'gemma4:e2b-mlx' }] }),
    });

    const result = await health();
    expect(result.ok).toBe(true);
    expect(result.model).toBe('gemma4:e2b-mlx');
    expect(result.error).toBeUndefined();
  });

  it('returns not ok when model is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'llama3:8b' }] }),
    });

    const result = await health();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns not ok when fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await health();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Connection refused');
  });

  it('rejects remote endpoints', async () => {
    await expect(health({ baseUrl: 'https://api.openai.com', model: 'gpt-4' })).rejects.toThrow(
      LocalAiError,
    );
  });
});

describe('generate', () => {
  it('returns content from successful completion', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hello world' }, finish_reason: 'stop' }],
      }),
    });

    const result = await generate([{ role: 'user', content: 'Hi' }]);
    expect(result).toBe('Hello world');
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal error',
    });

    await expect(generate([{ role: 'user', content: 'Hi' }])).rejects.toThrow(LocalAiError);
  });

  it('throws on empty content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test',
        choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      }),
    });

    await expect(generate([{ role: 'user', content: 'Hi' }])).rejects.toThrow('empty content');
  });

  it('rejects remote endpoints', async () => {
    await expect(
      generate([{ role: 'user', content: 'Hi' }], { baseUrl: 'https://api.anthropic.com', model: 'x' }),
    ).rejects.toThrow('not a local address');
  });
});

describe('generateStructured', () => {
  it('parses valid JSON from model output', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: '```json\n{"goal": "test video"}\n```' },
          finish_reason: 'stop',
        }],
      }),
    });

    const result = await generateStructured<{ goal: string }>(
      [{ role: 'user', content: 'test' }],
    );
    expect(result.goal).toBe('test video');
  });

  it('runs validator and rejects invalid structure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: '{"bad_field": true}' },
          finish_reason: 'stop',
        }],
      }),
    });

    await expect(
      generateStructured(
        [{ role: 'user', content: 'test' }],
        (parsed) => {
          const obj = parsed as Record<string, unknown>;
          if ('bad_field' in obj) return 'Unknown field: bad_field';
          return null;
        },
      ),
    ).rejects.toThrow('Validation failed');
  });

  it('throws on unparseable model output', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'I cannot produce JSON right now' },
          finish_reason: 'stop',
        }],
      }),
    });

    await expect(
      generateStructured([{ role: 'user', content: 'test' }]),
    ).rejects.toThrow(LocalAiError);
  });
});

/**
 * Brief Assist Tests
 *
 * Tests the brief-assist prompt construction, validation, merging, and
 * end-to-end flow with mocked local AI responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assistBrief, briefAssistAvailable } from '../lib/briefAssist';
import type { ProjectBrief } from '../lib/contracts';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper: mock a successful chat completion response
function mockCompletion(content: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      id: 'test',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    }),
  });
}

const SAMPLE_BRIEF: ProjectBrief = {
  goal: 'Product demo',
  audience: 'General',
  targetDurationSeconds: 60,
  aspectRatio: '16:9',
  requiredSegments: '',
  excludedSegments: '',
  tone: 'Direct, informative',
  style: 'Fast-paced, modern',
  cta: '',
  updatedAt: '2025-01-01T00:00:00Z',
};

describe('briefAssistAvailable', () => {
  it('returns available when health check passes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'gemma4:e2b-mlx' }] }),
    });

    const result = await briefAssistAvailable();
    expect(result.available).toBe(true);
  });

  it('returns unavailable when model not found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'other-model' }] }),
    });

    const result = await briefAssistAvailable();
    expect(result.available).toBe(false);
    expect(result.error).toContain('not found');
  });
});

describe('assistBrief', () => {
  it('returns error for empty instruction', async () => {
    const result = await assistBrief({
      instruction: '  ',
      project: { name: 'Test', aspectRatio: '16:9' },
      currentBrief: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('EMPTY_INPUT');
    }
  });

  it('produces a valid proposal from model output', async () => {
    const modelOutput = JSON.stringify({
      goal: 'Fast 45-second product launch for YouTube',
      audience: 'Developers',
      targetDurationSeconds: 45,
      aspectRatio: '16:9',
      requiredSegments: 'Strongest demo first',
      excludedSegments: '',
      tone: 'Energetic, technical',
      style: 'Fast-paced, demo-driven',
      cta: 'Start your free trial',
    });

    mockCompletion(modelOutput);

    const result = await assistBrief({
      instruction: 'Make this a fast 45-second product launch video for YouTube. Audience is developers.',
      project: { name: 'Launch Video', aspectRatio: '16:9' },
      currentBrief: SAMPLE_BRIEF,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.targetDurationSeconds).toBe(45);
      expect(result.proposal.audience).toBe('Developers');
      expect(result.proposal.cta).toBe('Start your free trial');
      // updatedAt must NOT be present
      expect('updatedAt' in result.proposal).toBe(false);
    }
  });

  it('preserves existing values for fields not changed by AI', async () => {
    // AI returns only partial fields
    const modelOutput = JSON.stringify({
      goal: 'New goal from AI',
      targetDurationSeconds: 30,
    });

    mockCompletion(modelOutput);

    const result = await assistBrief({
      instruction: 'Make it shorter, 30 seconds, with a new goal.',
      project: { name: 'Test', aspectRatio: '16:9' },
      currentBrief: SAMPLE_BRIEF,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.goal).toBe('New goal from AI');
      expect(result.proposal.targetDurationSeconds).toBe(30);
      // Preserved from current brief
      expect(result.proposal.audience).toBe('General');
      expect(result.proposal.tone).toBe('Direct, informative');
    }
  });

  it('rejects model output with unknown fields', async () => {
    const modelOutput = JSON.stringify({
      goal: 'Test',
      unknownField: 'bad',
    });

    mockCompletion(modelOutput);

    const result = await assistBrief({
      instruction: 'Update the goal.',
      project: { name: 'Test', aspectRatio: '16:9' },
      currentBrief: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Unknown field');
    }
  });

  it('rejects invalid aspectRatio from model', async () => {
    const modelOutput = JSON.stringify({
      goal: 'Test',
      aspectRatio: '4:3',
    });

    mockCompletion(modelOutput);

    const result = await assistBrief({
      instruction: 'Set aspect ratio.',
      project: { name: 'Test', aspectRatio: '16:9' },
      currentBrief: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('aspectRatio');
    }
  });

  it('handles model returning fenced JSON', async () => {
    const modelOutput = '```json\n{"goal": "Fenced goal", "targetDurationSeconds": 90}\n```';

    mockCompletion(modelOutput);

    const result = await assistBrief({
      instruction: 'Update the goal.',
      project: { name: 'Test', aspectRatio: '16:9' },
      currentBrief: SAMPLE_BRIEF,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.goal).toBe('Fenced goal');
    }
  });

  it('handles model failure gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await assistBrief({
      instruction: 'Update the goal.',
      project: { name: 'Test', aspectRatio: '16:9' },
      currentBrief: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('LOCAL_AI_UNAVAILABLE');
    }
  });

  it('fills defaults when no current brief exists', async () => {
    const modelOutput = JSON.stringify({
      goal: 'Brand new project',
    });

    mockCompletion(modelOutput);

    const result = await assistBrief({
      instruction: 'Start a brand new project brief.',
      project: { name: 'New', aspectRatio: '9:16' },
      currentBrief: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.goal).toBe('Brand new project');
      // Defaults filled
      expect(result.proposal.targetDurationSeconds).toBe(60);
      expect(result.proposal.tone).toBe('Direct, informative');
    }
  });
});

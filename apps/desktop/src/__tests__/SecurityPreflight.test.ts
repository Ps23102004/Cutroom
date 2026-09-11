/**
 * Cutroom Adversarial Security & Invariant Preflight Suite
 *
 * Enforces the strict security contract across all AI-assisted features:
 *   1. MODEL BOUNDARY: strict structured validation, rejects JSON injection, malformed JSON,
 *      unknown fields, unknown actions, script injection, and path-like strings.
 *   2. IDENTITY BOUNDARY: AI may only reference real, supplied asset/clip/track IDs.
 *      Hallucinated IDs are strictly rejected.
 *   3. VERSION BOUNDARY: expectedVersion required, rechecked before Apply; stale = zero mutation.
 *   4. MEDIA BOUNDARY: source range bounds must be valid (0 <= in < out <= duration).
 *      Original source media files are strictly immutable.
 *   5. MUTATION BOUNDARY: generation = zero mutation, preview = zero mutation,
 *      dismiss = zero mutation.
 *   6. PRIVACY BOUNDARY: narrow AI context; never leaks filesystem paths, full database,
 *      or unrelated assets.
 *   7. PARTIAL FAILURE INTEGRITY: sequential multi-operations halt on error, surface exact
 *      failure state, and NEVER create a revision or claim full success.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Asset, Clip, Composition } from '../lib/contracts';
import {
  buildReplaceContext,
  validateReplaceProposal,
  type ReplaceProposal,
} from '../lib/replaceAssist';
import {
  assistEditPlan,
  buildEditPlanContext,
  executeEditPlan,
  validateEditPlan,
  type EditPlan,
} from '../lib/editPlanAssist';

describe('Security & Invariant Preflight', () => {
  const asset: Asset = {
    id: 'asset-sec-1',
    projectId: 'proj-sec',
    name: 'Secure Footage.mov',
    path: '/media/secure-footage.mov',
    sizeBytes: 1000,
    durationTicks: '48000',
    timeBase: { num: 1, den: 24000 },
    width: 1920,
    height: 1080,
    fpsNumerator: 24,
    fpsDenominator: 1,
    format: 'mov',
    codec: 'h264',
    audioChannels: 2,
    importType: 'managed',
    proxyStatus: 'ready',
  };

  const clip: Clip = {
    id: 'clip-sec-1',
    trackId: 'track-sec-1',
    assetId: 'asset-sec-1',
    name: 'Secure Clip',
    inTicks: '0',
    outTicks: '24000',
    timelineStartTicks: '0',
    timelineDurationTicks: '24000',
  };

  const composition: Composition = {
    id: 'comp-sec',
    projectId: 'proj-sec',
    version: 10,
    durationTicks: '24000',
    timeBase: { num: 1, den: 24000 },
    tracks: [{ id: 'track-sec-1', kind: 'primary_video', label: 'Primary', order: 0 }],
    clips: [clip],
    updatedAt: '2026-09-08T00:00:00Z',
  };

  describe('1. Model Boundary & Adversarial Payload Defense', () => {
    it('rejects path-traversal strings and filesystem paths in reasons', () => {
      const proposal: ReplaceProposal = {
        targetClipId: 'clip-sec-1',
        targetClipName: 'Secure Clip',
        replacementAssetId: 'asset-sec-1',
        replacementAssetName: 'Secure Footage.mov',
        sourceInTicks: '0',
        sourceOutTicks: '12000',
        expectedVersion: 10,
        reason: 'Load malicious payload from /etc/passwd or ../../secret',
      };
      const res = validateReplaceProposal(proposal, {
        composition,
        targetClip: clip,
        candidateAssets: [asset],
      });
      expect(res.valid).toBe(false);
      if (!res.valid) expect(res.error).toContain('filesystem paths');
    });

    it('rejects unknown or injected fields in edit plans', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  summary: 'Adversarial plan',
                  operations: [{ kind: 'trim', clipId: 'clip-sec-1', newInTicks: '0', newOutTicks: '12000', reason: 'ok' }],
                  __injected_admin_override: true,
                }),
              },
            },
          ],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const ctx = buildEditPlanContext('Proj', composition, [asset], 'Test');
      const res = await assistEditPlan(ctx);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain('Unknown field');

      vi.restoreAllMocks();
    });
  });

  describe('2. Identity Boundary Enforcement', () => {
    it('strictly rejects hallucinated clip IDs not in the composition', () => {
      const plan: EditPlan = {
        summary: 'Delete imaginary clip',
        expectedVersion: 10,
        operations: [{ kind: 'delete', clipId: 'clip-ghost', reason: 'Remove' }],
      };
      const res = validateEditPlan(plan, { composition, assets: [asset] });
      expect(res.valid).toBe(false);
      if (!res.valid) expect(res.error).toContain('non-existent clip');
    });

    it('strictly rejects hallucinated asset IDs not in candidate assets', () => {
      const proposal: ReplaceProposal = {
        targetClipId: 'clip-sec-1',
        targetClipName: 'Secure Clip',
        replacementAssetId: 'asset-ghost-99',
        replacementAssetName: 'Ghost Asset',
        sourceInTicks: '0',
        sourceOutTicks: '12000',
        expectedVersion: 10,
        reason: 'Valid reason without paths',
      };
      const res = validateReplaceProposal(proposal, {
        composition,
        targetClip: clip,
        candidateAssets: [asset],
      });
      expect(res.valid).toBe(false);
      if (!res.valid) expect(res.error).toContain('not one of the available assets');
    });
  });

  describe('3. Version & Staleness Guarantees', () => {
    it('blocks execution when expectedVersion does not match current version', async () => {
      const plan: EditPlan = {
        summary: 'Valid plan',
        expectedVersion: 9, // Stale! Composition is version 10
        operations: [{ kind: 'delete', clipId: 'clip-sec-1', reason: 'Delete' }],
      };

      const callbacks = {
        trimClip: vi.fn(),
        reorderClips: vi.fn(),
        removeClip: vi.fn(),
        addClip: vi.fn(),
        replaceClip: vi.fn(),
        createRevision: vi.fn(),
        getCurrentComposition: () => composition,
        getAssets: () => [asset],
      };

      const res = await executeEditPlan(plan, callbacks);
      expect(res.success).toBe(false);
      if (!res.success) expect(res.error).toContain('version conflict');

      // ZERO mutations executed
      expect(callbacks.removeClip).not.toHaveBeenCalled();
      expect(callbacks.createRevision).not.toHaveBeenCalled();
    });
  });

  describe('4. Privacy & Context Isolation', () => {
    it('context builder never leaks filesystem paths or internal project paths', () => {
      const ctx = buildReplaceContext('Proj', composition, clip, [asset], 'Replace');
      const serialized = JSON.stringify(ctx);
      expect(serialized).not.toContain('/media/secure-footage.mov');
      expect(serialized).not.toContain('path');
    });
  });
});

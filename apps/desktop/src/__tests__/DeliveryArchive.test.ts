import { describe, it, expect } from 'vitest';
import type { OutputPreset, Project, ProjectBrief, Revision } from '../lib/contracts';
import { validateAndCreateDeliveryManifest } from '../lib/deliveryArchive';

describe('Delivery & Archive Engine', () => {
  const project: Project = {
    id: 'proj-final',
    name: 'Final Delivery Project',
    path: '/projects/proj-final',
    fpsNumerator: 24,
    fpsDenominator: 1,
    aspectRatio: '16:9',
    createdAt: '2026-09-08T00:00:00Z',
    updatedAt: '2026-09-08T00:00:00Z',
    revisionCount: 5,
    status: 'approved',
  };

  const revision: Revision = {
    id: 'rev-master',
    projectId: 'proj-final',
    revisionNumber: 5,
    commitNote: 'Final approved client master',
    author: 'Lead Editor',
    createdAt: '2026-09-08T00:00:00Z',
    contentHash: 'sha256:abcd1234efgh5678',
  };

  const brief: ProjectBrief = {
    goal: 'Deliver high quality master video',
    audience: 'Broad audience',
    targetDurationSeconds: 60,
    aspectRatio: '16:9',
    requiredSegments: 'All',
    excludedSegments: 'None',
    tone: 'Professional',
    style: 'Modern',
    cta: 'Visit website',
    updatedAt: '2026-09-08T00:00:00Z',
  };

  it('validates successful delivery and creates signed manifest', () => {
    const res = validateAndCreateDeliveryManifest({
      project,
      brief,
      revision,
      renderJobId: 'job-render-99',
      artifactPath: '/exports/master_1080p.mp4',
      artifactSizeBytes: 25_000_000,
      artifactSha256: '90cf2510d7c952b9baf6fa71cf7b9297d44395534feeec549f053a51e2708549',
      artifactDurationSeconds: 60,
      preset: '1080p_sdr' as OutputPreset,
    });

    expect(res.valid).toBe(true);
    expect(res.manifest).toBeDefined();
    if (res.manifest) {
      expect(res.manifest.projectId).toBe('proj-final');
      expect(res.manifest.artifactSha256).toBe(
        '90cf2510d7c952b9baf6fa71cf7b9297d44395534feeec549f053a51e2708549',
      );
      expect(res.manifest.durationSeconds).toBe(60);
      expect(res.manifest.contentHash).toBe('sha256:abcd1234efgh5678');
    }
  });

  it('rejects delivery when rendered artifact is missing or empty', () => {
    const res = validateAndCreateDeliveryManifest({
      project,
      brief,
      revision,
      renderJobId: 'job-render-99',
      artifactPath: '',
      artifactSizeBytes: 0,
      artifactSha256: '',
      artifactDurationSeconds: 0,
      preset: '1080p_sdr' as OutputPreset,
    });

    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThanOrEqual(2);
  });
});

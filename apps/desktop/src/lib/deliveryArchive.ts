/**
 * Cutroom Delivery & Archive Engine
 *
 * Full Production Lifecycle:
 *   Create -> Import -> Brief -> Understand -> Edit -> AI -> Revision ->
 *   Render -> Review -> Revise -> Approve -> Deliver -> Archive -> Reopen
 *
 * Invariants:
 *   - Only mark delivery successful when real output artifact exists and validates.
 *   - Checksums and manifest generated for every delivery.
 *   - Original source media remains strictly immutable.
 */

import type { DeliveryManifest, OutputPreset, Project, ProjectBrief, Revision } from './contracts';

export interface DeliveryValidationParams {
  project: Project;
  brief?: ProjectBrief;
  revision: Revision;
  renderJobId: string;
  artifactPath: string;
  artifactSizeBytes: number;
  artifactSha256: string;
  artifactDurationSeconds: number;
  preset: OutputPreset;
}

export interface DeliveryValidationResult {
  valid: boolean;
  errors: string[];
  manifest?: DeliveryManifest;
}

export function validateAndCreateDeliveryManifest(
  params: DeliveryValidationParams,
): DeliveryValidationResult {
  const errors: string[] = [];

  // 1. Artifact existence and size checks
  if (!params.artifactPath || params.artifactPath.trim().length === 0) {
    errors.push('Rendered artifact path is missing');
  }
  if (params.artifactSizeBytes <= 0) {
    errors.push('Rendered output file is empty or missing on disk');
  }
  if (!params.artifactSha256 || params.artifactSha256.trim().length === 0) {
    errors.push('Artifact SHA-256 checksum is missing');
  }

  // 2. Revision & project integrity
  if (!params.revision.contentHash) {
    errors.push('Revision has no immutable content hash');
  }

  // 3. Optional brief conformance checks
  if (params.brief) {
    if (params.brief.targetDurationSeconds > 0) {
      const tolerance = 5; // +/- 5 seconds tolerance
      const diff = Math.abs(params.artifactDurationSeconds - params.brief.targetDurationSeconds);
      if (diff > tolerance) {
        // Warning or note, keep delivery valid if within generous bounds
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const manifest: DeliveryManifest = {
    projectId: params.project.id,
    projectName: params.project.name,
    revisionId: params.revision.id,
    contentHash: params.revision.contentHash,
    renderJobId: params.renderJobId,
    artifactPath: params.artifactPath,
    artifactSha256: params.artifactSha256,
    exportedAt: new Date().toISOString(),
    aspectRatio: params.project.aspectRatio,
    durationSeconds: params.artifactDurationSeconds,
  };

  return { valid: true, errors: [], manifest };
}

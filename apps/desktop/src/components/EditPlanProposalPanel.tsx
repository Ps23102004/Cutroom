/**
 * EditPlanProposalPanel
 *
 * AI Assembly / EditPlan preview control for multi-operation workflows.
 *
 * Architecture constraints:
 *   - AI edit plans are PREVIEWED and explicitly accepted before any mutation.
 *   - Raw local-model output NEVER dispatches operations on its own.
 *   - Apply routes through exact existing AppContext operations.
 *   - Before Apply the plan's expectedVersion must equal CURRENT composition.version.
 *   - Operations execute sequentially with version propagation.
 *   - Partial failure is detected and displayed without claiming success.
 *   - Revision created ONLY after 100% complete intended success.
 *   - Dismiss clears local UI state with zero native calls.
 */

import { useCallback, useState } from 'react';
import { Button, Card, Input } from '@cutroom/ui';
import type { Asset, Composition } from '../lib/contracts';
import {
  assistEditPlan,
  buildEditPlanContext,
  executeEditPlan,
  validateEditPlan,
  type EditPlan,
} from '../lib/editPlanAssist';

export interface EditPlanProposalPanelProps {
  projectName: string;
  composition: Composition;
  assets: Asset[];
  trimClip: (clipId: string, newInTicks: string, newOutTicks: string) => Promise<void>;
  reorderClips: (clipId: string, direction: 'left' | 'right') => Promise<void>;
  removeClip: (clipId: string) => Promise<void>;
  addClip: (params: {
    assetId: string;
    sourceInTicks: string;
    sourceOutTicks: string;
    trackId?: string;
    timelineStartTicks?: string;
  }) => Promise<void>;
  replaceClip: (
    clipId: string,
    assetId: string,
    sourceInTicks: string,
    sourceOutTicks: string,
  ) => Promise<void>;
  createRevision: (commitNote: string) => Promise<unknown>;
  getCurrentComposition: () => Composition | null;
  modelLabel?: string;
}

export const EditPlanProposalPanel: React.FC<EditPlanProposalPanelProps> = ({
  projectName,
  composition,
  assets,
  trimClip,
  reorderClips,
  removeClip,
  addClip,
  replaceClip,
  createRevision,
  getCurrentComposition,
  modelLabel = 'Gemma 4 E4B (local)',
}) => {
  const [instruction, setInstruction] = useState<string>('');
  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [generating, setGenerating] = useState<boolean>(false);
  const [applying, setApplying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  const stale = plan !== null && plan.expectedVersion !== composition.version;

  const handleGenerate = useCallback(async () => {
    setApplied(null);
    setError(null);
    if (!instruction.trim()) {
      setError('Describe what edits or assembly you want Cutroom to plan.');
      return;
    }
    setGenerating(true);
    const ctx = buildEditPlanContext(projectName, composition, assets, instruction.trim());
    const result = await assistEditPlan(ctx);
    setGenerating(false);
    if (!result.ok) {
      setError(result.error);
      setPlan(null);
      return;
    }
    setPlan(result.plan);
  }, [projectName, composition, assets, instruction]);

  const handleDismiss = useCallback(() => {
    setPlan(null);
    setError(null);
    setApplied(null);
  }, []);

  const handleApply = useCallback(async () => {
    const targetPlan = plan;
    if (!targetPlan) return;

    // Check version immediately before Apply
    const check = validateEditPlan(targetPlan, { composition, assets });
    if (!check.valid) {
      setError(check.error);
      setPlan(null);
      return;
    }

    setApplying(true);
    setError(null);

    const execResult = await executeEditPlan(targetPlan, {
      trimClip,
      reorderClips,
      removeClip,
      addClip,
      replaceClip,
      createRevision,
      getCurrentComposition,
      getAssets: () => assets,
    });

    setApplying(false);

    if (!execResult.success) {
      setError(execResult.error);
      // Partial failure: do NOT clear plan immediately so editor sees what failed
      setApplied(null);
      return;
    }

    setPlan(null);
    setApplied(
      `Successfully applied all ${execResult.appliedCount} operations and created revision: "${targetPlan.summary}". ` +
        `Original source media was not modified.`,
    );
  }, [plan, composition, assets, trimClip, reorderClips, removeClip, addClip, replaceClip, createRevision, getCurrentComposition]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #FAF8FF)' }}>
        AI Assembly & Edit Plan
      </h4>
      <div style={{ fontSize: '11px', color: 'var(--text-secondary, #C2BCCC)' }}>
        Local model: {modelLabel}. Generates structured multi-operation plans. Preview before applying.
      </div>

      <Input
        label="Assembly / Editing Goal"
        placeholder="e.g. Create a 45-second product demo. Start with the strongest demo, shorten interview, end with CTA."
        value={instruction}
        onChange={(e) => setInstruction(e.currentTarget.value)}
      />

      <Button
        size="sm"
        variant="secondary"
        onClick={() => void handleGenerate()}
        isLoading={generating}
        disabled={assets.length === 0 && composition.clips.length === 0}
      >
        Generate Edit Plan
      </Button>

      {error && (
        <div role="alert" style={{ fontSize: '12px', color: 'var(--destructive, #E06C75)' }}>
          {error}
        </div>
      )}

      {applied && (
        <div role="status" style={{ fontSize: '12px', color: 'var(--positive, #A7D7A1)' }}>
          {applied}
        </div>
      )}

      {plan && !stale && (
        <Card raised padding="sm" data-testid="edit-plan-preview">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--text-secondary, #C2BCCC)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              PROPOSED EDIT PLAN ({plan.operations.length} STEPS)
            </div>

            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #FAF8FF)' }}>
              {plan.summary}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {plan.operations.map((op, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    padding: '6px 8px',
                    backgroundColor: 'var(--bg-panel, #0F0F16)',
                    borderRadius: '6px',
                    fontSize: '11px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      style={{
                        padding: '2px 5px',
                        borderRadius: '3px',
                        fontWeight: 600,
                        fontSize: '10px',
                        textTransform: 'uppercase',
                        backgroundColor: 'var(--bg-raised, #17171F)',
                        color: 'var(--accent-violet, #C4B5FD)',
                      }}
                    >
                      {idx + 1}. {op.kind}
                    </span>
                    <span style={{ color: 'var(--text-primary, #FAF8FF)' }}>
                      {op.kind === 'trim' && `Clip "${op.clipId}" (${op.newInTicks} → ${op.newOutTicks})`}
                      {op.kind === 'reorder' && `Clip "${op.clipId}" move ${op.direction}`}
                      {op.kind === 'delete' && `Clip "${op.clipId}" remove`}
                      {op.kind === 'insert' && `Asset "${op.assetId}" into track ${op.targetTrackId}`}
                      {op.kind === 'replace' && `Clip "${op.targetClipId}" with asset "${op.replacementAssetId}"`}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-secondary, #C2BCCC)', paddingLeft: '4px' }}>
                    {op.reason}
                  </div>
                </div>
              ))}
            </div>

            <div
              role="note"
              data-testid="edit-plan-media-safe"
              style={{
                fontSize: '11px',
                color: 'var(--text-tertiary-panel, #9D95B0)',
                borderTop: '1px solid var(--border-subtle, #1E1E2A)',
                paddingTop: '6px',
              }}
            >
              Original source media will not be modified.
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleApply()}
                isLoading={applying}
                data-testid="apply-plan-button"
              >
                Apply Plan ({plan.operations.length} Steps)
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDismiss}
                disabled={applying}
                data-testid="dismiss-plan-button"
              >
                Dismiss
              </Button>
            </div>
          </div>
        </Card>
      )}

      {plan && stale && (
        <div
          role="alert"
          data-testid="edit-plan-stale"
          style={{ fontSize: '12px', color: 'var(--destructive, #E06C75)' }}
        >
          Timeline changed since this plan was generated. Regenerate the plan.
        </div>
      )}
    </div>
  );
};

export default EditPlanProposalPanel;

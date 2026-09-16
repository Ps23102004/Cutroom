/**
 * DeleteProposalPanel
 *
 * AI delete preview control for the Studio timeline inspector.
 *
 * DELETION MEANING (must not be broken):
 *   Deleting a clip removes it from the TIMELINE ONLY.
 *   It NEVER deletes the source asset or the original media file on disk.
 *
 * Architecture constraints (identical to Trim/Reorder panels):
 *   - AI proposals are PREVIEWED and explicitly accepted before any mutation.
 *   - Raw local-model output NEVER dispatches a native operation on its own.
 *   - Apply routes through the exact existing AppContext removeClip() path
 *     (which performs native composition.apply action="remove").
 *   - Before Apply the proposal's expectedVersion must equal the CURRENT
 *     composition version. A stale proposal is rejected with zero native calls.
 *   - Dismiss clears local UI state only and makes zero native calls.
 *   - The preview ALWAYS states that original source media will not be deleted.
 */

import { useCallback, useState } from 'react';
import { Button, Card, Input } from '@cutroom/ui';
import type { Asset, Clip, Composition } from '../lib/contracts';
import {
  assistDelete,
  buildDeleteContext,
  isDeleteProposalStale,
  type DeleteProposal,
} from '../lib/deleteAssist';
import { formatRationalTimecode } from '../lib/timecode';

export interface DeleteProposalPanelProps {
  projectName: string;
  composition: Composition;
  clip: Clip;
   /** The source asset for the clip, when resolvable, for display only. */
  asset?: Asset;
   /** Exact existing native remove operation from AppContext. */
  removeClip: (clipId: string) => Promise<void>;
   /** Exact existing native revision operation from AppContext. */
  createRevision: (commitNote: string) => Promise<unknown>;
   /** Model target label, shown so the runtime is never hidden from the editor. */
  modelLabel?: string;
}

export const DeleteProposalPanel: React.FC<DeleteProposalPanelProps> = ({
  projectName,
  composition,
  clip,
  asset,
  removeClip,
  createRevision,
  modelLabel = 'Gemma 4 E4B (local)',
}) => {
  const [instruction, setInstruction] = useState<string>('');
  const [proposal, setProposal] = useState<DeleteProposal | null>(null);
  const [generating, setGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

   // Staleness re-derived every render against the CURRENT composition version:
  // this IS the "re-read the current version" step required immediately before Apply.
  const stale = proposal !== null && isDeleteProposalStale(proposal, composition.version);

  const handleGenerate = useCallback(async () => {
    setApplied(null);
    setError(null);
    if (!instruction.trim()) {
      setError('Please describe why you want to remove this clip.');
      return;
     }
    setGenerating(true);
    const ctx = buildDeleteContext(projectName, composition, clip, instruction.trim());
    const result = await assistDelete(ctx);
    setGenerating(false);
    if (!result.ok) {
      setError(result.error);
      setProposal(null);
      return;
     }
    setProposal(result.proposal);
   }, [projectName, composition, clip, instruction]);

  const handleDismiss = useCallback(() => {
     // Dismiss makes ZERO native calls -- it only clears local UI state and
     // preserves the composition exactly.
    setProposal(null);
    setError(null);
    setApplied(null);
   }, []);

  const handleApply = useCallback(async () => {
    const target = proposal;
    if (!target) return;

     // Staleness guard: the proposal must match the current authoritative version.
     // If the timeline changed, DO NOT call native mutation.
    if (stale) {
      setError('Timeline changed since this proposal was generated. Regenerate the proposal.');
      setProposal(null);
      setApplied(null);
      return;
     }

     // Stale check passed (expectedVersion === current version). Route the
     // validated proposal through the exact existing native remove path.
    setError(null);
    await removeClip(target.clipId);
    await createRevision(`AI delete: ${target.reason}`);
    setProposal(null);
    setApplied(
       `Removed "${target.clipName}" from the timeline. ` +
         `The original source media was not deleted.`,
     );
   }, [proposal, stale, removeClip, createRevision]);

   // Display-only tick -> timecode rendering. Uses the composition timebase for
  // timeline position/duration; the source asset timebase when the asset resolves.
  const tlStart = formatRationalTimecode(clip.timelineStartTicks, composition.timeBase);
  const tlDuration = formatRationalTimecode(clip.timelineDurationTicks, composition.timeBase);
  const srcRange = asset
     ? `${formatRationalTimecode(clip.inTicks, asset.timeBase)} \u2192 ${formatRationalTimecode(clip.outTicks, asset.timeBase)}`
     : null;

  return (
     <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
       <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #FAF8FF)' }}>
        AI Edit Proposal &mdash; Delete
       </h4>
       <div style={{ fontSize: '11px', color: 'var(--text-secondary, #C2BCCC)' }}>
        Local model: {modelLabel}. Proposals are previewed and require explicit acceptance. No edit is written until you Apply.
       </div>

       <Input
        label="Delete instruction"
        placeholder="e.g. Remove this clip -- it is duplicated content."
        value={instruction}
        onChange={(e) => setInstruction(e.currentTarget.value)}
       />

       <Button
        size="sm"
        variant="secondary"
        onClick={() => void handleGenerate()}
        isLoading={generating}
       >
        Generate Proposal
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

       {proposal && !stale && (
         <Card raised padding="sm" data-testid="delete-proposal-preview">
           <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
             <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary, #C2BCCC)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              AI Edit Proposal
             </div>
             <div style={{ fontSize: '12px', color: 'var(--text-primary, #FAF8FF)' }}>
              <strong>Remove clip:</strong> {proposal.clipName}
             </div>
             <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px' }}>
               <div style={{ color: 'var(--text-secondary, #C2BCCC)' }}>
                Timeline position: {tlStart}
               </div>
               <div style={{ color: 'var(--text-secondary, #C2BCCC)' }}>
                Timeline duration: {tlDuration}
               </div>
               {asset && (
                 <div style={{ color: 'var(--text-secondary, #C2BCCC)' }}>
                   Source {asset.name}: {srcRange}
                 </div>
               )}
             </div>
             <div style={{ fontSize: '12px', color: 'var(--text-secondary, #C2BCCC)' }}>
               <strong>Reason:</strong> {proposal.reason}
             </div>

             {/* Safety invariant made explicit in the preview every time. */}
             <div
              role="note"
              data-testid="delete-media-safe"
              style={{
                fontSize: '11px',
                color: 'var(--text-tertiary-panel, #9D95B0)',
                borderTop: '1px solid var(--border-subtle, #1E1E2A)',
                paddingTop: '6px',
               }}
             >
              Removing this clip updates the timeline only. Original source media will not be deleted.
             </div>

             <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
               <Button
                size="sm"
                variant="destructive"
                onClick={() => void handleApply()}
                data-testid="delete-apply-button"
               >
                Apply Deletion
               </Button>
               <Button
                size="sm"
                variant="ghost"
                onClick={handleDismiss}
               >
                Dismiss
               </Button>
             </div>
           </div>
         </Card>
       )}

       {proposal && stale && (
         <div role="alert" data-testid="delete-proposal-stale" style={{ fontSize: '12px', color: 'var(--destructive, #E06C75)' }}>
          Timeline changed since this proposal was generated. Regenerate the proposal.
         </div>
       )}
     </div>
   );
};

export default DeleteProposalPanel;

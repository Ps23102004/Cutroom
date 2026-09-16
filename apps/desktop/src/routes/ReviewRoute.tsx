import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Button, Card, Tabs, Badge, Input, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell } from '@cutroom/ui';
import { ClientReviewComment } from '../lib/contracts';
import { assistClientCommentToPlan, findClipAtTimelineTicks } from '../lib/clientReview';
import { EditPlan, executeEditPlan } from '../lib/editPlanAssist';
import { formatRationalTimecode } from '../lib/timecode';

type ReviewSubview = 'playback_comments' | 'proposals' | 'packages';

export const ReviewRoute: React.FC = () => {
  const {
    activeProject,
    composition,
    revisions,
    assets,
    trimClip,
    reorderClips,
    removeClip,
    addClip,
    replaceClip,
    createRevision,
    navigate,
  } = useApp();

  const [activeSubview, setActiveSubview] = useState<ReviewSubview>('playback_comments');
  const [selectedRevisionId] = useState<string>(revisions[0]?.id ?? '');

  // Timecoded comments state
  const [comments, setComments] = useState<ClientReviewComment[]>([
    {
      id: 'comm-init-1',
      revisionId: revisions[0]?.id ?? 'rev-1',
      author: 'Executive Producer',
      timelineTicks: '24000',
      comment: 'Cut the awkward pause at the start and tighten pacing.',
      resolved: false,
      createdAt: new Date().toISOString(),
    },
  ]);

  // New comment entry
  const [newCommentText, setNewCommentText] = useState('');
  const [newCommentTicks] = useState('0');
  const [newCommentAuthor, setNewCommentAuthor] = useState('Client Reviewer');

  // AI Proposal generated from comment
  const [activePlan, setActivePlan] = useState<EditPlan | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isApplyingPlan, setIsApplyingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planSuccess, setPlanSuccess] = useState<string | null>(null);

  if (!activeProject) {
    return (
      <div style={{ maxWidth: '600px', margin: '40px auto' }}>
        <Card padding="lg" style={{ textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: '18px', color: 'var(--text-primary, #FAF8FF)' }}>
            Review Requires Active Project
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--text-secondary, #C2BCCC)' }}>
            Review packages and feedback threads are bound to a specific project. Please select or create a project.
          </p>
          <Button variant="primary" onClick={() => navigate('home')}>
            Return to Home
          </Button>
        </Card>
      </div>
    );
  }

  const handleAddComment = () => {
    if (!newCommentText.trim()) return;
    const newComm: ClientReviewComment = {
      id: `comm-${Date.now()}`,
      revisionId: selectedRevisionId || revisions[0]?.id || 'rev-1',
      author: newCommentAuthor.trim() || 'Client Reviewer',
      timelineTicks: newCommentTicks.trim() || '0',
      comment: newCommentText.trim(),
      resolved: false,
      createdAt: new Date().toISOString(),
    };
    setComments((prev) => [...prev, newComm]);
    setNewCommentText('');
  };

  const handleToggleResolve = (id: string) => {
    setComments((prev) =>
      prev.map((c) => (c.id === id ? { ...c, resolved: !c.resolved } : c)),
    );
  };

  const handleGenerateProposal = async (comment: ClientReviewComment) => {
    if (!composition) return;
    setIsGeneratingPlan(true);
    setPlanError(null);
    setPlanSuccess(null);
    setActiveCommentId(comment.id);

    try {
      const targetClip = findClipAtTimelineTicks(composition, comment.timelineTicks);
      const res = await assistClientCommentToPlan({
        comment,
        composition,
        targetClip,
        candidateAssets: assets,
      });

      if (res.ok) {
        setActivePlan(res.plan);
        setActiveSubview('proposals');
      } else {
        setPlanError(`Failed to generate edit plan: ${res.error}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPlanError(`Error: ${msg}`);
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  const handleApplyPlan = async () => {
    if (!activePlan || !composition) return;
    setIsApplyingPlan(true);
    setPlanError(null);

    try {
      const result = await executeEditPlan(activePlan, {
        trimClip,
        reorderClips,
        removeClip,
        addClip,
        replaceClip,
        createRevision,
        getCurrentComposition: () => composition,
        getAssets: () => assets,
      });

      if (result.success) {
        setPlanSuccess(`Applied ${result.appliedCount} edit operation(s) and created new revision: "${activePlan.summary}"`);
        if (activeCommentId) {
          handleToggleResolve(activeCommentId);
        }
        setActivePlan(null);
      } else {
        setPlanError(`Plan execution failed: ${result.error}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPlanError(`Apply failed: ${msg}`);
    } finally {
      setIsApplyingPlan(false);
    }
  };

  const subviewTabs = [
    { id: 'playback_comments', label: 'Client Feedback & Comments', count: comments.filter(c => !c.resolved).length },
    { id: 'proposals', label: 'AI Proposed Revisions' },
    { id: 'packages', label: 'Review Packages' },
  ];

  return (
    <div style={{ maxWidth: '1080px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--text-primary, #FAF8FF)' }}>
            Client Review & Timecoded Feedback
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary, #C2BCCC)' }}>
            Project: <strong>{activeProject.name}</strong> • Timecoded review comments translate into structured AI edit proposals. Client comments never directly mutate the timeline.
          </p>
        </div>
      </div>

      <Tabs items={subviewTabs} activeId={activeSubview} onChange={(id) => setActiveSubview(id as ReviewSubview)} />

      {/* SUBVIEW 1: Playback & Comments */}
      {activeSubview === 'playback_comments' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Card padding="md">
            <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: 'var(--text-primary, #FAF8FF)' }}>
              Add Timecoded Client Feedback
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: '10px', alignItems: 'flex-end' }}>
              <Input
                label="Reviewer"
                value={newCommentAuthor}
                onChange={(e) => setNewCommentAuthor(e.currentTarget.value)}
              />
              <Input
                label="Comment / Editorial Feedback"
                placeholder="e.g. Cut the silence at 00:01:00 or swap to B-roll"
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.currentTarget.value)}
              />
              <Button variant="primary" onClick={handleAddComment}>
                Add Feedback
              </Button>
            </div>
          </Card>

          <Card padding="md">
            <h3 style={{ margin: '0 0 14px', fontSize: '15px', color: 'var(--text-primary, #FAF8FF)' }}>
              Feedback Notes ({comments.length})
            </h3>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Timecode</TableHeaderCell>
                  <TableHeaderCell>Reviewer</TableHeaderCell>
                  <TableHeaderCell>Feedback Note</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>AI Action</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {comments.map((comm) => (
                  <TableRow key={comm.id}>
                    <TableCell style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                      {composition ? formatRationalTimecode(comm.timelineTicks, composition.timeBase) : comm.timelineTicks}
                    </TableCell>
                    <TableCell>{comm.author}</TableCell>
                    <TableCell style={{ color: 'var(--text-primary, #FAF8FF)' }}>{comm.comment}</TableCell>
                    <TableCell>
                      <Badge variant={comm.resolved ? 'approved' : 'neutral'}>
                        {comm.resolved ? 'Resolved' : 'Open'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleGenerateProposal(comm)}
                          isLoading={isGeneratingPlan && activeCommentId === comm.id}
                        >
                          Generate AI Plan
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleToggleResolve(comm.id)}
                        >
                          {comm.resolved ? 'Reopen' : 'Mark Resolved'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* SUBVIEW 2: AI Proposed Revisions */}
      {activeSubview === 'proposals' && (
        <Card padding="md">
          <h3 style={{ margin: '0 0 14px', fontSize: '15px', color: 'var(--text-primary, #FAF8FF)' }}>
            AI Proposed Revision from Client Feedback
          </h3>

          {planError && (
            <div role="alert" style={{ padding: '10px', backgroundColor: 'rgba(224, 108, 117, 0.12)', border: '1px solid var(--destructive, #E06C75)', borderRadius: '6px', color: 'var(--destructive, #E06C75)', marginBottom: '12px' }}>
              {planError}
            </div>
          )}

          {planSuccess && (
            <div role="status" style={{ padding: '10px', backgroundColor: 'rgba(167, 215, 161, 0.12)', border: '1px solid var(--positive, #A7D7A1)', borderRadius: '6px', color: 'var(--positive, #A7D7A1)', marginBottom: '12px' }}>
              {planSuccess}
            </div>
          )}

          {activePlan ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ padding: '12px', backgroundColor: 'var(--bg-raised, #17171F)', borderRadius: '8px', border: '1px solid var(--border-default, #2A2A3A)' }}>
                <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary, #FAF8FF)', marginBottom: '4px' }}>
                  Summary: {activePlan.summary}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary, #C2BCCC)' }}>
                  Target Composition Version: {activePlan.expectedVersion} • Operations: {activePlan.operations.length}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {activePlan.operations.map((op, i) => (
                  <div key={i} style={{ padding: '8px 12px', backgroundColor: 'var(--bg-panel, #0F0F16)', borderRadius: '6px', fontSize: '12px', borderLeft: '3px solid var(--accent-violet, #C4B5FD)' }}>
                    <strong>Step {i + 1} ({op.kind}):</strong> {op.reason}
                  </div>
                ))}
              </div>

              <div role="note" style={{ fontSize: '11px', color: 'var(--text-tertiary-panel, #9D95B0)', borderTop: '1px solid var(--border-subtle, #1E1E2A)', paddingTop: '8px' }}>
                Human approval required. Applying will execute native timeline operations and create a verified revision. Original source media remains unmodified.
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <Button variant="primary" onClick={handleApplyPlan} isLoading={isApplyingPlan}>
                  Approve & Apply AI Revision
                </Button>
                <Button variant="ghost" onClick={() => setActivePlan(null)} disabled={isApplyingPlan}>
                  Dismiss Proposal
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary, #C2BCCC)' }}>
              No active proposal. Select a client comment from the "Client Feedback" tab and click "Generate AI Plan".
            </div>
          )}
        </Card>
      )}

      {/* SUBVIEW 3: Review Packages */}
      {activeSubview === 'packages' && (
        <Card padding="lg" style={{ textAlign: 'center', borderStyle: 'dashed' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '15px', color: 'var(--text-primary, #FAF8FF)' }}>
            Review Share Packages
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary, #C2BCCC)' }}>
            Exported review copies and timecoded web-review share links will be tracked here.
          </p>
        </Card>
      )}
    </div>
  );
};

export default ReviewRoute;

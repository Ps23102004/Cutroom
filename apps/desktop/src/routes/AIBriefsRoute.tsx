import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { Button, Card, Tabs, Input, Select, Badge } from '@cutroom/ui';
import { assistBrief, briefAssistAvailable, type BriefProposal } from '../lib/briefAssist';

type BriefsSubview = 'editor' | 'plan' | 'sources' | 'recipes';

export const AIBriefsRoute: React.FC = () => {
  const { activeProject, brief, saveBrief, navigate } = useApp();
  const [activeSubview, setActiveSubview] = useState<BriefsSubview>('editor');

  // Form states initialized from authoritative brief
  const [goal, setGoal] = useState(brief?.goal || '');
  const [audience, setAudience] = useState(brief?.audience || '');
  const [targetDuration, setTargetDuration] = useState(String(brief?.targetDurationSeconds || 60));
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>(brief?.aspectRatio || activeProject?.aspectRatio || '16:9');
  const [requiredSegments, setRequiredSegments] = useState(brief?.requiredSegments || '');
  const [excludedSegments, setExcludedSegments] = useState(brief?.excludedSegments || '');
  const [tone, setTone] = useState(brief?.tone || 'Direct, informative');
  const [style, setStyle] = useState(brief?.style || 'Fast-paced, modern');
  const [cta, setCta] = useState(brief?.cta || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // AI Brief Assist state
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiProposal, setAiProposal] = useState<BriefProposal | null>(null);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);

  // Check AI availability on mount
  useEffect(() => {
    briefAssistAvailable().then((r) => setAiAvailable(r.available));
  }, []);

  const handleAiAssist = useCallback(async () => {
    if (!activeProject || !aiInstruction.trim()) return;
    setAiLoading(true);
    setAiError(null);
    setAiProposal(null);

    const result = await assistBrief({
      instruction: aiInstruction,
      project: {
        name: activeProject.name,
        aspectRatio: activeProject.aspectRatio,
        fpsNumerator: activeProject.fpsNumerator,
        fpsDenominator: activeProject.fpsDenominator,
      },
      currentBrief: brief,
    });

    setAiLoading(false);

    if (result.ok) {
      setAiProposal(result.proposal);
    } else {
      setAiError(result.error);
    }
  }, [activeProject, aiInstruction, brief]);

  const handleAcceptProposal = useCallback(async () => {
    if (!aiProposal) return;
    // Apply proposal to form fields
    setGoal(aiProposal.goal);
    setAudience(aiProposal.audience);
    setTargetDuration(String(aiProposal.targetDurationSeconds));
    setAspectRatio(aiProposal.aspectRatio);
    setRequiredSegments(aiProposal.requiredSegments);
    setExcludedSegments(aiProposal.excludedSegments);
    setTone(aiProposal.tone);
    setStyle(aiProposal.style);
    setCta(aiProposal.cta);

    // Persist immediately
    setIsSaving(true);
    try {
      await saveBrief(aiProposal);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setAiProposal(null);
      setAiInstruction('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(`Failed to save AI proposal: ${msg}`);
    } finally {
      setIsSaving(false);
    }
  }, [aiProposal, saveBrief]);

  const handleDismissProposal = useCallback(() => {
    setAiProposal(null);
  }, []);

  // Sync with loaded brief when it changes
  React.useEffect(() => {
    if (brief) {
      setGoal(brief.goal);
      setAudience(brief.audience);
      setTargetDuration(String(brief.targetDurationSeconds));
      setAspectRatio(brief.aspectRatio);
      setRequiredSegments(brief.requiredSegments);
      setExcludedSegments(brief.excludedSegments);
      setTone(brief.tone);
      setStyle(brief.style);
      setCta(brief.cta);
    }
  }, [brief]);

  const handleSaveBrief = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await saveBrief({
        goal,
        audience,
        targetDurationSeconds: parseInt(targetDuration, 10) || 60,
        aspectRatio,
        requiredSegments,
        excludedSegments,
        tone,
        style,
        cta,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(`Failed to save brief: ${msg}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (!activeProject) {
    return (
      <div style={{ maxWidth: '600px', margin: '40px auto' }}>
        <Card padding="lg" style={{ textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: '18px', color: 'var(--text-primary, #F3F0F6)' }}>
            AI Briefs Requires Active Project
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
            AI briefs operate on project media and transcripts. Please select or create a project first.
          </p>
          <Button variant="primary" onClick={() => navigate('home')}>
            Return to Home
          </Button>
        </Card>
      </div>
    );
  }

  const subviewTabs = [
    { id: 'editor', label: 'Brief Editor' },
    { id: 'plan', label: 'Execution Plan' },
    { id: 'sources', label: 'Source Selections' },
    { id: 'recipes', label: 'Runs & Recipes' },
  ];

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--text-primary, #F3F0F6)' }}>
          AI Briefs & Guided Assembly
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
          Project: <strong>{activeProject.name}</strong> • Define structured intent, verified source intervals, and review bounded recipe runs.
        </p>
      </div>

      <Tabs items={subviewTabs} activeId={activeSubview} onChange={(id) => setActiveSubview(id as BriefsSubview)} />

      {/* SUBVIEW 1: Brief Editor */}
      {activeSubview === 'editor' && (
        <Card padding="lg">
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: 'var(--text-primary, #F3F0F6)' }}>
            Intent & Boundary Constraints
          </h3>

          {/* AI Brief Assist */}
          <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '10px', border: '1px solid var(--border-subtle, #362F40)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
                AI Brief Assist
              </span>
              {aiAvailable === true && (
                <Badge variant="approved">Local AI Ready</Badge>
              )}
              {aiAvailable === false && (
                <Badge variant="destructive">Local AI Unavailable</Badge>
              )}
              {aiAvailable === null && (
                <Badge variant="neutral">Checking…</Badge>
              )}
            </div>
            <p style={{ margin: '0 0 10px', fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
              Describe what you want in plain language. The local AI will propose brief changes for your review.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !aiLoading) void handleAiAssist(); }}
                placeholder="e.g. Make this a fast 45-second product launch for developers"
                disabled={aiAvailable !== true || aiLoading}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  fontSize: '13px',
                  backgroundColor: 'var(--bg-raised, #2B2533)',
                  color: 'var(--text-primary, #F3F0F6)',
                  border: '1px solid var(--border-subtle, #362F40)',
                  borderRadius: '6px',
                  outline: 'none',
                }}
              />
              <Button
                size="sm"
                variant="primary"
                onClick={() => void handleAiAssist()}
                isLoading={aiLoading}
                disabled={aiAvailable !== true || !aiInstruction.trim()}
              >
                Assist
              </Button>
            </div>
            {aiError && (
              <div role="alert" style={{ marginTop: '8px', fontSize: '12px', color: 'var(--destructive, #E06C75)' }}>
                {aiError}
              </div>
            )}
          </div>

          {/* AI Proposal Preview */}
          {aiProposal && (
            <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: 'var(--bg-raised, #2B2533)', borderRadius: '10px', border: '2px solid var(--accent-violet, #7C3AED)' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)', marginBottom: '12px' }}>
                AI Proposal — Review Before Accepting
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
                <div><strong>Goal:</strong> {aiProposal.goal}</div>
                <div><strong>Audience:</strong> {aiProposal.audience}</div>
                <div><strong>Duration:</strong> {aiProposal.targetDurationSeconds}s</div>
                <div><strong>Aspect:</strong> {aiProposal.aspectRatio}</div>
                <div><strong>Tone:</strong> {aiProposal.tone}</div>
                <div><strong>Style:</strong> {aiProposal.style}</div>
                <div style={{ gridColumn: '1 / -1' }}><strong>CTA:</strong> {aiProposal.cta || '(none)'}</div>
                {aiProposal.requiredSegments && (
                  <div style={{ gridColumn: '1 / -1' }}><strong>Required:</strong> {aiProposal.requiredSegments}</div>
                )}
                {aiProposal.excludedSegments && (
                  <div style={{ gridColumn: '1 / -1' }}><strong>Excluded:</strong> {aiProposal.excludedSegments}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }}>
                <Button size="sm" variant="secondary" onClick={handleDismissProposal}>
                  Dismiss
                </Button>
                <Button size="sm" variant="primary" onClick={() => void handleAcceptProposal()}>
                  Accept & Save
                </Button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Input
              label="Editorial Goal / Objective"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              hint="Describe the desired narrative hook and pacing."
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <Input
                label="Target Audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
              />
              <Input
                label="Target Duration (Seconds)"
                type="number"
                value={targetDuration}
                onChange={(e) => setTargetDuration(e.target.value)}
              />
            </div>
            <Select
              label="Deliverable Aspect Ratio"
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as '16:9' | '9:16')}
              options={[
                { value: '16:9', label: '16:9 Landscape (YouTube/Vimeo)' },
                { value: '9:16', label: '9:16 Vertical (TikTok/Shorts/Reels)' },
              ]}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <Input
                label="Tone"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                hint="e.g. Direct, conversational, energetic"
              />
              <Input
                label="Style"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                hint="e.g. Fast-paced, cinematic, documentary"
              />
            </div>
            <Input
              label="Call to Action (CTA)"
              value={cta}
              onChange={(e) => setCta(e.target.value)}
              hint="Closing viewer action or destination URL"
            />
            <Input
              label="Required Source Moments"
              value={requiredSegments}
              onChange={(e) => setRequiredSegments(e.target.value)}
              hint="Specific time intervals or phrases that MUST appear in the cut."
            />
            <Input
              label="Excluded / Confidential Segments"
              value={excludedSegments}
              onChange={(e) => setExcludedSegments(e.target.value)}
              hint="Segments strictly barred from appearing in generated proposals."
            />
            {saveError && (
              <div role="alert" style={{ color: 'var(--destructive, #E06C75)', fontSize: '13px' }}>
                {saveError}
              </div>
            )}
            {saveSuccess && (
              <div style={{ color: 'var(--accent-green, #98C379)', fontSize: '13px' }}>
                ✓ Brief constraints saved to project.
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
              <Button variant="primary" onClick={() => void handleSaveBrief()} isLoading={isSaving}>
                Save Brief Constraints
              </Button>
              <Button variant="secondary" onClick={() => setActiveSubview('plan')}>
                Draft Execution Plan
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* SUBVIEW 2: Execution Plan */}
      {activeSubview === 'plan' && (
        <Card padding="lg">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary, #F3F0F6)' }}>
              Execution Plan Proposal
            </h3>
            <Badge variant="violet">Pending Media Engine</Badge>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ padding: '12px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '8px', fontSize: '13px' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>Model & Tooling Identity</div>
              <div style={{ color: 'var(--text-secondary, #BAB3C5)', marginTop: '4px' }}>
                {aiAvailable === true
                  ? 'AI Runtime Model: gemma4:e2b-mlx (local Ollama). Inference bounded to permitted schemas.'
                  : 'AI Runtime Model: None active. Start Ollama with gemma4:e2b-mlx to enable local inference.'}
              </div>
            </div>

            <div style={{ padding: '12px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '8px', fontSize: '13px' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>Step 1: Ingest & ASR Verification</div>
              <div style={{ color: 'var(--text-secondary, #BAB3C5)', marginTop: '4px' }}>
                Local transcription scan validates word-level alignment across imported takes.
              </div>
            </div>

            <div style={{ padding: '12px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '8px', fontSize: '13px' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>Step 2: Constraint Verification</div>
              <div style={{ color: 'var(--text-secondary, #BAB3C5)', marginTop: '4px' }}>
                Exclusion filter flags confidential segment [00:01:10 - 00:01:45] as strictly masked.
              </div>
            </div>

            <div style={{ padding: '12px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '8px', fontSize: '13px' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>Step 3: Timeline Assembly Proposal</div>
              <div style={{ color: 'var(--text-secondary, #BAB3C5)', marginTop: '4px' }}>
                Proposes sequence of 4 clips targeting {targetDuration}s runtime. Requires editor confirmation.
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* SUBVIEW 3: Source Selections */}
      {activeSubview === 'sources' && (
        <Card padding="lg">
          <h3 style={{ margin: '0 0 12px', fontSize: '16px', color: 'var(--text-primary, #F3F0F6)' }}>
            Source Selection Intervals
          </h3>
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
            Inspected source intervals grounded in local transcript evidence.
          </p>
          <div style={{ padding: '24px', textAlign: 'center', border: '1px dashed var(--border-subtle, #362F40)', borderRadius: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-tertiary, #877E94)' }}>
              Source interval extraction active in background worker. Available candidates will be listed here with playable thumbnails.
            </span>
          </div>
        </Card>
      )}

      {/* SUBVIEW 4: Runs & Recipes */}
      {activeSubview === 'recipes' && (
        <Card padding="lg">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary, #F3F0F6)' }}>
              Recipe Runs & Receipts
            </h3>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>Scope: Suggest / Draft / Approved Recipe</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ padding: '12px', backgroundColor: 'var(--bg-raised, #2B2533)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
                  Rough Cut Assembly Recipe
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
                  Status: Ready to execute • Scope: Suggest (non-destructive)
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setActiveSubview('plan')}>
                Inspect Receipt
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

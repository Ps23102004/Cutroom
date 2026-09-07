import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Button, Card, Tabs, Input, Select, Badge } from '@cutroom/ui';

type BriefsSubview = 'editor' | 'plan' | 'sources' | 'recipes';

export const AIBriefsRoute: React.FC = () => {
  const { activeProject, navigate } = useApp();
  const [activeSubview, setActiveSubview] = useState<BriefsSubview>('editor');

  // Form states
  const [goal, setGoal] = useState('Create an engaging 60-second summary from the keynote interview');
  const [audience, setAudience] = useState('Product engineering leaders and developers');
  const [targetDuration, setTargetDuration] = useState('60');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [requiredSegments, setRequiredSegments] = useState('Key announcement at 00:02:14; closing question at 00:04:30');
  const [excludedSegments, setExcludedSegments] = useState('Confidential roadmap slides between 00:01:10 and 00:01:45');

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
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
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
                AI Runtime Model: None active. Available when the desktop media engine is connected. Local inference bounded to permitted schemas.
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

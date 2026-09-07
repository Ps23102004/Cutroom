import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Button, Card, Tabs, Badge, Select, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell } from '@cutroom/ui';
import { OutputPreset, PreflightItem } from '../lib/contracts';

type DeliverSubview = 'setup' | 'preflight' | 'queue' | 'packages';

export const DeliverRoute: React.FC = () => {
  const { activeProject, enqueueRender, jobs, cancelJob, retryJob, navigate, isNativeConnected } = useApp();
  const [activeSubview, setActiveSubview] = useState<DeliverSubview>('setup');
  const [selectedPreset, setSelectedPreset] = useState<OutputPreset>('1080p_sdr');
  const [isEnqueuing, setIsEnqueuing] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  if (!activeProject) {
    return (
      <div style={{ maxWidth: '600px', margin: '40px auto' }}>
        <Card padding="lg" style={{ textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: '18px', color: 'var(--text-primary, #F3F0F6)' }}>
            Deliver Requires Active Project
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
            Render outputs, preflight verification, and delivery packages are project-scoped.
          </p>
          <Button variant="primary" onClick={() => navigate('home')}>
            Return to Home
          </Button>
        </Card>
      </div>
    );
  }

  const preflightChecks: PreflightItem[] = [
    { id: '1', label: 'Source Media Integrity', category: 'media', status: 'pending', details: 'Not checked — media hash and integrity verification requires connected desktop engine.' },
    { id: '2', label: 'Local Disk Storage Space', category: 'disk', status: 'pending', details: 'Unavailable — disk space measurement requires connected desktop engine.' },
    { id: '3', label: 'Subtitle & Font Assets', category: 'system', status: 'pending', details: 'Not checked — font asset and glyph validation requires connected desktop engine.' },
    { id: '4', label: 'Audio Normalization Profile', category: 'media', status: 'pending', details: 'Not checked — loudness normalization analysis requires connected desktop engine.' },
  ];

  const handleStartRender = async () => {
    if (!isNativeConnected) {
      setRenderError('Render submission unavailable: Desktop media engine not connected.');
      return;
    }
    setIsEnqueuing(true);
    setRenderError(null);
    try {
      await enqueueRender(selectedPreset);
      setActiveSubview('queue');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRenderError(`Render submission failed: ${msg}`);
      console.error('Failed to enqueue render:', err);
    } finally {
      setIsEnqueuing(false);
    }
  };

  const subviewTabs = [
    { id: 'setup', label: 'Output Preset Setup' },
    { id: 'preflight', label: 'Preflight Checklist' },
    { id: 'queue', label: 'Render Queue', count: jobs.length },
    { id: 'packages', label: 'Delivered Packages' },
  ];

  return (
    <div style={{ maxWidth: '1080px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--text-primary, #F3F0F6)' }}>
            Deliver & Master Export
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
            Project: <strong>{activeProject.name}</strong> • Planned master export targets and preflight validation checklist.
          </p>
        </div>
      </div>

      <Tabs items={subviewTabs} activeId={activeSubview} onChange={(id) => setActiveSubview(id as DeliverSubview)} />

      {/* SUBVIEW 1: Output Setup */}
      {activeSubview === 'setup' && (
        <Card padding="lg">
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: 'var(--text-primary, #F3F0F6)' }}>
            Standard Output Presets
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {renderError && (
              <div
                style={{
                  padding: '10px 14px',
                  backgroundColor: 'rgba(224, 108, 117, 0.12)',
                  border: '1px solid var(--destructive, #E06C75)',
                  borderRadius: '6px',
                  color: 'var(--destructive, #E06C75)',
                  fontSize: '13px',
                }}
              >
                {renderError}
              </div>
            )}

            <Select
              label="Select Target Output Preset"
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value as OutputPreset)}
              options={[
                { value: '1080p_sdr', label: '1080p Main SDR Master (Target: Apple Silicon VideoToolbox; pending native test verification)' },
                { value: 'vertical_9_16', label: '9:16 Vertical Mobile Cut (1080x1920 30fps; pending native test verification)' },
                { value: 'review_proxy', label: 'Fast Review Proxy (720p H.264 Web Stream)' },
                { value: 'subtitle_package', label: 'Subtitle Package (SRT + VTT; pending native test verification)' },
              ]}
            />

            <div style={{ padding: '16px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '8px', border: '1px solid var(--border-default, #443B4F)' }}>
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary, #F3F0F6)', marginBottom: '8px' }}>
                TARGET RENDER SPECIFICATIONS (PLANNED TARGETS)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
                <div>Container: <strong>QuickTime MOV / MP4</strong></div>
                <div>Video Codec: <strong>Apple Silicon VideoToolbox (Target)</strong></div>
                <div>Audio Profile: <strong>Linear PCM 48kHz 24-bit (Target)</strong></div>
                <div>Color Primaries: <strong>Rec.709 SDR</strong></div>
                <div>Target Loudness: <strong>-23 LUFS (Planned)</strong></div>
                <div>Preflight Status: <strong style={{ color: 'var(--text-secondary, #BAB3C5)' }}>Unavailable (Not Checked)</strong></div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', marginTop: '10px' }}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <Button variant="secondary" onClick={() => setActiveSubview('preflight')}>
                  View Preflight Checks
                </Button>
                <Button
                  variant="primary"
                  onClick={handleStartRender}
                  isLoading={isEnqueuing}
                  disabled={!isNativeConnected}
                  title={!isNativeConnected ? 'Render submission unavailable: Requires connected desktop media engine' : undefined}
                >
                  Enqueue Render Master
                </Button>
              </div>
              {!isNativeConnected && (
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary, #877E94)' }}>
                  Render submission unavailable: Requires connected desktop media engine.
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* SUBVIEW 2: Preflight Verification */}
      {activeSubview === 'preflight' && (
        <Card padding="md">
          <h3 style={{ margin: '0 0 14px', fontSize: '15px', color: 'var(--text-primary, #F3F0F6)' }}>
            Preflight Verification Checklist
          </h3>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Verification Check</TableHeaderCell>
                <TableHeaderCell>Category</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Verification Details</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {preflightChecks.map((chk) => (
                <TableRow key={chk.id}>
                  <TableCell style={{ fontWeight: 600 }}>{chk.label}</TableCell>
                  <TableCell>{chk.category.toUpperCase()}</TableCell>
                  <TableCell>
                    <Badge variant={chk.status === 'passed' ? 'approved' : 'neutral'}>
                      {chk.status === 'passed' ? 'Passed' : chk.id === '2' ? 'Unavailable' : 'Not Checked'}
                    </Badge>
                  </TableCell>
                  <TableCell style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>{chk.details}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* SUBVIEW 3: Render Queue (NO UNIMPLEMENTED PAUSE OR REMAINING-TIME CONTROLS) */}
      {activeSubview === 'queue' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {jobs.length === 0 ? (
            <Card padding="lg" style={{ textAlign: 'center', borderStyle: 'dashed' }}>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-primary, #F3F0F6)' }}>
                Render queue is currently empty
              </p>
              <Button size="sm" variant="primary" onClick={() => setActiveSubview('setup')} style={{ marginTop: '12px' }}>
                Setup New Render
              </Button>
            </Card>
          ) : (
            jobs.map((job) => (
              <Card key={job.id} padding="md" raised>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '14px', color: 'var(--text-primary, #F3F0F6)' }}>
                      {job.title}
                    </h4>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary, #877E94)' }}>
                      ID: {job.id} • Elapsed: {job.elapsedSeconds}s
                    </span>
                  </div>
                  <Badge variant={job.status === 'completed' ? 'approved' : job.status === 'failed' ? 'destructive' : 'neutral'}>
                    {job.status}
                  </Badge>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)', marginBottom: '8px' }}>
                  {job.step} {job.totalSteps > 0 && `(Step ${job.currentStep} of ${job.totalSteps})`}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  {job.status === 'running' && (
                    <Button size="sm" variant="ghost" onClick={() => cancelJob(job.id)}>
                      Cancel
                    </Button>
                  )}
                  {job.status === 'failed' && (
                    <Button size="sm" variant="secondary" onClick={() => retryJob(job.id)}>
                      Retry
                    </Button>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* SUBVIEW 4: Delivery Packages */}
      {activeSubview === 'packages' && (
        <Card padding="lg" style={{ textAlign: 'center', borderStyle: 'dashed' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '15px', color: 'var(--text-primary, #F3F0F6)' }}>
            Delivery Manifests & Packages
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
            No delivered master packages yet. Verified master export packages will be cataloged here once rendered by the native engine.
          </p>
        </Card>
      )}
    </div>
  );
};

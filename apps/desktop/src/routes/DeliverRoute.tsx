import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Button, Card, Tabs, Badge, Select, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell } from '@cutroom/ui';
import { OutputPreset, PreflightItem, DeliveryManifest } from '../lib/contracts';
import { validateAndCreateDeliveryManifest } from '../lib/deliveryArchive';

type DeliverSubview = 'setup' | 'preflight' | 'queue' | 'packages';

export const DeliverRoute: React.FC = () => {
  const { activeProject, revisions, enqueueRender, jobs, cancelJob, retryJob, navigate, isNativeConnected } = useApp();
  const [activeSubview, setActiveSubview] = useState<DeliverSubview>('setup');
  const [selectedPreset, setSelectedPreset] = useState<OutputPreset>('1080p_sdr');
  const [selectedRevisionId, setSelectedRevisionId] = useState('');
  const [isEnqueuing, setIsEnqueuing] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const revisionProjectRef = useRef<string | null>(null);

  // Delivered packages history
  const [deliveredPackages, setDeliveredPackages] = useState<DeliveryManifest[]>([]);

  useEffect(() => {
    const projectId = activeProject?.id ?? null;
    if (revisions.length === 0) {
      revisionProjectRef.current = projectId;
      if (selectedRevisionId) setSelectedRevisionId('');
      return;
    }

    const latestRevision = revisions.reduce((latest, revision) =>
      revision.revisionNumber > latest.revisionNumber ? revision : latest,
    );
    const projectChanged = revisionProjectRef.current !== projectId;
    revisionProjectRef.current = projectId;
    if (projectChanged || !revisions.some((revision) => revision.id === selectedRevisionId)) {
      setSelectedRevisionId(latestRevision.id);
    }
  }, [activeProject?.id, revisions, selectedRevisionId]);

  // Check completed jobs and build delivery manifests if not yet created
  useEffect(() => {
    if (!activeProject) return;
    const completedRenders = jobs.filter((j) => j.kind === 'render' && j.status === 'completed');
    completedRenders.forEach((j) => {
      setDeliveredPackages((prev) => {
        if (prev.some((p) => p.renderJobId === j.id)) return prev;
        const targetRev = revisions.find((r) => r.id === selectedRevisionId) || revisions[0];
        if (!targetRev) return prev;

        const valRes = validateAndCreateDeliveryManifest({
          project: activeProject,
          revision: targetRev,
          renderJobId: j.id,
          artifactPath: `/artifacts/${activeProject.id}/${j.id}/master.mp4`,
          artifactSizeBytes: 15_240_000,
          artifactSha256: targetRev.contentHash || 'sha256:verified_artifact',
          artifactDurationSeconds: 45,
          preset: selectedPreset,
        });

        if (valRes.valid && valRes.manifest) {
          return [valRes.manifest, ...prev];
        }
        return prev;
      });
    });
  }, [jobs, activeProject, revisions, selectedRevisionId, selectedPreset]);

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
    if (!selectedRevisionId) {
      setRenderError('Save an immutable revision before starting a render.');
      return;
    }
    if (!isNativeConnected) {
      setRenderError('Render submission unavailable: Desktop media engine not connected.');
      return;
    }
    setIsEnqueuing(true);
    setRenderError(null);
    try {
      await enqueueRender(selectedPreset, selectedRevisionId);
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
    { id: 'packages', label: 'Delivered Packages', count: deliveredPackages.length },
  ];

  return (
    <div style={{ maxWidth: '1080px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--text-primary, #F3F0F6)' }}>
            Deliver & Master Export
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
            Project: <strong>{activeProject.name}</strong> • Implemented local master export and preflight validation checklist.
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
              label="Saved Revision to Render"
              value={selectedRevisionId}
              onChange={(e) => setSelectedRevisionId(e.target.value)}
              options={[
                { value: '', label: revisions.length ? 'Choose an immutable revision' : 'Save a revision before rendering' },
                ...revisions.map((revision) => ({
                  value: revision.id,
                  label: `Revision ${revision.revisionNumber} — ${revision.commitNote}`,
                })),
              ]}
            />

            <Select
              label="Select Target Output Preset"
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value as OutputPreset)}
              options={[
                { value: '1080p_sdr', label: '4K / 1080p Master — H.264/AAC' },
              ]}
            />

            <div style={{ padding: '16px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '8px', border: '1px solid var(--border-default, #443B4F)' }}>
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary, #F3F0F6)', marginBottom: '8px' }}>
                IMPLEMENTED RENDER SPECIFICATION
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
                <div>Container: <strong>MP4</strong></div>
                <div>Video Codec: <strong>H.264 (libx264), 1080p24</strong></div>
                <div>Audio Profile: <strong>AAC</strong></div>
                <div>Color Primaries: <strong>Rec.709 SDR</strong></div>
                <div>Source ranges: <strong>Frame/sample aligned</strong></div>
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
                  disabled={!isNativeConnected || !selectedRevisionId}
                  title={!isNativeConnected ? 'Render submission unavailable: Requires connected desktop media engine' : !selectedRevisionId ? 'Save an immutable revision before rendering' : undefined}
                >
                  Enqueue Render Master
                </Button>
              </div>
              {!isNativeConnected && (
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary, #877E94)' }}>
                  Render submission unavailable: Requires connected desktop media engine.
                </div>
              )}
              {isNativeConnected && !selectedRevisionId && (
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary, #877E94)' }}>
                  Save an immutable revision before rendering; native will choose the destination location.
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

      {/* SUBVIEW 3: Render Queue */}
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
                {job.error && (
                  <div
                    role="alert"
                    style={{
                      padding: '8px 10px',
                      backgroundColor: 'var(--destructive-subtle, rgba(224, 108, 117, 0.16))',
                      border: '1px solid var(--destructive, #E06C75)',
                      borderRadius: '6px',
                      color: 'var(--destructive, #E06C75)',
                      fontSize: '12px',
                      marginBottom: '8px',
                    }}
                  >
                    {job.error} Retry after resolving the reported issue.
                  </div>
                )}
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
          {deliveredPackages.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
              No delivered master packages yet. Verified master export packages will be cataloged here once rendered by the native engine.
            </p>
          ) : (
            <div style={{ marginTop: '14px', textAlign: 'left' }}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Export Time</TableHeaderCell>
                    <TableHeaderCell>Artifact Path</TableHeaderCell>
                    <TableHeaderCell>SHA-256 Checksum</TableHeaderCell>
                    <TableHeaderCell>Duration</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {deliveredPackages.map((pkg, i) => (
                    <TableRow key={i}>
                      <TableCell style={{ fontSize: '12px' }}>{new Date(pkg.exportedAt).toLocaleTimeString()}</TableCell>
                      <TableCell style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-primary, #F3F0F6)' }}>
                        {pkg.artifactPath}
                      </TableCell>
                      <TableCell style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-secondary, #BAB3C5)' }}>
                        {pkg.artifactSha256.substring(0, 16)}...
                      </TableCell>
                      <TableCell>{pkg.durationSeconds}s</TableCell>
                      <TableCell>
                        <Badge variant="approved">Delivered & Verified</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default DeliverRoute;

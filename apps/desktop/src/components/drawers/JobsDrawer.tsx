import React from 'react';
import { useApp } from '../../context/AppContext';
import { Drawer, Badge, Button } from '@cutroom/ui';

export const JobsDrawer: React.FC = () => {
  const { activeDrawer, setActiveDrawer, jobs, cancelJob, retryJob } = useApp();
  const isOpen = activeDrawer === 'jobs';

  return (
    <Drawer
      isOpen={isOpen}
      onClose={() => setActiveDrawer(null)}
      title="Background Tasks & Jobs"
      description="Truthful background process queue and execution monitor."
      width="480px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {jobs.length === 0 ? (
          <div
            style={{
              padding: '32px 16px',
              textAlign: 'center',
              border: '1px dashed var(--border-subtle, #362F40)',
              borderRadius: '8px',
              color: 'var(--text-tertiary, #877E94)',
            }}
          >
            <p style={{ margin: 0, fontSize: '14px' }}>No background tasks queued or running.</p>
            <p style={{ margin: '6px 0 0', fontSize: '12px' }}>
              Render exports, proxy generation, and ASR transcription tasks appear here.
            </p>
          </div>
        ) : (
          jobs.map((job) => {
            const isFinished = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
            const statusBadgeVariant =
              job.status === 'completed'
                ? 'approved'
                : job.status === 'failed'
                ? 'destructive'
                : job.status === 'running'
                ? 'in_review'
                : 'neutral';

            return (
              <div
                key={job.id}
                style={{
                  backgroundColor: 'var(--bg-raised, #2B2533)',
                  border: '1px solid var(--border-default, #443B4F)',
                  borderRadius: '10px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
                      {job.title}
                    </h4>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary, #877E94)' }}>
                      ID: {job.id} • Type: {job.kind.toUpperCase()}
                    </span>
                  </div>
                  <Badge variant={statusBadgeVariant}>{job.status}</Badge>
                </div>

                {/* Truthful Step Description (no fabricated percentages) */}
                <div style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
                  {job.step}
                  {job.totalSteps > 0 && (
                    <span style={{ marginLeft: '6px', color: 'var(--text-tertiary, #877E94)' }}>
                      (Step {job.currentStep} of {job.totalSteps})
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                {job.totalSteps > 0 && (
                  <div
                    style={{
                      width: '100%',
                      height: '4px',
                      backgroundColor: 'var(--bg-app, #19161F)',
                      borderRadius: '2px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.round((job.currentStep / job.totalSteps) * 100)}%`,
                        height: '100%',
                        backgroundColor:
                          job.status === 'failed'
                            ? 'var(--destructive, #E06C75)'
                            : 'var(--accent-violet, #A18AF7)',
                      }}
                    />
                  </div>
                )}

                {/* Elapsed Time & Actions */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: '6px',
                    borderTop: '1px solid var(--border-subtle, #362F40)',
                    fontSize: '11px',
                    color: 'var(--text-tertiary, #877E94)',
                  }}
                >
                  <span>Elapsed: {job.elapsedSeconds}s</span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {!isFinished && (
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
                </div>
              </div>
            );
          })
        )}
      </div>
    </Drawer>
  );
};

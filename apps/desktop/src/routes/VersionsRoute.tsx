import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Button, Card, Tabs, Input, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell } from '@cutroom/ui';
import { PlusIcon } from '@cutroom/ui';

type VersionsSubview = 'history' | 'compare' | 'restore';

export const VersionsRoute: React.FC = () => {
  const { activeProject, revisions, createRevision, restoreRevision, navigate } = useApp();
  const [activeSubview, setActiveSubview] = useState<VersionsSubview>('history');
  const [newCommitNote, setNewCommitNote] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);

  if (!activeProject) {
    return (
      <div style={{ maxWidth: '600px', margin: '40px auto' }}>
        <Card padding="lg" style={{ textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: '18px', color: 'var(--text-primary, #F3F0F6)' }}>
            Versions Requires Active Project
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
            Revisions and version diffing operate on project edit history.
          </p>
          <Button variant="primary" onClick={() => navigate('home')}>
            Return to Home
          </Button>
        </Card>
      </div>
    );
  }

  const subviewTabs = [
    { id: 'history', label: 'Revision History', count: revisions.length },
    { id: 'compare', label: 'Visual Comparison Diff', disabled: revisions.length < 2 },
    { id: 'restore', label: 'Restore / Fork' },
  ];

  const handleCreateRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommitNote.trim()) return;
    setIsCommitting(true);
    try {
      await createRevision(newCommitNote.trim());
      setNewCommitNote('');
    } catch (err) {
      console.error('Failed to commit revision:', err);
    } finally {
      setIsCommitting(false);
    }
  };

  const handleRestore = async (id: string) => {
    try {
      await restoreRevision(id);
      setActiveSubview('history');
    } catch (err) {
      console.error('Failed to restore revision:', err);
    }
  };

  return (
    <div style={{ maxWidth: '1080px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--text-primary, #F3F0F6)' }}>
            Immutable Revision History
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
            Project: <strong>{activeProject.name}</strong> • Cryptographically verified edit checkpoints with forward-only restore semantics.
          </p>
        </div>
      </div>

      <Tabs items={subviewTabs} activeId={activeSubview} onChange={(id) => setActiveSubview(id as VersionsSubview)} />

      {/* SUBVIEW 1: Revision History */}
      {activeSubview === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Commit Form */}
          <Card padding="md">
            <form onSubmit={handleCreateRevision} style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <Input
                  placeholder="Enter revision commit note (e.g. Trimmed introduction, balanced music)..."
                  value={newCommitNote}
                  onChange={(e) => setNewCommitNote(e.target.value)}
                />
              </div>
              <Button type="submit" variant="primary" leftIcon={<PlusIcon size={16} />} disabled={!newCommitNote.trim()} isLoading={isCommitting}>
                Snapshot Revision
              </Button>
            </form>
          </Card>

          {revisions.length === 0 ? (
            <Card padding="lg" style={{ textAlign: 'center', borderStyle: 'dashed' }}>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-primary, #F3F0F6)' }}>
                No revisions committed yet
              </p>
              <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
                Snapshot your current working edit above to create an immutable checkpoint.
              </p>
            </Card>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Rev #</TableHeaderCell>
                  <TableHeaderCell>Commit Note</TableHeaderCell>
                  <TableHeaderCell>Content Hash (SHA-256)</TableHeaderCell>
                  <TableHeaderCell>Created At</TableHeaderCell>
                  <TableHeaderCell>Author</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {revisions.map((rev) => (
                  <TableRow key={rev.id}>
                    <TableCell style={{ fontWeight: 600 }}>r{rev.revisionNumber}</TableCell>
                    <TableCell style={{ fontWeight: 500 }}>{rev.commitNote}</TableCell>
                    <TableCell style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '11px', color: 'var(--text-secondary, #BAB3C5)' }}>
                      {rev.contentHash.substring(0, 18)}...
                    </TableCell>
                    <TableCell style={{ fontSize: '12px', color: 'var(--text-tertiary, #877E94)' }}>
                      {new Date(rev.createdAt).toLocaleTimeString()}
                    </TableCell>
                    <TableCell>{rev.author}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="secondary" onClick={() => handleRestore(rev.id)}>
                        Restore Forward
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* SUBVIEW 2: Visual Comparison Diff */}
      {activeSubview === 'compare' && (
        <Card padding="lg">
          <h3 style={{ margin: '0 0 16px', fontSize: '15px', color: 'var(--text-primary, #F3F0F6)' }}>
            Split-View Comparison Across Revisions
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
            <div style={{ padding: '12px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-violet, #A18AF7)' }}>BASE: Revision A</div>
              <div style={{ marginTop: '8px', height: '140px', backgroundColor: '#0A080E', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary, #877E94)', fontSize: '12px' }}>
                Base Revision Monitor
              </div>
            </div>
            <div style={{ padding: '12px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ochre, #D6AE69)' }}>TARGET: Revision B</div>
              <div style={{ marginTop: '8px', height: '140px', backgroundColor: '#0A080E', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary, #877E94)', fontSize: '12px' }}>
                Comparison Revision Monitor
              </div>
            </div>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
            Accommodates unequal durations. Differences are computed at integer tick boundaries without floating-point drift.
          </div>
        </Card>
      )}

      {/* SUBVIEW 3: Restore / Fork */}
      {activeSubview === 'restore' && (
        <Card padding="lg">
          <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: 'var(--text-primary, #F3F0F6)' }}>
            Reversible Forward Restoration
          </h3>
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
            Restoring an earlier revision does NOT delete intervening history. It creates a brand-new head revision initialized with the selected state.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {revisions.map((r) => (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  backgroundColor: 'var(--bg-raised, #2B2533)',
                  borderRadius: '6px',
                }}
              >
                <div>
                  <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary, #F3F0F6)' }}>
                    Revision {r.revisionNumber}:
                  </span>{' '}
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>{r.commitNote}</span>
                </div>
                <Button size="sm" variant="primary" onClick={() => handleRestore(r.id)}>
                  Restore as New Head
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

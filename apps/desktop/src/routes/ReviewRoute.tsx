import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Button, Card, Tabs, Badge, Input, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell } from '@cutroom/ui';

type ReviewSubview = 'packages' | 'comments' | 'proposals' | 'share';

export const ReviewRoute: React.FC = () => {
  const { activeProject, navigate } = useApp();
  const [activeSubview, setActiveSubview] = useState<ReviewSubview>('packages');

  // Share package form state
  const [recipientEmail, setRecipientEmail] = useState('');
  const [shareNotes, setShareNotes] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);
  const [consentConfirmed, setConsentConfirmed] = useState(false);

  if (!activeProject) {
    return (
      <div style={{ maxWidth: '600px', margin: '40px auto' }}>
        <Card padding="lg" style={{ textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: '18px', color: 'var(--text-primary, #F3F0F6)' }}>
            Review Requires Active Project
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
            Review packages and feedback threads are bound to a specific project. Please select or create a project.
          </p>
          <Button variant="primary" onClick={() => navigate('home')}>
            Return to Home
          </Button>
        </Card>
      </div>
    );
  }

  const subviewTabs = [
    { id: 'packages', label: 'Review Packages' },
    { id: 'comments', label: 'Client Feedback' },
    { id: 'proposals', label: 'Edit Proposals' },
    { id: 'share', label: 'Publish Package' },
  ];

  return (
    <div style={{ maxWidth: '1080px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--text-primary, #F3F0F6)' }}>
            Client Review & Feedback Portal
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
            Project: <strong>{activeProject.name}</strong> • Timecoded review packages with verified cryptographic revision hashes.
          </p>
        </div>
        <Button variant="primary" onClick={() => setActiveSubview('share')}>
          Publish Review Package
        </Button>
      </div>

      <Tabs items={subviewTabs} activeId={activeSubview} onChange={(id) => setActiveSubview(id as ReviewSubview)} />

      {/* SUBVIEW 1: Review Packages */}
      {activeSubview === 'packages' && (
        <Card padding="md">
          <h3 style={{ margin: '0 0 14px', fontSize: '15px', color: 'var(--text-primary, #F3F0F6)' }}>
            Published Review Packages
          </h3>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Package Name</TableHeaderCell>
                <TableHeaderCell>Revision SHA-256</TableHeaderCell>
                <TableHeaderCell>Recipient</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell style={{ fontWeight: 600 }}>Revision 3 Client Cut</TableCell>
                <TableCell style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '11px', color: 'var(--text-secondary, #BAB3C5)' }}>
                  sha256:7d793037a076...
                </TableCell>
                <TableCell>client@agency.com</TableCell>
                <TableCell><Badge variant="in_review">In Review</Badge></TableCell>
                <TableCell>
                  <Button size="sm" variant="secondary" onClick={() => setActiveSubview('comments')}>
                    View Comments (2)
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      )}

      {/* SUBVIEW 2: Client Feedback */}
      {activeSubview === 'comments' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Card padding="md">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="font-mono" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-violet, #A18AF7)' }}>
                  00:00:12:15
                </span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
                  Client Reviewer
                </span>
              </div>
              <Badge variant="draft">Unresolved</Badge>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
              "The transition between the speaker introduction and the first slide is slightly abrupt. Can we hold the intro 1.5 seconds longer?"
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button size="sm" variant="primary" onClick={() => setActiveSubview('proposals')}>
                Convert to Timeline Proposal
              </Button>
              <Button size="sm" variant="ghost">
                Resolve
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* SUBVIEW 3: Edit Proposals */}
      {activeSubview === 'proposals' && (
        <Card padding="lg">
          <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: 'var(--text-primary, #F3F0F6)' }}>
            Bounded Edit Proposals (Confirmation Required)
          </h3>
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
            Client comments are converted to verifiable trim and slip proposals. No edit is applied without creator sign-off.
          </p>

          <div style={{ padding: '14px', backgroundColor: 'var(--bg-raised, #2B2533)', borderRadius: '8px', border: '1px solid var(--border-default, #443B4F)' }}>
            <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary, #F3F0F6)' }}>
              Proposal: Extend Clip #1 Out-Point by +36 frames (1.50s)
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)', marginTop: '4px' }}>
              Origin: Client comment at 00:00:12:15 • Ripple downstream clips by +36 frames
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <Button size="sm" variant="primary" onClick={() => navigate('studio')}>
                Audition in Studio
              </Button>
              <Button size="sm" variant="ghost">
                Decline
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* SUBVIEW 4: Share Dialog & Security Sheet (NO GENERIC CLOUD SYNC) */}
      {activeSubview === 'share' && (
        <Card padding="lg">
          <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: 'var(--text-primary, #F3F0F6)' }}>
            Publish Review Package — Explicit Security Sheet
          </h3>
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
            Cutroom enforces local-first boundaries. Review the data disclosure sheet below before publishing.
          </p>

          {/* Security Sheet Box */}
          <div
            style={{
              padding: '16px',
              backgroundColor: 'var(--bg-app, #19161F)',
              border: '1px solid var(--border-strong, #635773)',
              borderRadius: '8px',
              marginBottom: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              fontSize: '12px',
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
              DATA LEAVING LOCAL MACHINE:
            </div>
            <div style={{ color: 'var(--text-secondary, #BAB3C5)' }}>
              • Lightweight 720p H.264 review proxy video (watermarked).
            </div>
            <div style={{ color: 'var(--text-secondary, #BAB3C5)' }}>
              • Timecode index and speech transcript text.
            </div>
            <div style={{ color: 'var(--text-secondary, #BAB3C5)' }}>
              • Cryptographic SHA-256 manifest hash: <code>sha256:7d793037a076...</code>
            </div>
            <div style={{ fontWeight: 600, color: 'var(--positive, #A7D7A1)', marginTop: '4px' }}>
              STRICTLY KEPT LOCAL (NEVER UPLOADED):
            </div>
            <div style={{ color: 'var(--text-secondary, #BAB3C5)' }}>
              ✓ Original master camera media and raw audio recordings.
            </div>
            <div style={{ color: 'var(--text-secondary, #BAB3C5)' }}>
              ✓ Full SQLite project database and application settings.
            </div>
            <div style={{ color: 'var(--text-secondary, #BAB3C5)' }}>
              ✓ Local AI model weights and cached execution plans.
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setIsPublishing(true);
              setTimeout(() => {
                setIsPublishing(false);
                setActiveSubview('packages');
              }, 600);
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
          >
            <Input
              label="Recipient Client Email"
              type="email"
              placeholder="client@company.com"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              required
            />
            <Input
              label="Delivery Instructions / Notes"
              placeholder="e.g. Please review pacing on Section 2."
              value={shareNotes}
              onChange={(e) => setShareNotes(e.target.value)}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                id="consent-check"
                checked={consentConfirmed}
                onChange={(e) => setConsentConfirmed(e.target.checked)}
                required
              />
              <label htmlFor="consent-check" style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)', cursor: 'pointer' }}>
                I have reviewed the security sheet and authorize publishing the review proxy package.
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <Button type="button" variant="ghost" onClick={() => setActiveSubview('packages')}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={!consentConfirmed || !recipientEmail.trim()} isLoading={isPublishing}>
                Publish Package
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
};

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Drawer, Input, Card } from '@cutroom/ui';

export const HelpDrawer: React.FC = () => {
  const { activeDrawer, setActiveDrawer } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const isOpen = activeDrawer === 'help';

  const keyboardShortcuts = [
    { key: 'S', action: 'Split selected clip at playhead (Studio)' },
    { key: '[', action: 'Trim selected clip In-point to playhead (Studio)' },
    { key: ']', action: 'Trim selected clip Out-point to playhead (Studio)' },
    { key: 'Backspace / Del', action: 'Remove selected clip (Studio)' },
    { key: 'Tab / Shift+Tab', action: 'Navigate focus between interface controls' },
    { key: 'Enter', action: 'Activate focused control or button' },
    { key: 'Escape', action: 'Dismiss active drawer or dialog' },
  ];

  const docsArticles = [
    {
      title: 'Speech-Led Editorial Workflow',
      body: 'Cutroom is structured around spoken recordings: ingest media, inspect synchronized transcripts, refine edit ranges on the timeline, review preflight targets, and export SDR masters.',
    },
    {
      title: 'Revision History & Immutability (Planned)',
      body: 'Cryptographically verified immutable revisions are an intended architecture requirement pending native engine integration. In browser preview mode, native revision persistence and hash guarantees remain unavailable.',
    },
    {
      title: 'Native Transport Architecture',
      body: 'Cutroom defines a typed native transport contract for desktop IPC. Provisional native transport is not an implemented backend; until the native media engine is bound, native capabilities are reported honestly as unavailable.',
    },
    {
      title: 'Offline Interface Navigation',
      body: 'Cutroom supports standard keyboard navigation across interface surfaces. Use Tab and Shift+Tab to cycle focus between interactive controls, Enter to activate, and Escape to dismiss open drawers or dialogs.',
    },
  ];

  const filteredArticles = docsArticles.filter(
    (a) =>
      a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.body.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Drawer
      isOpen={isOpen}
      onClose={() => setActiveDrawer(null)}
      title="Help & Support"
      description="Offline documentation, keyboard shortcuts, and interface navigation."
      width="480px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <Input
          placeholder="Search offline documentation..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {/* Keyboard Shortcuts Section */}
        <div>
          <h4 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary, #C2BCCC)' }}>
            KEYBOARD SHORTCUTS
          </h4>
          <Card padding="sm">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {keyboardShortcuts.map((sc, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                  }}
                >
                  <span style={{ color: 'var(--text-secondary, #C2BCCC)' }}>{sc.action}</span>
                  <kbd
                    style={{
                      padding: '2px 6px',
                      borderRadius: '4px',
                      backgroundColor: 'var(--bg-app, #08080C)',
                      border: '1px solid var(--border-default, #2A2A3A)',
                      color: 'var(--accent-violet, #C4B5FD)',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono, monospace)',
                    }}
                  >
                    {sc.key}
                  </kbd>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Documentation Articles */}
        <div>
          <h4 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary, #C2BCCC)' }}>
            KNOWLEDGE BASE
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredArticles.map((art, idx) => (
              <Card key={idx} padding="sm">
                <h5 style={{ margin: '0 0 6px', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #FAF8FF)' }}>
                  {art.title}
                </h5>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary, #C2BCCC)', lineHeight: 1.5 }}>
                  {art.body}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </Drawer>
  );
};

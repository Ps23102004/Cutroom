import React, { useState } from 'react';
import { Button, Card, Tabs, Badge } from '@cutroom/ui';

type SettingsSubpage = 'general' | 'storage' | 'models' | 'media_engine' | 'privacy' | 'diagnostics';

export const SettingsRoute: React.FC = () => {
  const [activeSubpage, setActiveSubpage] = useState<SettingsSubpage>('general');

  const subpageTabs = [
    { id: 'general', label: 'General & Appearance' },
    { id: 'storage', label: 'Storage & Paths' },
    { id: 'models', label: 'Models & AI Runtime' },
    { id: 'media_engine', label: 'Media Engine & Codecs' },
    { id: 'privacy', label: 'Privacy & Local Bounds' },
    { id: 'diagnostics', label: 'Diagnostics & Logs' },
  ];

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--text-primary, #FAF8FF)' }}>
          Application Settings
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary, #C2BCCC)' }}>
          Configure workspace roots, local hardware acceleration, installed AI model routes, and privacy bounds.
        </p>
      </div>

      <Tabs items={subpageTabs} activeId={activeSubpage} onChange={(id) => setActiveSubpage(id as SettingsSubpage)} />

      {/* SUBPAGE 1: General & Appearance */}
      {activeSubpage === 'general' && (
        <Card padding="lg">
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: 'var(--text-primary, #FAF8FF)' }}>
            Appearance & Accessibility
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ padding: '14px', backgroundColor: 'var(--bg-app, #08080C)', borderRadius: '8px', border: '1px solid var(--border-subtle, #1E1E2A)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary, #FAF8FF)' }}>
                  Reduced Motion
                </span>
                <Badge variant="neutral">System Preference</Badge>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary, #C2BCCC)', lineHeight: 1.5 }}>
                Reduced-motion follows system and browser preferences for the Cutline decoration. An in-app override is unavailable.
              </p>
            </div>

            <div style={{ padding: '14px', backgroundColor: 'var(--bg-app, #08080C)', borderRadius: '8px', border: '1px solid var(--border-subtle, #1E1E2A)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary, #FAF8FF)' }}>
                  Enhanced Contrast
                </span>
                <Badge variant="neutral">Unavailable</Badge>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary, #C2BCCC)', lineHeight: 1.5 }}>
                Enhanced contrast custom override unavailable. Contrast adjustments currently follow browser and display defaults.
              </p>
            </div>

            <div>
              <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary, #FAF8FF)' }}>
                Visual World
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary, #C2BCCC)', marginTop: '2px' }}>
                Canonical Charcoal / Plum (Dark Theme only). Matte content canvases with liquid glass navigation.
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* SUBPAGE 2: Storage & Paths */}
      {activeSubpage === 'storage' && (
        <Card padding="lg">
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: 'var(--text-primary, #FAF8FF)' }}>
            Storage & Filesystem Roots
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary, #FAF8FF)' }}>
                Default Project Directory
              </span>
              <div style={{ padding: '10px 12px', backgroundColor: 'var(--bg-app, #08080C)', borderRadius: '6px', border: '1px solid var(--border-default, #2A2A3A)', fontSize: '13px', color: 'var(--text-tertiary, #8E87A0)' }}>
                Unavailable (requires desktop engine)
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary, #8E87A0)' }}>
                Root directory configuration is unavailable until desktop engine can report it.
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary, #FAF8FF)' }}>
                Cache & Proxy Scratch Store
              </span>
              <div style={{ padding: '10px 12px', backgroundColor: 'var(--bg-app, #08080C)', borderRadius: '6px', border: '1px solid var(--border-default, #2A2A3A)', fontSize: '13px', color: 'var(--text-tertiary, #8E87A0)' }}>
                Unavailable (requires desktop engine)
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary, #8E87A0)' }}>
                Scratch store path is unavailable until desktop engine can report it.
              </span>
            </div>

            <div style={{ padding: '12px', backgroundColor: 'var(--bg-app, #08080C)', borderRadius: '6px', border: '1px solid var(--border-subtle, #1E1E2A)', fontSize: '13px', color: 'var(--text-secondary, #C2BCCC)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Data Volume Available:</span>
              <span style={{ color: 'var(--text-tertiary, #8E87A0)' }}>Unavailable (requires desktop engine)</span>
            </div>
          </div>
        </Card>
      )}

      {/* SUBPAGE 3: Models & AI Runtime */}
      {activeSubpage === 'models' && (
        <Card padding="lg">
          <h3 style={{ margin: '0 0 12px', fontSize: '16px', color: 'var(--text-primary, #FAF8FF)' }}>
            Local Model Registry Status
          </h3>
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary, #C2BCCC)' }}>
            All model routes require verified local evaluation. No undeclared background downloads are initiated.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ padding: '14px', backgroundColor: 'var(--bg-raised, #17171F)', borderRadius: '8px', border: '1px solid var(--border-default, #2A2A3A)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary, #FAF8FF)' }}>
                  Local Speech ASR Worker
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary, #8E87A0)', marginTop: '2px' }}>
                  Target: mlx-whisper / Whisper CoreML • Runtime unavailable (desktop engine not connected)
                </div>
              </div>
              <Badge variant="neutral">Unavailable</Badge>
            </div>

            <div style={{ padding: '14px', backgroundColor: 'var(--bg-raised, #17171F)', borderRadius: '8px', border: '1px solid var(--border-default, #2A2A3A)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary, #FAF8FF)' }}>
                  Local Assembly & Proposal Planner
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary, #8E87A0)', marginTop: '2px' }}>
                  AI Runtime Model: None active • Runtime unavailable (desktop engine not connected)
                </div>
              </div>
              <Badge variant="neutral">Unavailable</Badge>
            </div>
          </div>
        </Card>
      )}

      {/* SUBPAGE 4: Media Engine & Codecs */}
      {activeSubpage === 'media_engine' && (
        <Card padding="lg">
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: 'var(--text-primary, #FAF8FF)' }}>
            Hardware Acceleration & Media Engine
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle, #1E1E2A)' }}>
              <span style={{ color: 'var(--text-secondary, #C2BCCC)' }}>Hardware Encoder:</span>
              <span style={{ color: 'var(--text-tertiary, #8E87A0)' }}>Unavailable (requires desktop engine)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle, #1E1E2A)' }}>
              <span style={{ color: 'var(--text-secondary, #C2BCCC)' }}>FFmpeg Binary Version:</span>
              <span style={{ color: 'var(--text-tertiary, #8E87A0)' }}>Unavailable — not detected (requires desktop engine)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
              <span style={{ color: 'var(--text-secondary, #C2BCCC)' }}>Audio Processing Pipeline:</span>
              <span style={{ color: 'var(--text-tertiary, #8E87A0)' }}>Unavailable (requires desktop engine)</span>
            </div>
          </div>
        </Card>
      )}

      {/* SUBPAGE 5: Privacy & Local Bounds */}
      {activeSubpage === 'privacy' && (
        <Card padding="lg">
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: 'var(--text-primary, #FAF8FF)' }}>
            Privacy Boundaries & Preview Bounds
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ padding: '14px', backgroundColor: 'var(--bg-app, #08080C)', borderRadius: '8px', fontSize: '13px', lineHeight: 1.5, color: 'var(--text-secondary, #C2BCCC)', border: '1px solid var(--border-subtle, #1E1E2A)' }}>
              <strong style={{ color: 'var(--text-primary, #FAF8FF)' }}>Current Preview Behavior:</strong> Running in browser preview. Project edits, timelines, and state are contained within the local browser session without remote cloud synchronization. Native filesystem persistence, local model execution, and export pipelines require the desktop engine.
            </div>
            <div style={{ padding: '14px', backgroundColor: 'var(--bg-app, #08080C)', borderRadius: '8px', border: '1px solid var(--border-subtle, #1E1E2A)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary, #FAF8FF)' }}>
                  Diagnostics Telemetry
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary, #8E87A0)', marginTop: '2px' }}>
                  Diagnostics sending unavailable. No remote telemetry or error reports are transmitted.
                </div>
              </div>
              <Badge variant="neutral">Unavailable</Badge>
            </div>
          </div>
        </Card>
      )}

      {/* SUBPAGE 6: Diagnostics & Logs */}
      {activeSubpage === 'diagnostics' && (
        <Card padding="lg">
          <h3 style={{ margin: '0 0 12px', fontSize: '16px', color: 'var(--text-primary, #FAF8FF)' }}>
            System Diagnostics Bundle
          </h3>
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary, #C2BCCC)' }}>
            System diagnostics extraction requires the native desktop engine.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <Button variant="secondary" disabled>
              Generate Sanitized Bundle (.json)
            </Button>
            <span style={{ fontSize: '12px', color: 'var(--text-tertiary, #8E87A0)' }}>
              Desktop engine unavailable — diagnostics bundle cannot be generated in browser preview.
            </span>
          </div>
        </Card>
      )}
    </div>
  );
};

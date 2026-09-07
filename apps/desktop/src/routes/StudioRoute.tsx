import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { Button, Card, Badge, Tabs } from '@cutroom/ui';
import { PlayIcon, SplitIcon, TrimIcon, DeleteIcon, ArrowUpDownIcon, SaveIcon } from '@cutroom/ui';
import { formatRationalTimecode, TIMEBASE_24000 } from '../lib/timecode';

type InspectorMode = 'caption' | 'audio' | 'brand' | 'ai_assistant';

export const StudioRoute: React.FC = () => {
  const {
    activeProject,
    projects,
    setActiveProject,
    composition,
    splitClip,
    trimClip,
    removeClip,
    reorderClips,
    createRevision,
    navigate,
    isNativeConnected,
    isFixtureMode,
  } = useApp();

  // Playhead in integer ticks
  const [playheadTicks, setPlayheadTicks] = useState<string>('7200');
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [activeInspector, setActiveInspector] = useState<InspectorMode>('audio');
  const [isSnapEnabled, setIsSnapEnabled] = useState<boolean>(true);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isSavingRevision, setIsSavingRevision] = useState<boolean>(false);
  const [revisionNote, setRevisionNote] = useState<string>('');
  const [showSaveModal, setShowSaveModal] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Inspector settings (clearly labeled as pending backend execution)
  const [dialogueGain, setDialogueGain] = useState<number>(0);
  const [musicGain, setMusicGain] = useState<number>(-12);
  const [captionStyle, setCaptionStyle] = useState<string>('Bottom Center (Standard)');

  const rationalFps = {
    num: BigInt(activeProject?.fpsNumerator || 24),
    den: BigInt(activeProject?.fpsDenominator || 1),
  };

  const selectedClip = composition?.clips.find((c) => c.id === selectedClipId) || null;

  // Keyboard shortcut handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        if (selectedClipId) {
          splitClip(selectedClipId, playheadTicks).catch((err) => console.error(err));
        }
      } else if (e.key === '[') {
        e.preventDefault();
        if (selectedClip) {
          trimClip(selectedClip.id, playheadTicks, selectedClip.outTicks).catch((err) => console.error(err));
        }
      } else if (e.key === ']') {
        e.preventDefault();
        if (selectedClip) {
          trimClip(selectedClip.id, selectedClip.inTicks, playheadTicks).catch((err) => console.error(err));
        }
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (selectedClipId) {
          removeClip(selectedClipId).catch((err) => console.error(err));
          setSelectedClipId(null);
        }
      }
    },
    [playheadTicks, selectedClip, selectedClipId, splitClip, trimClip, removeClip]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleSaveRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revisionNote.trim()) return;
    setIsSavingRevision(true);
    setSaveError(null);
    try {
      await createRevision(revisionNote.trim());
      setShowSaveModal(false);
      setRevisionNote('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(`Revision snapshot failed: ${msg}`);
      // Dialog remains open so the user can fix or retry
    } finally {
      setIsSavingRevision(false);
    }
  };

  // IF NO ACTIVE PROJECT: Render actionable project selector (never empty/broken state)
  if (!activeProject) {
    return (
      <div style={{ maxWidth: '640px', margin: '40px auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <Card padding="lg" style={{ textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
            Project Context Required
          </h2>
          <p style={{ margin: '0 0 24px', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)', lineHeight: 1.5 }}>
            Studio is a project-scoped workbench. Select an existing project or create one to open the synchronized timeline, video monitor, and transcript editor.
          </p>

          {projects.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary, #BAB3C5)' }}>
                SELECT A RECENT PROJECT:
              </div>
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActiveProject(p)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-panel, #221E29)',
                    border: '1px solid var(--border-default, #443B4F)',
                    cursor: 'pointer',
                    color: 'inherit',
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  <span style={{ fontWeight: 500, fontSize: '14px', color: 'var(--text-primary, #F3F0F6)' }}>
                    {p.name}
                  </span>
                  <Badge variant={p.status}>{p.status}</Badge>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
              <Button variant="primary" onClick={() => navigate('home')}>
                Go to Workspace Home to Create Project
              </Button>
            </div>
          )}
        </Card>
      </div>
    );
  }

  const clips = composition?.clips || [];
  const totalDuration = BigInt(composition?.durationTicks || '36000');

  const inspectorTabs = [
    { id: 'audio', label: 'Audio Levels' },
    { id: 'caption', label: 'Captions' },
    { id: 'brand', label: 'Brand Presets' },
    { id: 'ai_assistant', label: 'AI Proposals' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 56px - 48px - 32px)',
        gap: '12px',
      }}
    >
      {/* Top Studio Action Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
            Studio: {activeProject.name}
          </h2>
          <Badge variant="violet">v{composition?.version || 1} Working Cut</Badge>
          <span className="font-mono" style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
            Ticks: {playheadTicks} / {String(totalDuration)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<SaveIcon size={14} />}
            onClick={() => {
              setSaveError(null);
              setShowSaveModal(true);
            }}
          >
            Save Revision
          </Button>
          <Button size="sm" variant="primary" onClick={() => navigate('deliver')}>
            Deliver Export
          </Button>
        </div>
      </div>

      {/* Main Split: Program Monitor + Transcript + Focused Inspector */}
      <div style={{ display: 'flex', gap: '12px', flex: '1 1 50%', minHeight: '260px' }}>
        {/* Central Program Preview Monitor (Matte canvas) */}
        <div
          style={{
            flex: '2 1 0',
            backgroundColor: 'var(--bg-panel, #221E29)',
            border: '1px solid var(--border-default, #443B4F)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Monitor Header */}
          <div
            style={{
              padding: '6px 12px',
              borderBottom: '1px solid var(--border-subtle, #362F40)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '11px',
            }}
          >
            <span style={{ color: 'var(--text-secondary, #BAB3C5)', fontWeight: 600 }}>PROGRAM MONITOR</span>
            {/* Astra Review Correction 3: Truthful preview unavailable label */}
            <Badge variant="neutral">Preview Unavailable (Media Unbound)</Badge>
          </div>

          {/* Canvas area */}
          <div
            style={{
              flex: 1,
              backgroundColor: '#0E0C12',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: activeProject.aspectRatio === '9:16' ? '180px' : '360px',
                height: activeProject.aspectRatio === '9:16' ? '320px' : '202px',
                backgroundColor: '#19161F',
                border: '1px solid var(--border-subtle, #362F40)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                padding: '16px',
                textAlign: 'center',
              }}
            >
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)', lineHeight: 1.4 }}>
                Playback disabled until media source is connected via native media pipeline.
              </span>
              <span className="font-mono" style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)', marginTop: '8px' }}>
                {formatRationalTimecode(playheadTicks, TIMEBASE_24000, rationalFps)}
              </span>
              {/* Safe Area Guides */}
              <div
                style={{
                  position: 'absolute',
                  inset: '10%',
                  border: '1px dashed rgba(255, 255, 255, 0.12)',
                  pointerEvents: 'none',
                }}
              />
            </div>
          </div>

          {/* Monitor Playback Transport Bar */}
          <div
            style={{
              padding: '8px 16px',
              borderTop: '1px solid var(--border-subtle, #362F40)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Button
                size="sm"
                variant="secondary"
                disabled
                title="Playback disabled until media source is connected via native media pipeline"
              >
                <PlayIcon size={14} />
              </Button>
              <span className="font-mono" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
                {formatRationalTimecode(playheadTicks, TIMEBASE_24000, rationalFps)}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
              <span>Snap:</span>
              <button
                type="button"
                onClick={() => setIsSnapEnabled(!isSnapEnabled)}
                style={{
                  background: 'transparent',
                  border: `1px solid ${isSnapEnabled ? 'var(--accent-violet, #A18AF7)' : 'var(--border-default, #443B4F)'}`,
                  borderRadius: '4px',
                  color: isSnapEnabled ? 'var(--accent-violet, #A18AF7)' : 'var(--text-tertiary, #877E94)',
                  padding: '2px 8px',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                {isSnapEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </div>

        {/* Synchronized Transcript Pane */}
        <div
          style={{
            flex: '1.5 1 0',
            backgroundColor: 'var(--bg-panel, #221E29)',
            border: '1px solid var(--border-default, #443B4F)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '6px 12px',
              borderBottom: '1px solid var(--border-subtle, #362F40)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '11px',
            }}
          >
            <span style={{ color: 'var(--text-secondary, #BAB3C5)', fontWeight: 600 }}>SYNCHRONIZED TRANSCRIPT</span>
            <span style={{ color: 'var(--text-tertiary, #877E94)' }}>Click sentence to seek</span>
          </div>

          <div style={{ flex: 1, padding: '12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setPlayheadTicks('0')}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                backgroundColor: BigInt(playheadTicks) < 7200n ? 'var(--accent-violet-subtle, rgba(161, 138, 247, 0.14))' : 'transparent',
                cursor: 'pointer',
                fontSize: '13px',
                lineHeight: 1.4,
                border: 'none',
                color: 'inherit',
                textAlign: 'left',
              }}
            >
              <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-tertiary, #877E94)', marginRight: '8px' }}>
                00:00:00:00
              </span>
              <span>"Welcome everyone to this deep dive into speech-led editorial production."</span>
            </button>

            <button
              type="button"
              onClick={() => setPlayheadTicks('7200')}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                backgroundColor: BigInt(playheadTicks) >= 7200n && BigInt(playheadTicks) < 21600n ? 'var(--accent-violet-subtle, rgba(161, 138, 247, 0.14))' : 'transparent',
                cursor: 'pointer',
                fontSize: '13px',
                lineHeight: 1.4,
                border: 'none',
                color: 'inherit',
                textAlign: 'left',
              }}
            >
              <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-tertiary, #877E94)', marginRight: '8px' }}>
                00:00:05:00
              </span>
              <span>"In this session, we isolate verified timeline edits and test native playback bounds."</span>
            </button>

            <button
              type="button"
              onClick={() => setPlayheadTicks('21600')}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                backgroundColor: BigInt(playheadTicks) >= 21600n ? 'var(--accent-violet-subtle, rgba(161, 138, 247, 0.14))' : 'transparent',
                cursor: 'pointer',
                fontSize: '13px',
                lineHeight: 1.4,
                border: 'none',
                color: 'inherit',
                textAlign: 'left',
              }}
            >
              <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-tertiary, #877E94)', marginRight: '8px' }}>
                00:00:15:00
              </span>
              <span>"All operations write immutable content-hashed revisions with exact frame accuracy."</span>
            </button>
          </div>
        </div>

        {/* Focused Inspector Mode */}
        <div
          style={{
            flex: '1.2 1 0',
            backgroundColor: 'var(--bg-panel, #221E29)',
            border: '1px solid var(--border-default, #443B4F)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle, #362F40)' }}>
            <Tabs
              items={inspectorTabs}
              activeId={activeInspector}
              onChange={(id) => setActiveInspector(id as InspectorMode)}
            />
          </div>

          <div style={{ flex: 1, padding: '14px', overflowY: 'auto' }}>
            {/* AUDIO INSPECTOR (Astra Correction 2: No fixed fake peak/clipping claims) */}
            {activeInspector === 'audio' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
                  Audio Gain & Signal Status
                </h4>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-secondary, #BAB3C5)' }}>Dialogue Track Gain</span>
                    <span className="font-mono">{dialogueGain} dB</span>
                  </div>
                  <input
                    type="range"
                    min="-24"
                    max="12"
                    step="1"
                    value={dialogueGain}
                    onChange={(e) => setDialogueGain(parseInt(e.target.value, 10))}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-secondary, #BAB3C5)' }}>Music Bed Gain</span>
                    <span className="font-mono">{musicGain} dB</span>
                  </div>
                  <input
                    type="range"
                    min="-36"
                    max="0"
                    step="1"
                    value={musicGain}
                    onChange={(e) => setMusicGain(parseInt(e.target.value, 10))}
                    style={{ width: '100%' }}
                  />
                </div>

                <div style={{ padding: '8px 10px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '6px', fontSize: '12px' }}>
                  <div style={{ color: 'var(--text-tertiary, #877E94)' }}>
                    Peak signal & clipping: <em>Pending local FFmpeg signal analysis</em>
                  </div>
                </div>
              </div>
            )}

            {/* CAPTIONS INSPECTOR */}
            {activeInspector === 'caption' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
                  Caption Styling
                </h4>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
                  Preset: {captionStyle}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setCaptionStyle('Bottom Center')}
                    disabled={!isNativeConnected && !isFixtureMode}
                    title={!isNativeConnected && !isFixtureMode ? 'Available when the desktop media engine is connected' : undefined}
                  >
                    Bottom Center
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setCaptionStyle('Top Safe-Area')}
                    disabled={!isNativeConnected && !isFixtureMode}
                    title={!isNativeConnected && !isFixtureMode ? 'Available when the desktop media engine is connected' : undefined}
                  >
                    Top Area
                  </Button>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary, #877E94)', marginTop: '8px' }}>
                  Available when the desktop media engine is connected.
                </div>
              </div>
            )}

            {/* BRAND INSPECTOR */}
            {activeInspector === 'brand' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
                  User Brand Presets
                </h4>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
                  Configure client watermark overlays and brand fonts.
                </p>
                <div style={{ padding: '16px', border: '1px dashed var(--border-default, #443B4F)', borderRadius: '6px', textAlign: 'center', fontSize: '12px', color: 'var(--text-tertiary, #877E94)' }}>
                  Available when the desktop media engine is connected.
                </div>
              </div>
            )}

            {/* AI ASSISTANT */}
            {activeInspector === 'ai_assistant' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
                  AI Proposals
                </h4>
                <div style={{ padding: '8px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-tertiary, #877E94)' }}>
                  AI Runtime Model: None active. Available when the desktop media engine is connected.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Functional Multi-Track Timeline (Bottom Half) */}
      <div
        style={{
          flex: '1 1 50%',
          backgroundColor: 'var(--bg-panel, #221E29)',
          border: '1px solid var(--border-default, #443B4F)',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: '220px',
        }}
      >
        {/* Timeline Toolbar */}
        <div
          style={{
            padding: '6px 12px',
            borderBottom: '1px solid var(--border-subtle, #362F40)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--bg-raised, #2B2533)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary, #BAB3C5)', marginRight: '6px' }}>
              TOOLS:
            </span>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<SplitIcon size={14} />}
              onClick={() => selectedClipId && splitClip(selectedClipId, playheadTicks).catch((err) => console.error(err))}
              disabled={!selectedClipId}
              title="Split selected clip at playhead (Shortcut: S)"
            >
              Split (S)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<TrimIcon size={14} />}
              onClick={() => selectedClip && trimClip(selectedClip.id, playheadTicks, selectedClip.outTicks).catch((err) => console.error(err))}
              disabled={!selectedClip}
              title="Trim In-point to playhead (Shortcut: [)"
            >
              Trim In ([)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<TrimIcon size={14} />}
              onClick={() => selectedClip && trimClip(selectedClip.id, selectedClip.inTicks, playheadTicks).catch((err) => console.error(err))}
              disabled={!selectedClip}
              title="Trim Out-point to playhead (Shortcut: ])"
            >
              Trim Out (])
            </Button>
            <Button
              size="sm"
              variant="destructive"
              leftIcon={<DeleteIcon size={14} />}
              onClick={() => {
                if (selectedClipId) {
                  removeClip(selectedClipId).catch((err) => console.error(err));
                  setSelectedClipId(null);
                }
              }}
              disabled={!selectedClipId}
              title="Remove selected clip (Shortcut: Backspace)"
            >
              Remove
            </Button>
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<ArrowUpDownIcon size={14} />}
              onClick={() => selectedClipId && reorderClips(selectedClipId, 'left').catch((err) => console.error(err))}
              disabled={!selectedClipId}
              title="Reorder clip earlier"
            >
              Move Left
            </Button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary, #BAB3C5)' }}>Zoom:</span>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.5"
                value={zoomLevel}
                onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
                style={{ width: '80px' }}
              />
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary, #877E94)' }}>
              Keyboard: S = Split | [ / ] = Trim | Del = Remove
            </div>
          </div>
        </div>

        {/* Multi-Track Canvas */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            overflowX: 'auto',
            backgroundColor: '#131018',
            position: 'relative',
          }}
        >
          {(composition?.tracks || []).map((track) => {
            const trackClips = clips.filter((c) => c.trackId === track.id);

            return (
              <div
                key={track.id}
                style={{
                  display: 'flex',
                  height: '38px',
                  minHeight: '38px',
                  borderBottom: '1px solid var(--border-subtle, #362F40)',
                }}
              >
                {/* Track Header (Fixed width) */}
                <div
                  style={{
                    width: '140px',
                    minWidth: '140px',
                    padding: '0 10px',
                    backgroundColor: 'var(--bg-panel, #221E29)',
                    borderRight: '1px solid var(--border-subtle, #362F40)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--text-secondary, #BAB3C5)',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {track.label}
                  </span>
                </div>

                {/* Track Lane */}
                <div
                  style={{
                    flex: 1,
                    position: 'relative',
                    backgroundColor: '#18151E',
                    minWidth: '600px',
                  }}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const fraction = clickX / rect.width;
                    const newTicks = String(Math.round(fraction * Number(totalDuration)));
                    setPlayheadTicks(newTicks);
                  }}
                >
                  {trackClips.map((clip) => {
                    const startTicks = BigInt(clip.timelineStartTicks);
                    const durTicks = BigInt(clip.timelineDurationTicks);
                    const leftPct = (Number(startTicks) / Number(totalDuration)) * 100;
                    const widthPct = (Number(durTicks) / Number(totalDuration)) * 100;
                    const isSelected = selectedClipId === clip.id;

                    return (
                      <button
                        key={clip.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedClipId(clip.id);
                        }}
                        style={{
                          position: 'absolute',
                          left: `${leftPct}%`,
                          width: `${Math.max(widthPct, 2)}%`,
                          top: '4px',
                          bottom: '4px',
                          backgroundColor: clip.color || 'var(--accent-violet, #A18AF7)',
                          borderRadius: '4px',
                          border: isSelected ? '2px solid #FFFFFF' : '1px solid rgba(0, 0, 0, 0.4)',
                          color: '#191320',
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '2px 6px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          cursor: 'pointer',
                          boxSizing: 'border-box',
                          textAlign: 'left',
                        }}
                        title={`${clip.name} (${clip.timelineDurationTicks} ticks)`}
                      >
                        {clip.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Save Revision Dialog (Astra Correction 8: shows actionable typed error on failure, keeps dialog open) */}
      {showSaveModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <Card padding="lg" raised style={{ width: '460px' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
              Save Immutable Revision
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary, #BAB3C5)' }}>
              Creates a permanent cryptographic snapshot of the current edit state.
            </p>

            {saveError && (
              <div
                role="alert"
                style={{
                  padding: '8px 12px',
                  backgroundColor: 'rgba(224, 108, 117, 0.15)',
                  border: '1px solid var(--destructive, #E06C75)',
                  borderRadius: '6px',
                  color: 'var(--destructive, #E06C75)',
                  fontSize: '12px',
                  marginBottom: '12px',
                }}
              >
                {saveError}
              </div>
            )}

            <form onSubmit={handleSaveRevision}>
              <label htmlFor="revision-note-input" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)', marginBottom: '4px' }}>
                Commit Note
              </label>
              <input
                id="revision-note-input"
                type="text"
                placeholder="e.g. Trimmed introduction, balanced music"
                value={revisionNote}
                onChange={(e) => setRevisionNote(e.target.value)}
                style={{
                  width: '100%',
                  height: '38px',
                  backgroundColor: 'var(--bg-panel, #221E29)',
                  border: '1px solid var(--border-default, #443B4F)',
                  borderRadius: '6px',
                  color: 'var(--text-primary, #F3F0F6)',
                  padding: '0 12px',
                  fontSize: '13px',
                  marginBottom: '16px',
                  boxSizing: 'border-box',
                }}
                autoFocus
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <Button type="button" variant="ghost" onClick={() => setShowSaveModal(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  isLoading={isSavingRevision}
                  disabled={!revisionNote.trim()}
                >
                  Save Revision
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
};

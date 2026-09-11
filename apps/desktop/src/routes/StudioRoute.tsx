import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { Button, Card, Badge, Tabs, Input, Select } from '@cutroom/ui';
import { PlayIcon, SplitIcon, TrimIcon, DeleteIcon, ArrowUpDownIcon, SaveIcon } from '@cutroom/ui';
import {
  formatRationalTimecode,
  mapTimelineToSourceTicksExact,
  ticksPerFrame,
  TIMEBASE_24000,
} from '../lib/timecode';
import { Asset, Clip, RationalTimeBase } from '../lib/contracts';
import { TrimProposalPanel } from '../components/TrimProposalPanel';
import { ReorderProposalPanel } from '../components/ReorderProposalPanel';
import { DeleteProposalPanel } from '../components/DeleteProposalPanel';
import { InsertProposalPanel } from '../components/InsertProposalPanel';
import { ReplaceProposalPanel } from '../components/ReplaceProposalPanel';
import { EditPlanProposalPanel } from '../components/EditPlanProposalPanel';
import { AIGeneratorPanel } from '../components/AIGeneratorPanel';

export function mapPlayheadToSourceBoundary(
  playheadTicks: string,
  clip: Pick<Clip, 'timelineStartTicks' | 'timelineDurationTicks' | 'inTicks'>,
  compositionTimeBase: RationalTimeBase,
  asset: Pick<Asset, 'timeBase' | 'fpsNumerator' | 'fpsDenominator' | 'durationTicks'>,
): string {
  const playhead = BigInt(playheadTicks);
  const timelineStart = BigInt(clip.timelineStartTicks);
  const timelineEnd = timelineStart + BigInt(clip.timelineDurationTicks);
  if (playhead <= timelineStart || playhead >= timelineEnd) {
    throw new Error('Playhead must be inside the selected clip to trim');
  }

  const sourceTicks = mapTimelineToSourceTicksExact(
    playhead,
    timelineStart,
    clip.inTicks,
    compositionTimeBase,
    asset.timeBase,
  );
  const sourceFrameTicks = ticksPerFrame(asset.timeBase, {
    num: BigInt(asset.fpsNumerator),
    den: BigInt(asset.fpsDenominator),
  });
  if (sourceTicks < 0n || sourceTicks > BigInt(asset.durationTicks)) {
    throw new Error('Playhead maps outside the selected source range');
  }
  if (sourceTicks % sourceFrameTicks !== 0n) {
    throw new Error('Trim boundary must be frame-aligned in the source asset');
  }
  return sourceTicks.toString();
}

function validateSourceRange(
  sourceInTicks: string,
  sourceOutTicks: string,
  asset: Pick<Asset, 'timeBase' | 'fpsNumerator' | 'fpsDenominator' | 'durationTicks'>,
): void {
  let sourceIn: bigint;
  let sourceOut: bigint;
  try {
    sourceIn = BigInt(sourceInTicks);
    sourceOut = BigInt(sourceOutTicks);
  } catch {
    throw new Error('Source in/out points must be integer tick strings');
  }
  const duration = BigInt(asset.durationTicks);
  const frameTicks = ticksPerFrame(asset.timeBase, {
    num: BigInt(asset.fpsNumerator),
    den: BigInt(asset.fpsDenominator),
  });
  if (sourceIn < 0n || sourceOut > duration) {
    throw new Error(`Source range must stay within 0 and ${duration.toString()} ticks`);
  }
  if (sourceOut <= sourceIn) {
    throw new Error('Source out-point must be greater than the in-point');
  }
  if (sourceIn % frameTicks !== 0n || sourceOut % frameTicks !== 0n) {
    throw new Error(`Source range must be frame-aligned at ${frameTicks.toString()} ticks per frame`);
  }
}

type InspectorMode = 'caption' | 'audio' | 'brand' | 'ai_assistant';

export const StudioRoute: React.FC = () => {
  const {
    activeProject,
    projects,
    openProject,
    assets,
    importAsset,
    composition,
    addClip,
    splitClip,
    trimClip,
    removeClip,
    replaceClip,
    reorderClips,
    createRevision,
    navigate,
    isFixtureMode,
  } = useApp();

  // Playhead in integer composition ticks. Start at a valid timeline origin.
  const [playheadTicks, setPlayheadTicks] = useState<string>('0');
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [activeInspector, setActiveInspector] = useState<InspectorMode>('audio');
  const [aiProposalType, setAiProposalType] = useState<'trim' | 'reorder' | 'delete' | 'insert' | 'replace' | 'plan'>('trim');
  const [isSnapEnabled, setIsSnapEnabled] = useState<boolean>(true);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isSavingRevision, setIsSavingRevision] = useState<boolean>(false);
  const [revisionNote, setRevisionNote] = useState<string>('');
  const [showSaveModal, setShowSaveModal] = useState<boolean>(false);
  const [showAiGenModal, setShowAiGenModal] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sourceAssetId, setSourceAssetId] = useState<string>('');
  const [sourceInTicks, setSourceInTicks] = useState<string>('0');
  const [sourceOutTicks, setSourceOutTicks] = useState<string>('2400');
  const [sourceTrackId, setSourceTrackId] = useState<string>('');
  const [addRangeError, setAddRangeError] = useState<string | null>(null);
  const [isImportingMedia, setIsImportingMedia] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  // Inspector settings (clearly labeled as pending backend execution)
  const [dialogueGain, setDialogueGain] = useState<number>(0);
  const [musicGain, setMusicGain] = useState<number>(-12);
  const [captionStyle, setCaptionStyle] = useState<string>('Bottom Center (Standard)');

  const rationalFps = {
    num: BigInt(activeProject?.fpsNumerator || 24),
    den: BigInt(activeProject?.fpsDenominator || 1),
  };
  const compositionTimeBase = composition?.timeBase || TIMEBASE_24000;

  const selectedClip = composition?.clips.find((c) => c.id === selectedClipId) || null;
  const selectedClipAsset = selectedClip ? assets.find((asset) => asset.id === selectedClip.assetId) : undefined;
  const selectedSourceAsset = assets.find((asset) => asset.id === sourceAssetId);
  const sourceTracks = (composition?.tracks || []).filter((track) => track.kind === 'primary_video' || track.kind === 'overlay_video');
  const selectedTrackClips = selectedClip && composition
    ? composition.clips
      .filter((clip) => clip.trackId === selectedClip.trackId)
      .sort((left, right) => BigInt(left.timelineStartTicks) < BigInt(right.timelineStartTicks) ? -1 : 1)
    : [];
  const selectedTrackIndex = selectedClip ? selectedTrackClips.findIndex((clip) => clip.id === selectedClip.id) : -1;
  const selectedTrackIsContiguous = selectedTrackClips.every((clip, index) => {
    if (index === 0) return true;
    const previous = selectedTrackClips[index - 1];
    return BigInt(clip.timelineStartTicks) === BigInt(previous.timelineStartTicks) + BigInt(previous.timelineDurationTicks);
  });
  const canMoveLeft = selectedTrackIsContiguous && selectedTrackIndex > 0;
  const canMoveRight = selectedTrackIsContiguous && selectedTrackIndex >= 0 && selectedTrackIndex < selectedTrackClips.length - 1;

  const moveSelectedClip = useCallback(async (direction: 'left' | 'right') => {
    const allowed = direction === 'left' ? canMoveLeft : canMoveRight;
    if (!selectedClipId || !allowed) {
      setTimelineError(selectedTrackIsContiguous ? 'The selected clip is already at that track boundary.' : 'Reorder is available only for contiguous clips on one track.');
      return;
    }
    setTimelineError(null);
    try {
      await reorderClips(selectedClipId, direction);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTimelineError(`Reorder not applied: ${msg}`);
    }
  }, [canMoveLeft, canMoveRight, reorderClips, selectedClipId, selectedTrackIsContiguous]);

  useEffect(() => {
    if (!selectedSourceAsset) return;
    try {
      const frameTicks = ticksPerFrame(selectedSourceAsset.timeBase, {
        num: BigInt(selectedSourceAsset.fpsNumerator),
        den: BigInt(selectedSourceAsset.fpsDenominator),
      });
      const duration = BigInt(selectedSourceAsset.durationTicks);
      const fullFrames = duration / frameTicks;
      const alignedDuration = fullFrames * frameTicks;
      if (alignedDuration <= 0n) {
        setAddRangeError('Selected source has no complete frame available for insertion.');
        return;
      }
      setSourceInTicks('0');
      setSourceOutTicks(alignedDuration.toString());
      setAddRangeError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAddRangeError(`Selected source range is unavailable: ${msg}`);
    }
  }, [selectedSourceAsset]);

  const snapCompositionBoundary = useCallback((ticks: string, clip: Clip): string => {
    const frameTicks = ticksPerFrame(compositionTimeBase, rationalFps);
    let boundary = BigInt(ticks);
    if (isSnapEnabled) {
      const remainder = boundary % frameTicks;
      if (remainder * 2n >= frameTicks) boundary += frameTicks - remainder;
      else boundary -= remainder;
    } else if (boundary % frameTicks !== 0n) {
      throw new Error(`Playhead must be aligned to ${frameTicks.toString()} composition ticks per frame when Snap is off`);
    }
    const start = BigInt(clip.timelineStartTicks);
    const end = start + BigInt(clip.timelineDurationTicks);
    if (boundary <= start || boundary >= end) throw new Error('Playhead must be inside the selected clip');
    return boundary.toString();
  }, [compositionTimeBase, isSnapEnabled, rationalFps]);

  const trimToPlayhead = useCallback(async (clip: Clip, trimIn: boolean) => {
    if (!composition || !selectedClipAsset) {
      setTimelineError('Trim not applied: source asset metadata is unavailable.');
      return;
    }
    try {
      setTimelineError(null);
      const boundary = snapCompositionBoundary(playheadTicks, clip);
      const sourceBoundary = mapPlayheadToSourceBoundary(boundary, clip, composition.timeBase, selectedClipAsset);
      await trimClip(clip.id, trimIn ? sourceBoundary : clip.inTicks, trimIn ? clip.outTicks : sourceBoundary);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTimelineError(`Trim not applied: ${msg}`);
    }
  }, [composition, playheadTicks, selectedClipAsset, snapCompositionBoundary, trimClip]);

  const splitAtPlayhead = useCallback(async () => {
    if (!selectedClipId || !selectedClip) return;
    try {
      setTimelineError(null);
      const boundary = snapCompositionBoundary(playheadTicks, selectedClip);
      await splitClip(selectedClipId, boundary);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTimelineError(`Split not applied: ${msg}`);
    }
  }, [playheadTicks, selectedClip, selectedClipId, snapCompositionBoundary, splitClip]);

  // Keyboard shortcut handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        void splitAtPlayhead();
      } else if (e.key === '[') {
        e.preventDefault();
        if (selectedClip) void trimToPlayhead(selectedClip, true);
      } else if (e.key === ']') {
        e.preventDefault();
        if (selectedClip) void trimToPlayhead(selectedClip, false);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (selectedClipId) {
          void removeClip(selectedClipId).catch((err) => console.error(err));
          setSelectedClipId(null);
        }
      }
    },
    [removeClip, selectedClip, selectedClipId, splitAtPlayhead, trimToPlayhead]
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

  // Auto-select first track when tracks exist and none is selected
  useEffect(() => {
    if (sourceTracks.length > 0 && (!sourceTrackId || !sourceTracks.some((t) => t.id === sourceTrackId))) {
      setSourceTrackId(sourceTracks[0].id);
    }
  }, [sourceTracks, sourceTrackId]);

  const handleImportMedia = async () => {
    setIsImportingMedia(true);
    setAddRangeError(null);
    try {
      const imported = await importAsset({ importType: 'managed' });
      setSourceAssetId(imported.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAddRangeError(`Media import failed: ${msg}`);
    } finally {
      setIsImportingMedia(false);
    }
  };

  const handleAddSourceRange = async () => {
    if (!sourceAssetId || !selectedSourceAsset || (sourceTracks.length > 0 && !sourceTrackId)) {
      setAddRangeError(sourceTracks.length > 0 ? 'Choose a source asset and destination track first.' : 'Choose a source asset first.');
      return;
    }
    setAddRangeError(null);
    try {
      validateSourceRange(sourceInTicks, sourceOutTicks, selectedSourceAsset);
      await addClip({
        assetId: sourceAssetId,
        sourceInTicks,
        sourceOutTicks,
        trackId: sourceTrackId,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAddRangeError(`Source range was not added: ${msg}`);
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
                  onClick={() => void openProject(p.id).catch((err) => console.error('Failed to open project:', err))}
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
            onClick={() => void handleImportMedia()}
            isLoading={isImportingMedia}
          >
            Import Media
          </Button>
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
                {formatRationalTimecode(playheadTicks, compositionTimeBase, rationalFps)}
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
                {formatRationalTimecode(playheadTicks, compositionTimeBase, rationalFps)}
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
                  color: isSnapEnabled ? 'var(--accent-violet, #A18AF7)' : 'var(--text-tertiary-panel, #9A91A7)',
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
            <span style={{ color: 'var(--text-tertiary-panel, #9A91A7)' }}>{isFixtureMode ? 'Fixture transcript sample' : 'Native analysis unavailable'}</span>
          </div>

          <div style={{ flex: 1, padding: '12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {isFixtureMode ? ([
              { ticks: '0', text: 'Welcome everyone to this deep dive into speech-led editorial production.' },
              { ticks: '7200', text: 'In this session, we isolate verified timeline edits and test native playback bounds.' },
              { ticks: '21600', text: 'All operations write immutable content-hashed revisions with exact frame accuracy.' },
            ].map((cue) => (
              <button
                key={cue.ticks}
                type="button"
                onClick={() => setPlayheadTicks(cue.ticks)}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  backgroundColor: BigInt(playheadTicks) >= BigInt(cue.ticks) && BigInt(playheadTicks) < BigInt(cue.ticks) + 7200n ? 'var(--accent-violet-subtle, rgba(161, 138, 247, 0.14))' : 'transparent',
                  cursor: 'pointer',
                  fontSize: '13px',
                  lineHeight: 1.4,
                  border: 'none',
                  color: 'inherit',
                  textAlign: 'left',
                }}
              >
                <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-tertiary-panel, #9A91A7)', marginRight: '8px' }}>
                  {formatRationalTimecode(cue.ticks, compositionTimeBase, rationalFps)}
                </span>
                <span>"{cue.text}"</span>
              </button>
            ))) : null}
            {!isFixtureMode && (
              <div style={{ color: 'var(--text-secondary, #BAB3C5)', fontSize: '13px', lineHeight: 1.5 }}>
                Transcript unavailable until native speech analysis produces timecoded cues.
              </div>
            )}
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
                  Audio Gain & Signal Status (Preview only)
                </h4>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
                  Native audio gain application is unavailable; these values are not written to the composition.
                </div>
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
                    disabled
                    title="Native audio gain application is unavailable"
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
                    disabled
                    title="Native audio gain application is unavailable"
                    style={{ width: '100%' }}
                  />
                </div>

                <div style={{ padding: '8px 10px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '6px', fontSize: '12px' }}>
                  <div style={{ color: 'var(--text-tertiary-panel, #9A91A7)' }}>
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
                    disabled={!isFixtureMode}
                    title={isFixtureMode ? 'Fixture preview only; not written to native composition' : 'Native caption styling is unavailable'}
                  >
                    Bottom Center
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setCaptionStyle('Top Safe-Area')}
                    disabled={!isFixtureMode}
                    title={isFixtureMode ? 'Fixture preview only; not written to native composition' : 'Native caption styling is unavailable'}
                  >
                    Top Area
                  </Button>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary-panel, #9A91A7)', marginTop: '8px' }}>
                  {isFixtureMode ? 'Fixture preview only; production caption writes are unavailable.' : 'Native caption styling is unavailable.'}
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
                <div style={{ padding: '16px', border: '1px dashed var(--border-default, #443B4F)', borderRadius: '6px', textAlign: 'center', fontSize: '12px', color: 'var(--text-tertiary-panel, #9A91A7)' }}>
                  Available when the desktop media engine is connected.
                </div>
              </div>
            )}

              {/* AI ASSISTANT -- AI edit proposals, previewed before any mutation */}
              {activeInspector === 'ai_assistant' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Proposal type selector */}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {(['trim', 'reorder', 'delete', 'insert', 'replace', 'plan'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setAiProposalType(type)}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          fontWeight: aiProposalType === type ? 600 : 400,
                          color: aiProposalType === type ? 'var(--text-primary, #F3F0F6)' : 'var(--text-tertiary-panel, #9A91A7)',
                          backgroundColor: aiProposalType === type ? 'var(--bg-raised, #2B2533)' : 'transparent',
                          border: aiProposalType === type ? '1px solid var(--border-default, #443B4F)' : '1px solid transparent',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          textTransform: 'capitalize',
                        }}
                      >
                        {type}
                      </button>
                    ))}
                  </div>

                  {/* Trim proposals */}
                  {aiProposalType === 'trim' && (
                    !selectedClip || !selectedClipAsset || !composition ? (
                      <div style={{ padding: '8px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-tertiary-panel, #9A91A7)' }}>
                        Select a timeline clip to request an AI trim proposal.
                      </div>
                    ) : (
                      <TrimProposalPanel
                        projectName={activeProject?.name ?? 'Untitled'}
                        composition={composition}
                        clip={selectedClip}
                        asset={selectedClipAsset}
                        trimClip={trimClip}
                        createRevision={createRevision}
                      />
                    )
                  )}

                  {/* Reorder proposals */}
                  {aiProposalType === 'reorder' && (
                    !selectedClip || !composition ? (
                      <div style={{ padding: '8px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-tertiary-panel, #9A91A7)' }}>
                        Select a timeline clip to request an AI reorder proposal.
                      </div>
                    ) : (
                      <ReorderProposalPanel
                        projectName={activeProject?.name ?? 'Untitled'}
                        composition={composition}
                        clip={selectedClip}
                        reorderClips={reorderClips}
                        createRevision={createRevision}
                       />
                      )
                    )}

                    {/* Delete proposals */}
                    {aiProposalType === 'delete' && (
                       !selectedClip || !composition ? (
                        <div style={{ padding: '8px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-tertiary-panel, #9A91A7)' }}>
                        Select a timeline clip to request an AI delete proposal.
                        </div>
                      ) : (
                        <DeleteProposalPanel
                          projectName={activeProject?.name ?? 'Untitled'}
                          composition={composition}
                          clip={selectedClip}
                          asset={selectedClipAsset}
                          removeClip={removeClip}
                          createRevision={createRevision}
                        />
                      )
                    )}

                    {/* Insert proposals — no clip selection required */}
                    {aiProposalType === 'insert' && (
                      !composition || !addClip ? (
                        <div style={{ padding: '8px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-tertiary-panel, #9A91A7)' }}>
                          Open a project with a composition to request an AI insert proposal.
                        </div>
                      ) : (
                        <InsertProposalPanel
                          projectName={activeProject?.name ?? 'Untitled'}
                          composition={composition}
                          assets={assets}
                          addClip={addClip}
                          createRevision={createRevision}
                        />
                      )
                    )}

                    {/* Replace proposals */}
                    {aiProposalType === 'replace' && (
                      !selectedClip || !composition ? (
                        <div style={{ padding: '8px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-tertiary-panel, #9A91A7)' }}>
                          Select a timeline clip to request an AI replace proposal.
                        </div>
                      ) : (
                        <ReplaceProposalPanel
                          projectName={activeProject?.name ?? 'Untitled'}
                          composition={composition}
                          clip={selectedClip}
                          selectedClipAsset={selectedClipAsset}
                          assets={assets}
                          replaceClip={replaceClip}
                          createRevision={createRevision}
                        />
                      )
                    )}

                    {/* Edit Plan / Assembly proposals — no clip selection required */}
                    {aiProposalType === 'plan' && (
                      !composition ? (
                        <div style={{ padding: '8px', backgroundColor: 'var(--bg-app, #19161F)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-tertiary-panel, #9A91A7)' }}>
                          Open a project with a composition to request an AI edit plan.
                        </div>
                      ) : (
                        <EditPlanProposalPanel
                          projectName={activeProject?.name ?? 'Untitled'}
                          composition={composition}
                          assets={assets}
                          trimClip={trimClip}
                          reorderClips={reorderClips}
                          removeClip={removeClip}
                          addClip={addClip}
                          replaceClip={replaceClip}
                          createRevision={createRevision}
                          getCurrentComposition={() => composition}
                        />
                      )
                    )}
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
              onClick={() => void splitAtPlayhead()}
              disabled={!selectedClipId}
              title="Split selected clip at playhead (Shortcut: S)"
            >
              Split (S)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<TrimIcon size={14} />}
              onClick={() => selectedClip && void trimToPlayhead(selectedClip, true)}
              disabled={!selectedClip}
              title="Trim In-point to playhead (Shortcut: [)"
            >
              Trim In ([)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<TrimIcon size={14} />}
              onClick={() => selectedClip && void trimToPlayhead(selectedClip, false)}
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
              onClick={() => void moveSelectedClip('left')}
              disabled={!canMoveLeft}
              title={selectedTrackIsContiguous ? 'Reorder clip earlier' : 'Reorder requires a contiguous track'}
            >
              Move Left
            </Button>
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<ArrowUpDownIcon size={14} />}
              onClick={() => void moveSelectedClip('right')}
              disabled={!canMoveRight}
              title={selectedTrackIsContiguous ? 'Reorder clip later' : 'Reorder requires a contiguous track'}
            >
              Move Right
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
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary-panel, #9A91A7)' }}>
              Keyboard: S = Split | [ / ] = Trim | Del = Remove
            </div>
          </div>
        </div>
        {timelineError && (
          <div role="alert" style={{ padding: '6px 12px', color: 'var(--destructive, #E06C75)', fontSize: '12px', borderBottom: '1px solid var(--border-subtle, #362F40)' }}>
            {timelineError}
          </div>
        )}

        {/* Explicit source-range insertion; native receives exact string ticks. */}
        <div
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-subtle, #362F40)',
            backgroundColor: 'var(--bg-panel, #221E29)',
            display: 'grid',
            gridTemplateColumns: '1.4fr 1fr 1fr 1.2fr auto',
            gap: '8px',
            alignItems: 'end',
          }}
        >
          <Select
            label="Source Asset"
            value={sourceAssetId}
            onChange={(e) => setSourceAssetId(e.target.value)}
            options={[
              { value: '', label: assets.length ? 'Choose imported asset' : 'No imported assets' },
              ...assets.map((asset) => ({ value: asset.id, label: asset.name })),
            ]}
          />
          <Input
            label="Source In (ticks)"
            value={sourceInTicks}
            onChange={(e) => setSourceInTicks(e.target.value)}
            inputMode="numeric"
          />
          <Input
            label="Source Out (ticks)"
            value={sourceOutTicks}
            onChange={(e) => setSourceOutTicks(e.target.value)}
            inputMode="numeric"
          />
          <Select
            label="Destination Track"
            value={sourceTrackId}
            onChange={(e) => setSourceTrackId(e.target.value)}
            options={[
              { value: '', label: sourceTracks.length ? 'Choose video track' : 'Native creates Primary Video track' },
              ...sourceTracks.map((track) => ({ value: track.id, label: track.label })),
            ]}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleAddSourceRange()}
            disabled={!sourceAssetId || !assets.length || (sourceTracks.length > 0 && !sourceTrackId)}
          >
            Add Range
          </Button>
          {selectedSourceAsset && (
            <span style={{ gridColumn: '1 / -1', fontSize: '11px', color: 'var(--text-tertiary-panel, #9A91A7)' }}>
              Asset timebase: {selectedSourceAsset.timeBase.num}/{selectedSourceAsset.timeBase.den}; composition timebase: {composition?.timeBase.num}/{composition?.timeBase.den}. Native validates and converts the boundary.
            </span>
          )}
          {addRangeError && (
            <span role="alert" style={{ gridColumn: '1 / -1', fontSize: '12px', color: 'var(--destructive, #E06C75)' }}>
              {addRangeError}
            </span>
          )}
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
                  data-testid="timeline-lane"
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
      <AIGeneratorPanel
        isOpen={showAiGenModal}
        onClose={() => setShowAiGenModal(false)}
        onImportGeneratedAsset={async (genAsset) => {
          if (!activeProject) return;
          const newAssetId = `asset-gen-${Date.now()}`;
          const newAsset = {
            id: newAssetId,
            projectId: activeProject.id,
            name: genAsset.name || 'AI Generated Asset',
            path: `/generated/${genAsset.name}`,
            sizeBytes: 10_000_000,
            durationTicks: genAsset.durationTicks || '240000',
            timeBase: genAsset.timeBase || { num: 1, den: 24000 },
            width: genAsset.width || 3840,
            height: genAsset.height || 2160,
            fpsNumerator: 24,
            fpsDenominator: 1,
            format: genAsset.format || 'MP4',
            codec: genAsset.codec || 'H.264',
            audioChannels: 2,
            importType: 'managed' as const,
            proxyStatus: 'ready' as const,
          };
          if (composition) {
            await addClip({
              assetId: newAssetId,
              sourceInTicks: '0',
              sourceOutTicks: newAsset.durationTicks,
            });
          }
        }}
      />
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

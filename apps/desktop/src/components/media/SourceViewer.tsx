import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Card, Badge, PlayIcon, PauseIcon, PlusIcon } from '@cutroom/ui';
import { Asset, RationalTimeBase } from '../../lib/contracts';
import { formatRationalTimecode, ticksPerFrame, TIMEBASE_24000 } from '../../lib/timecode';

export interface SourceViewerProps {
  asset: Asset;
  onAddRange?: (inTicks: string, outTicks: string) => Promise<void> | void;
  compositionTimeBase?: RationalTimeBase;
  aspectRatio?: string;
}

/**
 * SourceViewer
 *
 * A source/preview stage around a REAL imported media asset. Transport, scrubbing,
 * in/out marking and range export all operate on the canonical rational tick model
 * (one representation, never a second clock). Frame boundaries come from
 * ticksPerFrame(timeBase, fps); the scrubber, in-point and out-point all snap to
 * those exact frame ticks so 0 <= in < out <= duration always holds.
 */
export const SourceViewer: React.FC<SourceViewerProps> = ({
  asset,
  onAddRange,
  compositionTimeBase: _compositionTimeBase = TIMEBASE_24000,
  aspectRatio = '16:9',
}) => {
  const assetDuration = useMemo(
    () => BigInt(asset.durationTicks || '0'),
    [asset.durationTicks],
  );
  const assetFps = useMemo(
    () => ({ num: BigInt(asset.fpsNumerator || 24), den: BigInt(asset.fpsDenominator || 1) }),
    [asset.fpsNumerator, asset.fpsDenominator],
  );
  const frameTicks = useMemo(() => {
    try {
      return ticksPerFrame(asset.timeBase, assetFps);
    } catch {
      return 1n;
    }
  }, [asset.timeBase, assetFps]);

  // Current playhead, In point, and Out point in source asset ticks.
  const [playheadTicks, setPlayheadTicks] = useState<string>('0');
  const [inTicks, setInTicks] = useState<string>('0');
  const [outTicks, setOutTicks] = useState<string>(asset.durationTicks || '0');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<'ok' | 'error' | 'info'>('info');

  const flash = useCallback((msg: string, tone: 'ok' | 'error' | 'info' = 'info') => {
    setFeedbackMessage(msg);
    setFeedbackTone(tone);
    const id = setTimeout(() => {
      setFeedbackMessage((current) => (current === msg ? null : current));
    }, 2600);
    return id;
  }, []);

  // Reset all transport/range state when the selected asset changes.
  useEffect(() => {
    setPlayheadTicks('0');
    setInTicks('0');
    setOutTicks(asset.durationTicks || '0');
    setIsPlaying(false);
    setFeedbackMessage(null);
  }, [asset.id, asset.durationTicks]);

  const clampTicks = useCallback(
    (ticks: bigint): bigint => {
      if (ticks < 0n) return 0n;
      if (ticks > assetDuration) return assetDuration;
      return ticks;
    },
    [assetDuration],
  );

  const snapToFrame = useCallback(
    (ticks: bigint): bigint => {
      if (frameTicks <= 1n) return clampTicks(ticks);
      const remainder = ticks % frameTicks;
      return clampTicks(ticks - remainder);
    },
    [frameTicks, clampTicks],
  );

  // Simulated frame-by-frame transport playback for source scrubbing.
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setPlayheadTicks((current) => {
        const next = BigInt(current) + frameTicks;
        if (next >= assetDuration) {
          setIsPlaying(false);
          return '0';
        }
        return next.toString();
      });
    }, 1000 / Number(assetFps.num / assetFps.den || 24));
    return () => clearInterval(interval);
  }, [isPlaying, frameTicks, assetDuration, assetFps]);

  const setPlayhead = useCallback(
    (value: bigint) => setPlayheadTicks(snapToFrame(value).toString()),
    [snapToFrame],
  );

  const handleMarkIn = useCallback(() => {
    const current = snapToFrame(BigInt(playheadTicks));
    const currentOut = BigInt(outTicks);
    if (current >= currentOut) {
      flash('Mark In must precede Mark Out.', 'error');
      return;
    }
    setInTicks(current.toString());
    flash(`In set to ${formatRationalTimecode(current, asset.timeBase, assetFps)}`, 'ok');
  }, [playheadTicks, outTicks, snapToFrame, asset.timeBase, assetFps, flash]);

  const handleMarkOut = useCallback(() => {
    const current = snapToFrame(BigInt(playheadTicks));
    const currentIn = BigInt(inTicks);
    if (current <= currentIn) {
      flash('Mark Out must follow Mark In.', 'error');
      return;
    }
    setOutTicks(current.toString());
    flash(`Out set to ${formatRationalTimecode(current, asset.timeBase, assetFps)}`, 'ok');
  }, [playheadTicks, inTicks, snapToFrame, asset.timeBase, assetFps, flash]);

  const handleResetRange = useCallback(() => {
    setInTicks('0');
    setOutTicks(asset.durationTicks || '0');
    flash('Range reset to full asset.', 'info');
  }, [asset.durationTicks, flash]);

  const stepFrame = useCallback(
    (deltaFrames: number) => {
      setPlayhead(BigInt(playheadTicks) + BigInt(deltaFrames) * frameTicks);
    },
    [playheadTicks, frameTicks, setPlayhead],
  );

  const jumpToIn = useCallback(() => setPlayhead(BigInt(inTicks)), [inTicks, setPlayhead]);
  const jumpToOut = useCallback(() => setPlayhead(BigInt(outTicks)), [outTicks, setPlayhead]);

  const togglePlay = useCallback(() => setIsPlaying((p) => !p), []);

  const handleAddRangeToTimeline = useCallback(async () => {
    if (!onAddRange) return;
    if (BigInt(inTicks) >= BigInt(outTicks)) {
      flash('Set a valid In/Out range first.', 'error');
      return;
    }
    setIsAdding(true);
    setFeedbackMessage(null);
    try {
      await onAddRange(inTicks, outTicks);
      setFeedbackMessage('Added source range to timeline');
      setFeedbackTone('ok');
      setTimeout(() => {
        setFeedbackMessage((current) =>
          current === 'Added source range to timeline' ? null : current,
        );
      }, 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedbackMessage(`Failed to add range: ${msg}`);
      setFeedbackTone('error');
    } finally {
      setIsAdding(false);
    }
  }, [onAddRange, inTicks, outTicks, flash]);

  // Keyboard transport. Active slider owns native arrow behavior, so only fire
  // global shortcuts when the slider itself is NOT the focused element.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      const onSlider = target.tagName === 'INPUT';
      const key = event.key.toLowerCase();
      if (key === 'i') {
        event.preventDefault();
        handleMarkIn();
      } else if (key === 'o') {
        event.preventDefault();
        handleMarkOut();
      } else if (key === ' ' || key === 'spacebar') {
        event.preventDefault();
        togglePlay();
      } else if (key === 'home') {
        event.preventDefault();
        jumpToIn();
      } else if (key === 'end') {
        event.preventDefault();
        jumpToOut();
      } else if ((key === 'arrowleft' || key === 'arrowright') && !onSlider) {
        event.preventDefault();
        stepFrame(event.key === 'ArrowLeft' ? -1 : 1);
      }
    },
    [handleMarkIn, handleMarkOut, togglePlay, jumpToIn, jumpToOut, stepFrame],
  );

  const rangeDurationTicks = BigInt(outTicks) - BigInt(inTicks);
  const safeDuration = assetDuration > 0n ? assetDuration : 1n;
  const toPercent = (ticks: string | bigint) =>
    Number((BigInt(ticks) * 10000n) / safeDuration) / 100;
  const playheadPercent = toPercent(playheadTicks);
  const inPercent = toPercent(inTicks);
  const outPercent = toPercent(outTicks);

  const frameCount =
    frameTicks > 0n ? BigInt(playheadTicks) / frameTicks : 0n;

  return (
    <Card
      padding="md"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="group"
      aria-label="Source viewer"
      style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
    >
      {/* Viewer Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary, #F3F0F6)' }}>
            {asset.name}
          </span>
          <Badge variant="neutral">
            {asset.codec.toUpperCase()} • {asset.width}×{asset.height}
          </Badge>
          <Badge variant={asset.importType === 'managed' ? 'violet' : 'neutral'}>
            {asset.importType.toUpperCase()}
          </Badge>
        </div>
        <div className="font-mono" style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>
          Total: {formatRationalTimecode(asset.durationTicks, asset.timeBase, assetFps)}
        </div>
      </div>

      {/* Media Canvas Viewport */}
      <div
        style={{
          backgroundColor: '#0E0C12',
          borderRadius: '6px',
          border: '1px solid var(--border-default, #443B4F)',
          height: aspectRatio === '9:16' ? '280px' : '200px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', textAlign: 'center', zIndex: 2 }}>
          <span className="font-mono" style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary, #F3F0F6)' }}>
            {formatRationalTimecode(playheadTicks, asset.timeBase, assetFps)}
          </span>
          <span style={{ fontSize: '11px', color: 'var(--text-tertiary-panel, #9A91A7)' }}>
            Frame {String(frameCount)} • Tick {playheadTicks}
          </span>
        </div>

        {/* Safe Area Guides */}
        <div
          style={{
            position: 'absolute',
            inset: '10%',
            border: '1px dashed rgba(255, 255, 255, 0.08)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      </div>

      {/* Scrub & In/Out Bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <input
          type="range"
          aria-label="Scrub source playhead"
          min={0}
          max={Number(safeDuration)}
          step={Number(frameTicks)}
          value={Number(playheadTicks)}
          onChange={(e) => setPlayhead(BigInt(e.target.value))}
          style={{
            width: '100%',
            accentColor: 'var(--accent-violet, #A18AF7)',
            height: '4px',
            cursor: 'pointer',
          }}
        />

        {/* Selected-window ruler under the scrubber */}
        <div
          style={{
            position: 'relative',
            height: '16px',
            backgroundColor: 'var(--bg-app, #19161F)',
            borderRadius: '4px',
            border: '1px solid var(--border-subtle, #362F40)',
            overflow: 'hidden',
          }}
          aria-hidden="true"
        >
          <div
            style={{
              position: 'absolute',
              left: `${inPercent}%`,
              width: `${Math.max(0, outPercent - inPercent)}%`,
              top: 0,
              bottom: 0,
              backgroundColor: 'rgba(161, 138, 247, 0.28)',
              borderLeft: '2px solid var(--accent-violet, #A18AF7)',
              borderRight: '2px solid var(--accent-violet, #A18AF7)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: `calc(${playheadPercent}% - 1px)`,
              top: 0,
              bottom: 0,
              width: '2px',
              backgroundColor: '#FFFFFF',
              boxShadow: '0 0 4px rgba(255,255,255,0.8)',
            }}
          />
        </div>

        {/* Range Timecode Display */}
        <div
          style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11px', color: 'var(--text-secondary, #BAB3C5)' }}
          className="font-mono"
        >
          <span>In {formatRationalTimecode(inTicks, asset.timeBase, assetFps)}</span>
          <span style={{ color: 'var(--accent-violet, #A18AF7)' }}>
            {formatRationalTimecode(rangeDurationTicks.toString(), asset.timeBase, assetFps)} • {String(rangeDurationTicks)} ticks
          </span>
          <span>Out {formatRationalTimecode(outTicks, asset.timeBase, assetFps)}</span>
        </div>
      </div>

      {/* Control Transport Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', paddingTop: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <Button
            size="sm"
            variant="secondary"
            onClick={togglePlay}
            leftIcon={isPlaying ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
            title={isPlaying ? 'Pause (Space)' : 'Play preview (Space)'}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => stepFrame(-1)} title="Step back one frame (←)">
            Step Back
          </Button>
          <Button size="sm" variant="ghost" onClick={() => stepFrame(1)} title="Step forward one frame (→)">
            Step Fwd
          </Button>
          <Button size="sm" variant="ghost" onClick={handleMarkIn} title="Set In-point at playhead (I)">
            Mark In
          </Button>
          <Button size="sm" variant="ghost" onClick={handleMarkOut} title="Set Out-point at playhead (O)">
            Mark Out
          </Button>
          <Button size="sm" variant="ghost" onClick={handleResetRange} title="Clear In/Out back to full asset">
            Reset Range
          </Button>
        </div>

        {onAddRange && (
          <Button
            size="sm"
            variant="primary"
            leftIcon={<PlusIcon size={13} />}
            onClick={() => void handleAddRangeToTimeline()}
            isLoading={isAdding}
            title="Send the selected In/Out range to the timeline"
          >
            Add Range to Timeline
          </Button>
        )}
      </div>

      {feedbackMessage && (
        <div
          role="alert"
          style={{
            fontSize: '12px',
            color:
              feedbackTone === 'ok'
                ? 'var(--accent-green, #98C379)'
                : feedbackTone === 'error'
                  ? 'var(--destructive, #E06C75)'
                  : 'var(--text-secondary, #BAB3C5)',
            marginTop: '2px',
          }}
        >
          {feedbackMessage}
        </div>
      )}

      <div style={{ fontSize: '10px', color: 'var(--text-tertiary-panel, #9A91A7)', opacity: 0.85 }}>
        Shortcuts: [I] In • [O] Out • [Space] Play/Pause • [←][→] Step frame • [Home] Jump to In • [End] Jump to Out
      </div>
    </Card>
  );
};

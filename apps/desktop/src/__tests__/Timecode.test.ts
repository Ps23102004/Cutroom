import { describe, it, expect } from 'vitest';
import {
  formatRationalTimecode,
  ticksToFrames,
  mapTimelineToSourceTicks,
  validateTimeBase,
  STANDARD_FPS,
  TIMEBASE_24000,
} from '../lib/timecode';

describe('Rational Timecode Engine', () => {
  it('formats exact 24fps timecodes without rounding error', () => {
    // 24000 ticks @ timebase 1/24000 = 1 second = 24 frames @ 24fps
    expect(formatRationalTimecode('0', TIMEBASE_24000, STANDARD_FPS.FPS_24)).toBe('00:00:00:00');
    expect(formatRationalTimecode('24000', TIMEBASE_24000, STANDARD_FPS.FPS_24)).toBe('00:00:01:00');
    expect(formatRationalTimecode('1000', TIMEBASE_24000, STANDARD_FPS.FPS_24)).toBe('00:00:00:01');
    expect(formatRationalTimecode('1440000', TIMEBASE_24000, STANDARD_FPS.FPS_24)).toBe('00:01:00:00'); // 1 minute
  });

  it('formats 30fps and 60fps correctly', () => {
    // 24000 ticks = 1 second = 30 frames @ 30fps
    expect(formatRationalTimecode('24000', TIMEBASE_24000, STANDARD_FPS.FPS_30)).toBe('00:00:01:00');
    // 24000 ticks = 1 second = 60 frames @ 60fps
    expect(formatRationalTimecode('24000', TIMEBASE_24000, STANDARD_FPS.FPS_60)).toBe('00:00:01:00');
  });

  it('formats NTSC 29.97fps (30000/1001) accurately', () => {
    // 30000:1001 frame rate
    const frames = ticksToFrames('24000', TIMEBASE_24000, STANDARD_FPS.FPS_29_97);
    expect(frames).toBe(29n); // ~29.97 frames in 1s
    const tc = formatRationalTimecode('24000', TIMEBASE_24000, STANDARD_FPS.FPS_29_97);
    expect(tc).toBe('00:00:00:29');
  });

  it('handles arbitrary-precision large tick strings without precision loss', () => {
    // 10 hours @ 24000 ticks/sec = 10 * 3600 * 24000 = 864,000,000 ticks
    const largeTicks = '864000000';
    expect(formatRationalTimecode(largeTicks, TIMEBASE_24000, STANDARD_FPS.FPS_24)).toBe('10:00:00:00');
  });

  it('correctly maps timeline position to source asset in-point offset', () => {
    // Clip starts at timeline tick 7200, source starts at in-point tick 2400
    // Playhead is at timeline tick 9600 (delta = 2400)
    // Source offset should be 2400 + 2400 = 4800
    const sourceOffset = mapTimelineToSourceTicks('9600', '7200', '2400');
    expect(sourceOffset).toBe(4800n);
  });

  it('strictly rejects zero or negative denominators with an explicit Error', () => {
    // Zero denominator in timeBase
    expect(() => ticksToFrames('24000', { num: 1n, den: 0n }, STANDARD_FPS.FPS_24)).toThrow(
      /denominator must be a positive non-zero integer/
    );

    // Negative denominator in timeBase
    expect(() => ticksToFrames('24000', { num: 1n, den: -24000n }, STANDARD_FPS.FPS_24)).toThrow(
      /denominator must be a positive non-zero integer/
    );

    // Zero denominator in frameRate
    expect(() => ticksToFrames('24000', TIMEBASE_24000, { num: 24n, den: 0n })).toThrow(
      /denominator must be a positive non-zero integer/
    );

    // Zero or negative numerator
    expect(() => ticksToFrames('24000', { num: 0n, den: 24000n }, STANDARD_FPS.FPS_24)).toThrow(
      /numerator must be a positive non-zero integer/
    );
  });

  it('formats standard SMPTE Non-Drop Frame (NDF) with colon delimiters', () => {
    const tc = formatRationalTimecode('48000', TIMEBASE_24000, STANDARD_FPS.FPS_24);
    expect(tc).toBe('00:00:02:00');
    // Verify standard colon separators across HH:MM:SS:FF (NDF format, not semicolon drop-frame)
    expect(tc.split(':').length).toBe(4);
    expect(tc).not.toContain(';');
  });

  it('supports cross-timebase rational conversion in source mapping', () => {
    // Composition clock: 24000 ticks/sec ({ num: 1n, den: 24000n })
    // Source asset clock: 48000 ticks/sec ({ num: 1n, den: 48000n })
    // Playhead delta = 2400 comp ticks = 0.1 sec
    // 0.1 sec in source clock = 4800 source ticks
    // Source in-point = 10000 source ticks -> Result should be 10000 + 4800 = 14800 source ticks
    const compTimeBase = { num: 1n, den: 24000n };
    const sourceTimeBase = { num: 1n, den: 48000n };
    const mapped = mapTimelineToSourceTicks('9600', '7200', '10000', compTimeBase, sourceTimeBase);
    expect(mapped).toBe(14800n);
  });

  it('forbids invalid time-base inputs and accepts valid canonical rational numbers', () => {
    // Valid canonical number input
    expect(formatRationalTimecode('24000', { num: 1, den: 24000 }, STANDARD_FPS.FPS_24)).toBe('00:00:01:00');

    // Reject non-integer numerator or denominator
    expect(() => ticksToFrames('24000', { num: 1.5, den: 24000 })).toThrow(/must be a positive integer/);
    expect(() => ticksToFrames('24000', { num: 1, den: 24000.5 })).toThrow(/must be a positive integer/);

    // Reject zero or negative number properties
    expect(() => ticksToFrames('24000', { num: 0, den: 24000 })).toThrow();
    expect(() => ticksToFrames('24000', { num: 1, den: 0 })).toThrow();
    expect(() => ticksToFrames('24000', { num: -1, den: 24000 })).toThrow();
    expect(() => ticksToFrames('24000', { num: 1, den: -24000 })).toThrow();

    // Reject non-object or null timebase
    expect(() => validateTimeBase(null as unknown as { num: number; den: number })).toThrow(/must be an object/);
    expect(() => validateTimeBase(undefined as unknown as { num: number; den: number })).toThrow(/must be an object/);
  });
});

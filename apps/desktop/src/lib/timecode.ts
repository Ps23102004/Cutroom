/**
 * Cutroom Rational Timecode Engine
 * 
 * Strict arbitrary-precision rational integer arithmetic via BigInt.
 * Prevents precision loss on long recordings and non-integer frame rates.
 */

export interface Rational {
  num: bigint;
  den: bigint;
}

export type TimeBaseInput = Rational | { num: number; den: number };

export const TIMEBASE_24000: Rational = { num: 1n, den: 24000n };

export const STANDARD_FPS = {
  FPS_24: { num: 24n, den: 1n },
  FPS_25: { num: 25n, den: 1n },
  FPS_30: { num: 30n, den: 1n },
  FPS_29_97: { num: 30000n, den: 1001n },
  FPS_23_976: { num: 24000n, den: 1001n },
  FPS_60: { num: 60n, den: 1n },
  FPS_59_94: { num: 60000n, den: 1001n },
} as const;

/**
 * Validates that a rational fraction has strictly positive non-zero numerator and denominator.
 * Throws an Error if invalid or negative to prevent silent math errors or division by zero.
 */
export function validateRational(r: Rational, label: string = 'Rational'): void {
  if (typeof r.den !== 'bigint' || r.den <= 0n) {
    throw new Error(`${label} denominator must be a positive non-zero integer, received: ${String(r?.den)}`);
  }
  if (typeof r.num !== 'bigint' || r.num <= 0n) {
    throw new Error(`${label} numerator must be a positive non-zero integer, received: ${String(r?.num)}`);
  }
}

/**
 * Normalizes and strictly validates any rational time-base input (number or bigint).
 * Forbids non-integers, floats, negative values, zeroes, NaN, and missing properties.
 */
export function toRational(input: TimeBaseInput, label: string = 'Timebase'): Rational {
  if (!input || typeof input !== 'object') {
    throw new Error(`${label} must be an object with positive integer num and den properties`);
  }
  if ('num' in input && typeof input.num === 'number') {
    if (!Number.isFinite(input.num) || !Number.isInteger(input.num) || input.num <= 0) {
      throw new Error(`${label} numerator must be a positive integer, received: ${input.num}`);
    }
  }
  if ('den' in input && typeof input.den === 'number') {
    if (!Number.isFinite(input.den) || !Number.isInteger(input.den) || input.den <= 0) {
      throw new Error(`${label} denominator must be a positive integer, received: ${input.den}`);
    }
  }
  const r: Rational = {
    num: typeof input.num === 'bigint' ? input.num : BigInt(input.num),
    den: typeof input.den === 'bigint' ? input.den : BigInt(input.den),
  };
  validateRational(r, label);
  return r;
}

/**
 * Forbids invalid time-base inputs, throwing an explicit Error if invalid.
 */
export function validateTimeBase(timeBase: TimeBaseInput, label: string = 'Timebase'): void {
  toRational(timeBase, label);
}

/**
 * Converts integer ticks string or BigInt to frame number:
 * frames = (ticks * frameRate.num * timeBase.num) / (frameRate.den * timeBase.den)
 * Rejects invalid/negative denominators with an explicit Error.
 */
export function ticksToFrames(
  ticks: string | bigint,
  timeBase: TimeBaseInput = TIMEBASE_24000,
  frameRate: Rational = STANDARD_FPS.FPS_24
): bigint {
  const tb = toRational(timeBase, 'Timebase');
  validateRational(frameRate, 'FrameRate');

  const t = typeof ticks === 'bigint' ? ticks : BigInt(ticks.trim() || '0');
  const numerator = t * frameRate.num * tb.num;
  const denominator = frameRate.den * tb.den;
  return numerator / denominator;
}

/**
 * Converts frame count to SMPTE Non-Drop Frame (NDF) timecode (HH:MM:SS:FF).
 * 
 * Non-Drop Frame (NDF) notation strictly uses colon ':' delimiters between all fields:
 *   HH:MM:SS:FF
 * Drop-Frame (DF) notation (which uses ';' or '.' delimiters to compensate for 29.97/59.94 drift)
 * is explicitly distinguished; this engine outputs standard NDF SMPTE timecode.
 */
export function framesToTimecode(
  frames: bigint,
  frameRate: Rational = STANDARD_FPS.FPS_24
): string {
  validateRational(frameRate, 'FrameRate');
  if (frames < 0n) frames = 0n;

  // Nominal integer fps for modulo frames
  const nominalFps = (frameRate.num + frameRate.den / 2n) / frameRate.den;
  const fps = nominalFps > 0n ? nominalFps : 24n;

  const ff = frames % fps;
  const totalSeconds = frames / fps;
  const ss = totalSeconds % 60n;
  const totalMinutes = totalSeconds / 60n;
  const mm = totalMinutes % 60n;
  const hh = totalMinutes / 60n;

  const pad = (n: bigint) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

/**
 * Formats a rational tick value directly to Non-Drop Frame (NDF) timecode.
 */
export function formatRationalTimecode(
  ticks: string | bigint,
  timeBase: TimeBaseInput = TIMEBASE_24000,
  frameRate: Rational = STANDARD_FPS.FPS_24
): string {
  const frames = ticksToFrames(ticks, timeBase, frameRate);
  return framesToTimecode(frames, frameRate);
}

/**
 * Maps a timeline playhead position into source asset in-point ticks.
 * Supports cross-timebase rational conversion when composition timebase
 * and source asset timebase differ:
 *   deltaComp = playheadTicks - timelineStartTicks
 *   deltaSource = (deltaComp * compTimeBase.num * sourceTimeBase.den) / (compTimeBase.den * sourceTimeBase.num)
 *   sourceOffset = sourceInTicks + deltaSource
 */
export function mapTimelineToSourceTicks(
  playheadTicks: string | bigint,
  timelineStartTicks: string | bigint,
  sourceInTicks: string | bigint,
  compTimeBase: TimeBaseInput = TIMEBASE_24000,
  sourceTimeBase: TimeBaseInput = TIMEBASE_24000
): bigint {
  const ctb = toRational(compTimeBase, 'Composition Timebase');
  const stb = toRational(sourceTimeBase, 'Source Asset Timebase');

  const playhead = typeof playheadTicks === 'bigint' ? playheadTicks : BigInt(playheadTicks);
  const start = typeof timelineStartTicks === 'bigint' ? timelineStartTicks : BigInt(timelineStartTicks);
  const srcIn = typeof sourceInTicks === 'bigint' ? sourceInTicks : BigInt(sourceInTicks);

  const delta = playhead - start;
  if (delta <= 0n) return srcIn;

  // Cross-timebase rational conversion
  const convertedDelta = (delta * ctb.num * stb.den) / (ctb.den * stb.num);
  return srcIn + convertedDelta;
}

/**
 * Strict BigInt rational tick delta and arithmetic functions.
 * Ensures no Number or parseFloat conversions are performed in timeline calculations.
 */
export function computeTickDelta(endTicks: string | bigint, startTicks: string | bigint): bigint {
  const end = typeof endTicks === 'bigint' ? endTicks : BigInt(endTicks);
  const start = typeof startTicks === 'bigint' ? startTicks : BigInt(startTicks);
  const diff = end - start;
  return diff < 0n ? 0n : diff;
}

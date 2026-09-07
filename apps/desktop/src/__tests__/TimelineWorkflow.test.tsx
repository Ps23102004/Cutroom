import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AppProvider, useApp } from '../context/AppContext';

describe('Timeline Workflows & Integer Ticks', () => {
  it('loads explicit fixture composition on opt-in', () => {
    const { result } = renderHook(() => useApp(), {
      wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
    });

    // Initially null (no fake data)
    expect(result.current.composition).toBeNull();

    // Opt into fixtures
    act(() => {
      result.current.enableFixtureMode();
    });

    expect(result.current.composition).not.toBeNull();
    expect(result.current.composition?.clips.length).toBe(3);
    expect(result.current.composition?.durationTicks).toBe('36000');
  });

  it('splits clip accurately into two clips at exact tick mark', () => {
    const { result } = renderHook(() => useApp(), {
      wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
    });

    act(() => {
      result.current.enableFixtureMode();
    });

    // Target clip-01: timelineStartTicks 0, timelineDurationTicks 7200, inTicks 0, outTicks 7200
    // Split at tick 3600
    act(() => {
      result.current.splitClip('clip-01', '3600');
    });

    const clips = result.current.composition?.clips || [];
    expect(clips.length).toBe(4); // 3 - 1 + 2

    const clipA = clips.find((c) => c.id === 'clip-01-a');
    const clipB = clips.find((c) => c.id === 'clip-01-b');

    expect(clipA).toBeDefined();
    expect(clipB).toBeDefined();

    expect(clipA?.timelineStartTicks).toBe('0');
    expect(clipA?.timelineDurationTicks).toBe('3600');
    expect(clipA?.outTicks).toBe('3600');

    expect(clipB?.timelineStartTicks).toBe('3600');
    expect(clipB?.timelineDurationTicks).toBe('3600');
    expect(clipB?.inTicks).toBe('3600');
  });

  it('trims clip in-point and out-point with rational ticks', () => {
    const { result } = renderHook(() => useApp(), {
      wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
    });

    act(() => {
      result.current.enableFixtureMode();
    });

    // Trim clip-02: start at 12000 ticks, end at 20000 ticks -> duration = 8000 ticks
    act(() => {
      result.current.trimClip('clip-02', '12000', '20000');
    });

    const target = result.current.composition?.clips.find((c) => c.id === 'clip-02');
    expect(target?.inTicks).toBe('12000');
    expect(target?.outTicks).toBe('20000');
    expect(target?.timelineDurationTicks).toBe('8000');
  });

  it('reorders and removes clips without mutating references', () => {
    const { result } = renderHook(() => useApp(), {
      wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
    });

    act(() => {
      result.current.enableFixtureMode();
    });

    // Remove clip-03
    act(() => {
      result.current.removeClip('clip-03');
    });

    const remaining = result.current.composition?.clips || [];
    expect(remaining.length).toBe(2);
    expect(remaining.some((c) => c.id === 'clip-03')).toBe(false);
  });
});

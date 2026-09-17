import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ColorInspectorPanel } from '../components/ColorInspectorPanel';
import type { Clip, ClipColor } from '../lib/contracts';

const clip: Clip = {
  id: 'clip-1',
  trackId: 'track-1',
  assetId: 'asset-1',
  name: 'Take 1',
  inTicks: '0',
  outTicks: '48000',
  timelineStartTicks: '0',
  timelineDurationTicks: '48000',
};

function clearTauri() {
  delete (window as unknown as Record<string, unknown>).__TAURI__;
}

afterEach(() => {
  clearTauri();
  vi.restoreAllMocks();
});

describe('ColorInspector: per-clip color grade tab', () => {
  it('renders the five grade sliders, color space select, and LUT controls', () => {
    clearTauri();
    render(
      <ColorInspectorPanel clip={clip} projectId="project-a" updateClipColor={async () => {}} />
    );

    expect(screen.getByLabelText('Input color space')).toBeDefined();
    expect(screen.getByLabelText('Exposure')).toBeDefined();
    expect(screen.getByLabelText('Contrast')).toBeDefined();
    expect(screen.getByLabelText('Saturation')).toBeDefined();
    expect(screen.getByLabelText('White balance temperature')).toBeDefined();
    expect(screen.getByLabelText('White balance tint')).toBeDefined();
    expect(screen.getByRole('button', { name: /Apply grade to clip/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Reset/i })).toBeDefined();
    // Browser preview mode: LUT picking is honestly unavailable, not faked.
    const pickButton = screen.getByRole('button', { name: /Pick \.cube LUT/i }) as HTMLButtonElement;
    expect(pickButton.disabled).toBe(true);
    expect(
      screen.getByText(/LUT picking is unavailable in browser preview mode/i)
    ).toBeDefined();
  });

  it('sends the setColor-shaped payload through updateClipColor on apply', async () => {
    clearTauri();
    const updateClipColor = vi.fn(async (_clipId: string, _color: ClipColor) => {});
    render(
      <ColorInspectorPanel clip={clip} projectId="project-a" updateClipColor={updateClipColor} />
    );

    fireEvent.change(screen.getByLabelText('Exposure'), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText('Contrast'), { target: { value: '1.25' } });
    fireEvent.change(screen.getByLabelText('Input color space'), { target: { value: 's_log3' } });

    fireEvent.click(screen.getByRole('button', { name: /Apply grade to clip/i }));

    await waitFor(() => expect(updateClipColor).toHaveBeenCalledTimes(1));
    expect(updateClipColor).toHaveBeenCalledWith('clip-1', {
      inputColorSpace: 's_log3',
      grade: {
        exposureEv: 1.5,
        contrast: 1.25,
        saturation: 1,
        wbTemp: 0,
        wbTint: 0,
        lut: null,
      },
    });
    expect(screen.getByText(/Grade written to the composition/i)).toBeDefined();
  });

  it('displays dispatch validation errors instead of failing silently', async () => {
    clearTauri();
    const updateClipColor = vi.fn(async (_clipId: string, _color: ClipColor) => {
      throw new Error('color grade contrast must be within 0.1..=4');
    });
    render(
      <ColorInspectorPanel clip={clip} projectId="project-a" updateClipColor={updateClipColor} />
    );

    fireEvent.click(screen.getByRole('button', { name: /Apply grade to clip/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/Could not apply color grade: color grade contrast must be within 0\.1\.\.=4/i)
      ).toBeDefined()
    );
  });

  it('warns that V-Log and C-Log3 need a manufacturer LUT', () => {
    clearTauri();
    render(
      <ColorInspectorPanel clip={clip} projectId="project-a" updateClipColor={async () => {}} />
    );

    expect(screen.queryByText(/no built-in de-log LUT/i)).toBeNull();
    fireEvent.change(screen.getByLabelText('Input color space'), { target: { value: 'v_log' } });
    expect(screen.getByText(/no built-in de-log LUT/i)).toBeDefined();
    expect(screen.getByText(/Only S-Log3 ships with a built-in de-log/i)).toBeDefined();

    fireEvent.change(screen.getByLabelText('Input color space'), { target: { value: 'hlg_hdr' } });
    expect(screen.getByText(/HLG sources are tone-mapped to SDR/i)).toBeDefined();
  });

  it('picks a .cube LUT through the native dialog and attaches path + sha256', async () => {
    (window as unknown as Record<string, unknown>).__TAURI__ = {
      core: {
        invoke: async <T,>(_command: string, _args?: Record<string, unknown>): Promise<T> =>
          ({
            ok: true,
            data: { path: '/luts/arri_alexa.cube', sha256: 'abc123', size: 33, title: 'ARRI Alexa' },
          }) as unknown as T,
      },
    };
    const updateClipColor = vi.fn(async (_clipId: string, _color: ClipColor) => {});
    render(
      <ColorInspectorPanel clip={clip} projectId="project-a" updateClipColor={updateClipColor} />
    );

    const pickButton = screen.getByRole('button', { name: /Pick \.cube LUT/i }) as HTMLButtonElement;
    expect(pickButton.disabled).toBe(false);
    fireEvent.click(pickButton);

    await waitFor(() => expect(screen.getByText('arri_alexa.cube')).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /Apply grade to clip/i }));
    await waitFor(() => expect(updateClipColor).toHaveBeenCalledTimes(1));
    const sentColor = updateClipColor.mock.calls[0][1] as ClipColor;
    expect(sentColor.grade.lut).toEqual({
      path: '/luts/arri_alexa.cube',
      expectedSha256: 'abc123',
    });

    // Remove clears the LUT.
    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
    expect(screen.queryByText('arri_alexa.cube')).toBeNull();
  });

  it('initializes from the clip colorGrade when the native DTO already carries one', () => {
    clearTauri();
    const gradedClip: Clip = {
      ...clip,
      colorGrade: {
        inputColorSpace: 'pq_hdr',
        grade: {
          exposureEv: -0.5,
          contrast: 1.1,
          saturation: 0.9,
          wbTemp: 10,
          wbTint: -5,
          lut: null,
        },
      },
    };
    render(
      <ColorInspectorPanel clip={gradedClip} projectId="project-a" updateClipColor={async () => {}} />
    );

    expect((screen.getByLabelText('Input color space') as HTMLSelectElement).value).toBe('pq_hdr');
    expect((screen.getByLabelText('Exposure') as HTMLInputElement).value).toBe('-0.5');
  });
});

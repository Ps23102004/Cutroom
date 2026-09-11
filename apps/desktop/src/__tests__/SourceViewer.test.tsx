import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SourceViewer } from '../components/media/SourceViewer';
import type { Asset } from '../lib/contracts';

const sampleAsset: Asset = {
  id: 'asset-test-01',
  projectId: 'proj-01',
  name: 'interview_raw.mp4',
  path: '/workspace/.cutroom/media/interview_raw.mp4',
  sizeBytes: 20971520,
  durationTicks: '72000',
  timeBase: { num: 1, den: 24000 },
  width: 1920,
  height: 1080,
  fpsNumerator: 24,
  fpsDenominator: 1,
  format: 'MP4',
  codec: 'H.264',
  audioChannels: 2,
  importType: 'managed',
  proxyStatus: 'none',
};

describe('SourceViewer Component', () => {
  it('renders asset metadata, timecode readout, and transport controls', () => {
    render(<SourceViewer asset={sampleAsset} />);

    expect(screen.getByText('interview_raw.mp4')).toBeDefined();
    expect(screen.getByText(/H\.264 • 1920×1080/i)).toBeDefined();
    expect(screen.getByText('MANAGED')).toBeDefined();
    expect(screen.getByRole('button', { name: /Mark In/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Mark Out/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Reset Range/i })).toBeDefined();
  });

  it('scrubs, marks frame-aligned In/Out, reports range duration, and calls onAddRange', async () => {
    const handleAddRange = vi.fn();
    render(<SourceViewer asset={sampleAsset} onAddRange={handleAddRange} />);

    const scrub = screen.getByRole('slider');
    const markInBtn = screen.getByRole('button', { name: /Mark In/i });
    const markOutBtn = screen.getByRole('button', { name: /Mark Out/i });
    const addRangeBtn = screen.getByRole('button', { name: /Add Range to Timeline/i });
    const resetBtn = screen.getByRole('button', { name: /Reset Range/i });

     // The default selection covers the full asset duration.
    expect(screen.getByText(/72000 ticks/i)).toBeDefined();

     // Scrub to frame 10 (10,000 ticks) and mark In.
    fireEvent.change(scrub, { target: { value: '10000' } });
    fireEvent.click(markInBtn);

     // Scrub to frame 30 (30,000 ticks) and mark Out.
    fireEvent.change(scrub, { target: { value: '30000' } });
    fireEvent.click(markOutBtn);

     // The selected window is frames 10..30 -> 20,000 source ticks.
    expect(screen.getByText(/20000 ticks/i)).toBeDefined();

     // Sending the range invokes onAddRange with the exact frame-aligned ticks.
    await act(async () => {
      fireEvent.click(addRangeBtn);
     });
    expect(handleAddRange).toHaveBeenCalledWith('10000', '30000');

     // Reset returns to the full asset window.
    fireEvent.click(resetBtn);
    expect(screen.getByText(/72000 ticks/i)).toBeDefined();
  });

  it('rejects an out-point that does not advance past the in-point', () => {
    render(<SourceViewer asset={sampleAsset} />);

    const scrub = screen.getByRole('slider');
    const markOutBtn = screen.getByRole('button', { name: /Mark Out/i });

     // Playhead sits at 0 and In is already 0, so Out cannot advance.
    fireEvent.change(scrub, { target: { value: '0' } });
    fireEvent.click(markOutBtn);

    expect(screen.getByText(/Mark Out must follow Mark In/i)).toBeDefined();
  });
});

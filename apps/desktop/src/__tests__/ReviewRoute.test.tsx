import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useEffect } from 'react';
import { AppProvider, useApp } from '../context/AppContext';
import { ReviewRoute } from '../routes/ReviewRoute';

const ReviewTestWrapper: React.FC = () => {
  const { enableFixtureMode, activeProject } = useApp();

  useEffect(() => {
    enableFixtureMode();
  }, [enableFixtureMode]);

  if (!activeProject) {
    return <div>Loading fixture...</div>;
  }

  return <ReviewRoute />;
};

describe('ReviewRoute UI & Workflow', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders timecoded comments table and allows adding new feedback note', async () => {
    render(
      <AppProvider>
        <ReviewTestWrapper />
      </AppProvider>
    );

    expect(screen.getByText(/Client Review & Timecoded Feedback/i)).toBeDefined();
    expect(screen.getByText(/Executive Producer/i)).toBeDefined();
    expect(screen.getByText(/Cut the awkward pause at the start/i)).toBeDefined();

    // Add feedback note
    const input = screen.getByPlaceholderText(/Cut the silence at 00:01:00/i);
    fireEvent.change(input, { target: { value: 'Color balance seems too dark here' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Feedback/i }));

    expect(screen.getByText('Color balance seems too dark here')).toBeDefined();
  });

  it('generates structured AI proposal from comment and applies revision with human confirmation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                summary: 'Trim intro clip to address producer pause feedback',
                operations: [
                  {
                    kind: 'trim',
                    clipId: 'c1',
                    newInTicks: '12000',
                    newOutTicks: '48000',
                    reason: 'Cut opening 0.5s pause as requested',
                  },
                ],
              }),
            },
            finish_reason: 'stop',
          },
        ],
      }),
    });

    render(
      <AppProvider>
        <ReviewTestWrapper />
      </AppProvider>
    );

    const generateBtns = screen.getAllByRole('button', { name: /Generate AI Plan/i });
    await act(async () => {
      fireEvent.click(generateBtns[0]);
    });

    await waitFor(() => {
      expect(screen.getByText(/AI Proposed Revision from Client Feedback/i)).toBeDefined();
    });

    expect(screen.getByText(/Summary: Address feedback: Cut the awkward pause at the start and tighten pacing\./i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Approve & Apply AI Revision/i })).toBeDefined();

    // Safety note is displayed
    expect(screen.getByText(/Human approval required\. Applying will execute native timeline operations/i)).toBeDefined();
  });
});

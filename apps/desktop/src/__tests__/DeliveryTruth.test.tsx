import { describe, it, expect } from 'vitest';
import React, { useEffect } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppProvider, useApp } from '../context/AppContext';
import { DeliverRoute } from '../routes/DeliverRoute';
import { HelpDrawer } from '../components/drawers/HelpDrawer';

// Helper component that mounts DeliverRoute after enabling DEV fixture mode
const FixtureDeliverWrapper: React.FC = () => {
  const { enableFixtureMode, activeProject } = useApp();

  useEffect(() => {
    enableFixtureMode();
  }, [enableFixtureMode]);

  if (!activeProject) {
    return <div>Loading fixture...</div>;
  }

  return <DeliverRoute />;
};

// Helper component that mounts HelpDrawer with activeDrawer = 'help'
const HelpDrawerWrapper: React.FC = () => {
  const { setActiveDrawer } = useApp();

  useEffect(() => {
    setActiveDrawer('help');
  }, [setActiveDrawer]);

  return <HelpDrawer />;
};

describe('DeliveryTruth: Deliver Route Truth & Gating', () => {
  it('renders project-scoped gate when no active project exists', () => {
    render(
      <AppProvider>
        <DeliverRoute />
      </AppProvider>
    );

    expect(screen.getByText('Deliver Requires Active Project')).toBeDefined();
    expect(screen.getByRole('button', { name: /Return to Home/i })).toBeDefined();
  });

  it('renders output setup with planned targets and disables render submission without native engine', () => {
    render(
      <AppProvider>
        <FixtureDeliverWrapper />
      </AppProvider>
    );

    // Project name is displayed with truthful planned target description
    expect(screen.getByText(/Planned master export targets and preflight validation checklist/i)).toBeDefined();

    // Target specifications show planned targets, not static profile ready
    expect(screen.getByText(/TARGET RENDER SPECIFICATIONS \(PLANNED TARGETS\)/i)).toBeDefined();
    expect(screen.queryByText(/Static Profile Ready/i)).toBeNull();
    expect(screen.getByText(/Unavailable \(Not Checked\)/i)).toBeDefined();

    // Render submission is strictly disabled without connected desktop media engine
    const renderButton = screen.getByRole('button', { name: /Enqueue Render Master/i }) as HTMLButtonElement;
    expect(renderButton).toBeDefined();
    expect(renderButton.disabled).toBe(true);

    // Clear unavailable message rendered
    expect(screen.getByText(/Render submission unavailable: Requires connected desktop media engine/i)).toBeDefined();
  });

  it('renders preflight checklist with neutral status, no passed measurements, and no fake disk capacity', () => {
    render(
      <AppProvider>
        <FixtureDeliverWrapper />
      </AppProvider>
    );

    // Navigate to Preflight Checklist tab
    const preflightTab = screen.getByRole('tab', { name: /Preflight Checklist/i });
    fireEvent.click(preflightTab);

    // Heading must not claim machine verification
    expect(screen.getByText('Preflight Verification Checklist')).toBeDefined();
    expect(screen.queryByText(/Machine-Verified Preflight/i)).toBeNull();

    // Verify all 4 preflight check rows exist with neutral details
    expect(screen.getByText('Source Media Integrity')).toBeDefined();
    expect(screen.getByText('Local Disk Storage Space')).toBeDefined();
    expect(screen.getByText('Subtitle & Font Assets')).toBeDefined();
    expect(screen.getByText('Audio Normalization Profile')).toBeDefined();

    // Must NOT contain positive 'Passed' status or machine-verified claims
    expect(screen.queryByText(/^Passed$/i)).toBeNull();
    expect(screen.queryByText(/hashes match/i)).toBeNull();
    expect(screen.queryByText(/no missing glyphs/i)).toBeNull();

    // Must NOT contain fake disk storage capacity (124 GiB / 850 MB)
    expect(screen.queryByText(/124 GiB/i)).toBeNull();
    expect(screen.queryByText(/850 MB/i)).toBeNull();

    // Status badges and details report Unavailable or Not Checked
    const neutralBadges = screen.getAllByText(/Not Checked|Unavailable/i);
    expect(neutralBadges.length).toBeGreaterThanOrEqual(4);
  });

  it('renders honest empty packages view with no fabricated master artifact or dead Finder action', () => {
    render(
      <AppProvider>
        <FixtureDeliverWrapper />
      </AppProvider>
    );

    // Navigate to Delivered Packages tab
    const packagesTab = screen.getByRole('tab', { name: /Delivered Packages/i });
    fireEvent.click(packagesTab);

    // Header must not claim cryptographic verification of absent packages
    expect(screen.getByText('Delivery Manifests & Packages')).toBeDefined();
    expect(screen.queryByText(/Cryptographically Verified Delivery Manifests/i)).toBeNull();

    // Must NOT fabricate master output files, digests, or Finder reveal button
    expect(screen.queryByText(/Cutroom_Master_r3_1080p\.mov/i)).toBeNull();
    expect(screen.queryByText(/sha256:4cef/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Reveal in Finder/i })).toBeNull();

    // Honest empty state explanation
    expect(screen.getByText(/No delivered master packages yet/i)).toBeDefined();
  });
});

describe('DeliveryTruth: HelpDrawer Truth & Behavior', () => {
  it('documents only implemented keyboard shortcuts and supported navigation keys', () => {
    render(
      <AppProvider>
        <HelpDrawerWrapper />
      </AppProvider>
    );

    // Header describes offline documentation and interface navigation
    expect(screen.getByText('Help & Support')).toBeDefined();
    expect(screen.queryByText(/local diagnostics/i)).toBeNull();

    // Removed unimplemented shortcuts
    expect(screen.queryByText('Cmd+Z')).toBeNull();
    expect(screen.queryByText('Cmd+S')).toBeNull();
    expect(screen.queryByText('1–8')).toBeNull();
    expect(screen.queryByText(/Play \/ Pause program monitor/i)).toBeNull();

    // Retained actual implemented Studio handlers
    expect(screen.getByText(/Split selected clip at playhead \(Studio\)/i)).toBeDefined();
    expect(screen.getByText(/Trim selected clip In-point to playhead \(Studio\)/i)).toBeDefined();
    expect(screen.getByText(/Trim selected clip Out-point to playhead \(Studio\)/i)).toBeDefined();
    expect(screen.getByText(/Remove selected clip \(Studio\)/i)).toBeDefined();

    // Retained interface navigation keys
    expect(screen.getByText(/Navigate focus between interface controls/i)).toBeDefined();
    expect(screen.getByText(/Dismiss active drawer or dialog/i)).toBeDefined();
  });

  it('states revision immutability is planned and filters offline articles via search', () => {
    render(
      <AppProvider>
        <HelpDrawerWrapper />
      </AppProvider>
    );

    // Native revision article states immutability is planned, not presently guaranteed
    expect(screen.getByText(/Revision History & Immutability \(Planned\)/i)).toBeDefined();
    expect(screen.getByText(/intended architecture requirement pending native engine integration/i)).toBeDefined();
    expect(screen.queryByText(/Every revision is an immutable snapshot with a cryptographic SHA-256 hash\./i)).toBeNull();

    // No AI assistant, support ticket, or diagnostics success claims
    expect(screen.queryByText(/AI assistant/i)).toBeNull();
    expect(screen.queryByText(/diagnostics success/i)).toBeNull();

    // Search filters articles correctly
    const searchInput = screen.getByPlaceholderText(/Search offline documentation\.\.\./i);
    fireEvent.change(searchInput, { target: { value: 'navigation' } });

    expect(screen.getByText('Offline Interface Navigation')).toBeDefined();
    expect(screen.queryByText('Speech-Led Editorial Workflow')).toBeNull();
  });
});

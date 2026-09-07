import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppProvider } from '../context/AppContext';
import { SettingsRoute } from '../routes/SettingsRoute';
import { TopBar } from '../components/shell/TopBar';

describe('Settings Truth & Runtime Capabilities', () => {
  it('renders General & Appearance with truthful read-only preference info and no fake interactive switches', () => {
    render(<SettingsRoute />);

    // Subpage 1 is default
    expect(screen.getByText('Appearance & Accessibility')).toBeDefined();

    // No fake toggle switches or checkboxes
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();

    // Truthful preference descriptions
    expect(screen.getByText(/reduced-motion follows system and browser preferences/i)).toBeDefined();
    expect(screen.getByText(/enhanced contrast custom override unavailable/i)).toBeDefined();
    expect(screen.queryByText(/disables transitions and uses static 2d vector fallbacks for all decorative assets/i)).toBeNull();
  });

  it('renders Storage & Paths without fabricated 124GiB/APFS claims or fake editable paths', () => {
    render(<SettingsRoute />);

    const storageTab = screen.getByRole('tab', { name: /Storage & Paths/i });
    fireEvent.click(storageTab);

    // No fabricated drive capacity or filesystem claims
    expect(screen.queryByText(/124 GiB/i)).toBeNull();
    expect(screen.queryByText(/APFS/i)).toBeNull();

    // No editable inputs with fake default paths
    expect(screen.queryByDisplayValue('/workspace/projects')).toBeNull();
    expect(screen.queryByDisplayValue('/workspace/cache')).toBeNull();

    // Truthfully reports paths and capacity as unavailable
    const unavailableReadings = screen.getAllByText(/Unavailable \(requires desktop engine\)/i);
    expect(unavailableReadings.length).toBeGreaterThanOrEqual(2);
  });

  it('renders Models & AI Runtime without unverified hardware acceleration claims', () => {
    render(<SettingsRoute />);

    const modelsTab = screen.getByRole('tab', { name: /Models & AI Runtime/i });
    fireEvent.click(modelsTab);

    // No hardcoded claims of Neural Engine acceleration
    expect(screen.queryByText(/Apple Silicon Neural Engine accelerated/i)).toBeNull();
    expect(screen.queryByText(/Pending Native Test/i)).toBeNull();

    // Reports runtime unavailable
    const badges = screen.getAllByText('Unavailable');
    expect(badges.length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Runtime unavailable \(desktop engine not connected\)/i).length).toBe(2);
  });

  it('renders Media Engine & Codecs with runtime-unavailable readings instead of fake detection', () => {
    render(<SettingsRoute />);

    const mediaTab = screen.getByRole('tab', { name: /Media Engine & Codecs/i });
    fireEvent.click(mediaTab);

    // No fake detection claims
    expect(screen.queryByText(/FFmpeg 9.0.1 \(Detected in PATH\)/i)).toBeNull();
    expect(screen.queryByText(/Apple Silicon VideoToolbox \(H.264 \/ HEVC \/ ProRes\)/i)).toBeNull();
    expect(screen.queryByText(/EBU R128 Loudness Normalizer • True-Peak Limiting/i)).toBeNull();

    // Clear runtime-unavailable indicators
    expect(screen.getByText(/Unavailable — not detected \(requires desktop engine\)/i)).toBeDefined();
    const unavailableReadings = screen.getAllByText(/Unavailable \(requires desktop engine\)/i);
    expect(unavailableReadings.length).toBeGreaterThanOrEqual(2);
  });

  it('renders Privacy without promotional guarantee copy or disconnected telemetry switch', () => {
    render(<SettingsRoute />);

    const privacyTab = screen.getByRole('tab', { name: /Privacy & Local Bounds/i });
    fireEvent.click(privacyTab);

    // No promotional copy
    expect(screen.queryByText(/Local-First Guarantee:/i)).toBeNull();

    // No disconnected telemetry toggle switch
    expect(screen.queryByRole('switch')).toBeNull();

    // Truthful preview bounds and unavailable telemetry sending
    expect(screen.getByText(/Current Preview Behavior:/i)).toBeDefined();
    expect(screen.getByText(/Diagnostics sending unavailable/i)).toBeDefined();
  });

  it('disables diagnostics bundle generation with clear explanation of missing engine', () => {
    render(<SettingsRoute />);

    const diagTab = screen.getByRole('tab', { name: /Diagnostics & Logs/i });
    fireEvent.click(diagTab);

    // Button is present and disabled
    const button = screen.getByRole('button', { name: /Generate Sanitized Bundle/i }) as HTMLButtonElement;
    expect(button).toBeDefined();
    expect(button.disabled).toBe(true);

    // Adjacent explanation exists
    expect(screen.getByText(/Desktop engine unavailable — diagnostics bundle cannot be generated/i)).toBeDefined();
  });
});

describe('TopBar Truth & DEV Affordances', () => {
  it('displays plain engine unavailable status without "No Tauri" phrasing', () => {
    render(
      <AppProvider>
        <TopBar />
      </AppProvider>
    );

    // Must not use old "No Tauri" wording
    expect(screen.queryByText(/No Tauri/i)).toBeNull();

    // Plain engine unavailable wording
    expect(screen.getByText(/Browser Preview \(Engine unavailable\)/i)).toBeDefined();
  });

  it('renders DEV-guarded sample fixture affordance in DEV mode', () => {
    render(
      <AppProvider>
        <TopBar />
      </AppProvider>
    );

    // In test / dev environment, import.meta.env.DEV is true
    if (import.meta.env.DEV) {
      expect(screen.getByRole('button', { name: /Load Sample Fixture/i })).toBeDefined();
    }
  });
});

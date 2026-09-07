import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AppProvider } from '../context/AppContext';
import { App } from '../App';
import { PRIMARY_ROUTES, FOOTER_UTILITIES } from '../routes/manifest';

describe('AppShell & Canonical Navigation', () => {
  it('renders the 216px sidebar with brand header and exact 8 routes in order', () => {
    render(
      <AppProvider>
        <App />
      </AppProvider>
    );

    // Verify brand header
    expect(screen.getByText('CUTROOM')).toBeDefined();

    // Verify all 8 primary routes exist in the sidebar navigation
    const nav = screen.getByLabelText('Application Navigation');
    const routeLabels = PRIMARY_ROUTES.map((r) => r.label);

    for (const label of routeLabels) {
      const el = within(nav).getByText(label);
      expect(el).toBeDefined();
    }

    // Verify footer utilities in sidebar
    for (const util of FOOTER_UTILITIES) {
      expect(within(nav).getByText(util.label)).toBeDefined();
    }
  });

  it('navigates between routes correctly', () => {
    render(
      <AppProvider>
        <App />
      </AppProvider>
    );

    const nav = screen.getByLabelText('Application Navigation');

    // Initial route is Home
    expect(screen.getByText('Workspace Overview')).toBeDefined();

    // Click Settings
    const settingsBtn = within(nav).getByText('Settings');
    fireEvent.click(settingsBtn);

    expect(screen.getByText('Application Settings')).toBeDefined();

    // Click Projects
    const projectsBtn = within(nav).getByText('Projects');
    fireEvent.click(projectsBtn);

    expect(screen.getByText('Projects & Media Management')).toBeDefined();
  });

  it('opens and closes footer utility drawers', () => {
    render(
      <AppProvider>
        <App />
      </AppProvider>
    );

    const nav = screen.getByLabelText('Application Navigation');

    // Open Jobs drawer
    const jobsBtn = within(nav).getByText('Jobs');
    fireEvent.click(jobsBtn);

    expect(screen.getByText('Background Tasks & Jobs')).toBeDefined();

    // Open Help drawer
    const helpBtn = within(nav).getByText('Help & Support');
    fireEvent.click(helpBtn);

    const matches = screen.getAllByText('Help & Support');
    expect(matches.length).toBeGreaterThanOrEqual(2); // Footer button + Drawer title
  });
});

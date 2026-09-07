import React from 'react';
import { SidebarNav } from './SidebarNav';
import { TopBar } from './TopBar';
import { BrowserModeBanner } from './BrowserModeBanner';
import { JobsDrawer } from '../drawers/JobsDrawer';
import { HelpDrawer } from '../drawers/HelpDrawer';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div
      style={{
        display: 'flex',
        width: '100vw',
        height: '100vh',
        backgroundColor: 'var(--bg-app, #19161F)',
        color: 'var(--text-primary, #F3F0F6)',
        overflow: 'hidden',
      }}
    >
      {/* 216px Fixed Sidebar */}
      <SidebarNav />

      {/* Main Column */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        {/* 56px Fixed Header */}
        <TopBar />

        {/* Browser Mode Banner */}
        <BrowserModeBanner />

        {/* Content Canvas (Matte opaque surface with 24px gutters) */}
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px',
            backgroundColor: 'var(--bg-app, #19161F)',
            boxSizing: 'border-box',
          }}
        >
          {children}
        </main>
      </div>

      {/* Footer Drawers */}
      <JobsDrawer />
      <HelpDrawer />
    </div>
  );
};

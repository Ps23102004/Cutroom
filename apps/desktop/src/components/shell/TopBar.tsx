import React from 'react';
import { useApp } from '../../context/AppContext';
import { PRIMARY_ROUTES } from '../../routes/manifest';
import { Breadcrumb, Button, Badge } from '@cutroom/ui';

export const TopBar: React.FC = () => {
  const {
    currentRoute,
    navigate,
    activeProject,
    closeProject,
    isNativeConnected,
    isFixtureMode,
    enableFixtureMode,
    resetToEmpty,
    lastError,
    clearError,
  } = useApp();

  const currentDef = PRIMARY_ROUTES.find((r) => r.id === currentRoute);

  const breadcrumbItems = [
    { label: 'Cutroom', onClick: () => navigate('home') },
    { label: currentDef?.label || 'Screen', isCurrent: !activeProject },
    ...(activeProject
      ? [{ label: activeProject.name, isCurrent: true }]
      : []),
  ];

  return (
    <header
      style={{
        height: '56px',
        minHeight: '56px',
        maxHeight: '56px',
        padding: '0 24px',
        backgroundColor: 'var(--bg-glass, rgba(34, 30, 41, 0.78))',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--bg-glass-border, rgba(255, 255, 255, 0.08))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxSizing: 'border-box',
        zIndex: 90,
      }}
    >
      {/* Left: Breadcrumbs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <Breadcrumb items={breadcrumbItems} />
      </div>

      {/* Right: Project context & Environment state */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Error notification banner */}
        {lastError && (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: 'rgba(224, 108, 117, 0.2)',
              border: '1px solid var(--destructive, #E06C75)',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              color: 'var(--destructive, #E06C75)',
            }}
          >
            <span>{lastError}</span>
            <button
              onClick={clearError}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'currentColor',
                cursor: 'pointer',
                fontSize: '12px',
                padding: 0,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Active Project Indicator */}
        {activeProject ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '4px 10px',
              borderRadius: '6px',
              backgroundColor: 'var(--bg-raised, #2B2533)',
              border: '1px solid var(--border-default, #443B4F)',
            }}
          >
            <span style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)' }}>Project:</span>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary, #F3F0F6)' }}>
              {activeProject.name}
            </span>
            <Badge variant={activeProject.status}>{activeProject.status.replace('_', ' ')}</Badge>
            <button
              onClick={() => closeProject()}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-tertiary, #877E94)',
                cursor: 'pointer',
                fontSize: '12px',
                padding: '2px 4px',
              }}
              title="Close active project"
            >
              ✕
            </button>
          </div>
        ) : (
          <span style={{ fontSize: '12px', color: 'var(--text-tertiary, #877E94)' }}>
            No project active
          </span>
        )}

        {/* Runtime Status */}
        {!isNativeConnected ? (
          <Badge variant="neutral" style={{ borderStyle: 'dashed' }}>
            Browser Preview (Engine unavailable)
          </Badge>
        ) : (
          <Badge variant="approved">Tauri Desktop</Badge>
        )}

        {/* Fixture Mode Opt-In Toggle */}
        {import.meta.env.DEV && (
          isFixtureMode ? (
            <Button size="sm" variant="outline" onClick={resetToEmpty}>
              Exit Fixture Mode
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={enableFixtureMode} title="Load sample test project with [FIXTURE] tag">
              Load Sample Fixture
            </Button>
          )
        )}
      </div>
    </header>
  );
};

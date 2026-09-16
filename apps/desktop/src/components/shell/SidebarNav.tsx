import React from 'react';
import { useApp } from '../../context/AppContext';
import { PRIMARY_ROUTES, FOOTER_UTILITIES } from '../../routes/manifest';
import { Badge } from '@cutroom/ui';

export const SidebarNav: React.FC = () => {
  const {
    currentRoute,
    navigate,
    activeDrawer,
    setActiveDrawer,
    activeProject,
    isNativeConnected,
    isFixtureMode,
    jobs,
  } = useApp();

  const runningJobsCount = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;

  return (
    <aside
      aria-label="Application Navigation"
      style={{
        width: '216px',
        minWidth: '216px',
        maxWidth: '216px',
        height: '100vh',
        backgroundColor: 'var(--bg-glass, rgba(15, 15, 22, 0.78))',
        backdropFilter: 'blur(16px) saturate(180%)',
        WebkitBackdropFilter: 'blur(16px) saturate(180%)',
        borderRight: '1px solid var(--bg-glass-border, rgba(255, 255, 255, 0.08))',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        userSelect: 'none',
        zIndex: 100,
      }}
    >
      {/* Brand Header */}
      <div
        style={{
          height: '56px',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-subtle, #1E1E2A)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '5px',
              backgroundColor: 'var(--accent-violet, #C4B5FD)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '12px',
              color: 'var(--text-inverse, #0B0A10)',
            }}
          >
            C
          </div>
          <span
            style={{
              fontSize: '14px',
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: 'var(--text-primary, #FAF8FF)',
            }}
          >
            CUTROOM
          </span>
        </div>
        {isFixtureMode && <Badge variant="fixture">Fixture</Badge>}
      </div>

      {/* Primary Navigation List */}
      <nav
        aria-label="Primary"
        style={{
          flex: 1,
          padding: '12px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          overflowY: 'auto',
        }}
      >
        {PRIMARY_ROUTES.map((route) => {
          const isActive = currentRoute === route.id && !activeDrawer;
          const Icon = route.icon;
          const isProjectScope = route.requiresProject;
          const hasProject = Boolean(activeProject);

          return (
            <button
              key={route.id}
              type="button"
              onClick={() => {
                setActiveDrawer(null);
                navigate(route.id);
              }}
              aria-current={isActive ? 'page' : undefined}
              style={{
                width: '100%',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '0 10px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: isActive
                  ? 'var(--accent-violet-subtle, rgba(196, 181, 253, 0.14))'
                  : 'transparent',
                color: isActive
                  ? 'var(--accent-violet, #C4B5FD)'
                  : isProjectScope && !hasProject
                  ? 'var(--text-tertiary, #8E87A0)'
                  : 'var(--text-secondary, #C2BCCC)',
                fontWeight: isActive ? 600 : 500,
                fontSize: '13px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 120ms ease',
                outline: 'none',
                position: 'relative',
              }}
              title={route.description}
            >
              <Icon size={16} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {route.label}
              </span>
              {isProjectScope && !hasProject && (
                <span
                  style={{
                    fontSize: '10px',
                    color: 'var(--text-tertiary, #8E87A0)',
                    border: '1px solid var(--border-subtle, #1E1E2A)',
                    padding: '1px 4px',
                    borderRadius: '4px',
                  }}
                >
                  Scope
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer Utilities */}
      <div
        style={{
          borderTop: '1px solid var(--border-subtle, #1E1E2A)',
          padding: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
        }}
      >
        {FOOTER_UTILITIES.map((util) => {
          const isActive = activeDrawer === util.id;
          const Icon = util.icon;

          return (
            <button
              key={util.id}
              type="button"
              onClick={() => setActiveDrawer(isActive ? null : util.id)}
              aria-pressed={isActive}
              style={{
                width: '100%',
                height: '34px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '0 10px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: isActive ? 'var(--bg-raised, #17171F)' : 'transparent',
                color: isActive ? 'var(--text-primary, #FAF8FF)' : 'var(--text-secondary, #C2BCCC)',
                fontWeight: 500,
                fontSize: '13px',
                cursor: 'pointer',
                textAlign: 'left',
                outline: 'none',
              }}
              title={util.description}
            >
              <Icon size={16} />
              <span style={{ flex: 1 }}>{util.label}</span>
              {util.id === 'jobs' && runningJobsCount > 0 && (
                <span
                  style={{
                    backgroundColor: 'var(--ochre, #D6AE69)',
                    color: 'var(--text-inverse, #0B0A10)',
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: '9999px',
                  }}
                >
                  {runningJobsCount}
                </span>
              )}
            </button>
          );
        })}

        {/* Health status pill */}
        <div
          style={{
            marginTop: '6px',
            padding: '6px 10px',
            borderRadius: '6px',
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: 'var(--text-tertiary, #8E87A0)',
          }}
        >
          <span>Runtime</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: isNativeConnected ? 'var(--positive, #A7D7A1)' : 'var(--ochre, #D6AE69)',
              }}
            />
            <span style={{ color: isNativeConnected ? 'var(--positive, #A7D7A1)' : 'var(--text-secondary, #C2BCCC)' }}>
              {isNativeConnected ? 'Tauri IPC' : 'Browser'}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
};

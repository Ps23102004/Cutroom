import React from 'react';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const Tabs: React.FC<TabsProps> = ({
  items,
  activeId,
  onChange,
  className = '',
  style,
}) => {
  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        borderBottom: '1px solid var(--border-subtle, #1E1E2A)',
        paddingBottom: '2px',
        ...style,
      }}
      className={`cutroom-tabs ${className}`}
    >
      {items.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onChange(tab.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 500,
              background: 'transparent',
              border: 'none',
              borderBottom: isActive ? '2px solid var(--accent-violet, #C4B5FD)' : '2px solid transparent',
              color: isActive ? 'var(--text-primary, #FAF8FF)' : 'var(--text-secondary, #C2BCCC)',
              cursor: tab.disabled ? 'not-allowed' : 'pointer',
              opacity: tab.disabled ? 0.4 : 1,
              transition: 'all 150ms ease',
              marginBottom: '-2px',
              outline: 'none',
            }}
            className={`cutroom-tab ${isActive ? 'is-active' : ''}`}
          >
            <span>{tab.label}</span>
            {typeof tab.count === 'number' && (
              <span
                style={{
                  fontSize: '11px',
                  padding: '1px 6px',
                  borderRadius: '9999px',
                  backgroundColor: isActive
                    ? 'var(--accent-violet-subtle, rgba(196, 181, 253, 0.14))'
                    : 'rgba(255, 255, 255, 0.06)',
                  color: isActive ? 'var(--accent-violet, #C4B5FD)' : 'var(--text-tertiary, #8E87A0)',
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

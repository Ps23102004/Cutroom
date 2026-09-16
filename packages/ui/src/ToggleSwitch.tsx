import React, { useId } from 'react';

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  id?: string;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  id: customId,
}) => {
  const generatedId = useId();
  const switchId = customId || generatedId;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
      {(label || description) && (
        <label htmlFor={switchId} style={{ cursor: disabled ? 'not-allowed' : 'pointer', flex: 1 }}>
          {label && (
            <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary, #FAF8FF)' }}>
              {label}
            </div>
          )}
          {description && (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary, #C2BCCC)', marginTop: '2px' }}>
              {description}
            </div>
          )}
        </label>
      )}
      <button
        id={switchId}
        role="switch"
        type="button"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        style={{
          position: 'relative',
          width: '44px',
          height: '24px',
          borderRadius: '9999px',
          backgroundColor: checked ? 'var(--accent-violet, #C4B5FD)' : 'var(--bg-panel, #0F0F16)',
          border: '1px solid var(--border-default, #2A2A3A)',
          padding: 0,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.45 : 1,
          transition: 'background-color 200ms ease',
          outline: 'none',
          boxSizing: 'border-box',
          flexShrink: 0,
        }}
        className="cutroom-switch"
      >
        <span
          style={{
            position: 'absolute',
            top: '2px',
            left: checked ? '22px' : '2px',
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            backgroundColor: checked ? 'var(--text-inverse, #0B0A10)' : 'var(--text-secondary, #C2BCCC)',
            transition: 'left 200ms ease, background-color 200ms ease',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.3)',
          }}
        />
      </button>
    </div>
  );
};

import React, { useId } from 'react';
import { CheckIcon } from './Icons';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  description?: string;
  disabled?: boolean;
  id?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  id: customId,
}) => {
  const generatedId = useId();
  const checkboxId = customId || generatedId;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
      <button
        id={checkboxId}
        role="checkbox"
        type="button"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: '18px',
          height: '18px',
          borderRadius: '4px',
          backgroundColor: checked ? 'var(--accent-violet, #A18AF7)' : 'var(--bg-panel, #221E29)',
          border: `1px solid ${checked ? 'var(--accent-violet, #A18AF7)' : 'var(--border-default, #443B4F)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.45 : 1,
          padding: 0,
          outline: 'none',
          flexShrink: 0,
          marginTop: '2px',
          transition: 'all 150ms ease',
        }}
        className="cutroom-checkbox"
      >
        {checked && <CheckIcon size={14} style={{ color: 'var(--text-inverse, #191320)' }} />}
      </button>
      {(label || description) && (
        <label htmlFor={checkboxId} style={{ cursor: disabled ? 'not-allowed' : 'pointer', userSelect: 'none' }}>
          {label && (
            <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary, #F3F0F6)' }}>
              {label}
            </div>
          )}
          {description && (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary, #BAB3C5)', marginTop: '2px' }}>
              {description}
            </div>
          )}
        </label>
      )}
    </div>
  );
};

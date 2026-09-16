import React, { forwardRef, useId } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
  error?: string;
  hint?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({
  label,
  options,
  error,
  hint,
  disabled,
  className = '',
  id: customId,
  style,
  ...props
}, ref) => {
  const generatedId = useId();
  const selectId = customId || generatedId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
      {label && (
        <label
          htmlFor={selectId}
          style={{
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--text-secondary, #C2BCCC)',
            display: 'block',
          }}
        >
          {label}
        </label>
      )}
      <div style={{ position: 'relative', width: '100%' }}>
        <select
          ref={ref}
          id={selectId}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          style={{
            width: '100%',
            height: '38px',
            paddingLeft: '12px',
            paddingRight: '36px',
            backgroundColor: 'var(--bg-panel, #0F0F16)',
            border: `1px solid ${error ? 'var(--destructive, #E06C75)' : 'var(--border-default, #2A2A3A)'}`,
            borderRadius: '8px',
            color: 'var(--text-primary, #FAF8FF)',
            fontSize: '14px',
            outline: 'none',
            appearance: 'none',
            WebkitAppearance: 'none',
            boxSizing: 'border-box',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            ...style,
          }}
          className={`cutroom-select ${className}`}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <div
          style={{
            position: 'absolute',
            right: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            color: 'var(--text-secondary, #C2BCCC)',
          }}
        >
          ▼
        </div>
      </div>
      {hint && !error && (
        <span id={hintId} style={{ fontSize: '12px', color: 'var(--text-tertiary, #8E87A0)' }}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} role="alert" style={{ fontSize: '12px', color: 'var(--destructive, #E06C75)', fontWeight: 500 }}>
          {error}
        </span>
      )}
    </div>
  );
});

Select.displayName = 'Select';

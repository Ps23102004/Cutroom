import React, { forwardRef, useId } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  label,
  error,
  hint,
  leftIcon,
  rightIcon,
  disabled,
  className = '',
  id: customId,
  style,
  ...props
}, ref) => {
  const generatedId = useId();
  const inputId = customId || generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
      {label && (
        <label
          htmlFor={inputId}
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
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          width: '100%',
        }}
      >
        {leftIcon && (
          <div
            style={{
              position: 'absolute',
              left: '12px',
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'none',
              color: 'var(--text-tertiary, #8E87A0)',
            }}
          >
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          style={{
            width: '100%',
            height: '38px',
            paddingLeft: leftIcon ? '36px' : '12px',
            paddingRight: rightIcon ? '36px' : '12px',
            backgroundColor: 'var(--bg-panel, #0F0F16)',
            border: `1px solid ${error ? 'var(--destructive, #E06C75)' : 'var(--border-default, #2A2A3A)'}`,
            borderRadius: '8px',
            color: 'var(--text-primary, #FAF8FF)',
            fontSize: '14px',
            outline: 'none',
            boxSizing: 'border-box',
            transition: 'border-color 150ms ease, box-shadow 150ms ease',
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? 'not-allowed' : 'text',
            ...style,
          }}
          className={`cutroom-input ${className}`}
          {...props}
        />
        {rightIcon && (
          <div
            style={{
              position: 'absolute',
              right: '12px',
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'none',
              color: 'var(--text-tertiary, #8E87A0)',
            }}
          >
            {rightIcon}
          </div>
        )}
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

Input.displayName = 'Input';

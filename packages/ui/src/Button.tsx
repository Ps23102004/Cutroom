import React, { forwardRef } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled = false,
  leftIcon,
  rightIcon,
  className = '',
  style,
  ...props
}, ref) => {
  const isDisabled = disabled || isLoading;

  // Base size styles adhering to 36px minimum hit target and 38px standard height
  const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
    sm: { height: '32px', minWidth: '36px', padding: '0 12px', fontSize: '12px' },
    md: { height: '38px', minWidth: '38px', padding: '0 16px', fontSize: '14px' },
    lg: { height: '44px', minWidth: '44px', padding: '0 20px', fontSize: '15px' },
  };

  const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      backgroundColor: 'var(--accent-violet, #C4B5FD)',
      color: 'var(--text-inverse, #0B0A10)',
      border: '1px solid transparent',
      fontWeight: 500,
    },
    secondary: {
      backgroundColor: 'var(--bg-raised, #17171F)',
      color: 'var(--text-primary, #FAF8FF)',
      border: '1px solid var(--border-default, #2A2A3A)',
      fontWeight: 500,
    },
    outline: {
      backgroundColor: 'transparent',
      color: 'var(--text-primary, #FAF8FF)',
      border: '1px solid var(--border-default, #2A2A3A)',
      fontWeight: 500,
    },
    ghost: {
      backgroundColor: 'transparent',
      color: 'var(--text-secondary, #C2BCCC)',
      border: '1px solid transparent',
      fontWeight: 500,
    },
    destructive: {
      backgroundColor: 'rgba(224, 108, 117, 0.16)',
      color: 'var(--destructive, #E06C75)',
      border: '1px solid rgba(224, 108, 117, 0.35)',
      fontWeight: 500,
    },
  };

  const combinedStyles: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    borderRadius: '8px',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.45 : 1,
    transition: 'all 150ms cubic-bezier(0.16, 1, 0.3, 1)',
    outline: 'none',
    boxSizing: 'border-box',
    userSelect: 'none',
    textDecoration: 'none',
    fontFamily: 'inherit',
    lineHeight: 1,
    whiteSpace: 'nowrap',
    ...sizeStyles[size],
    ...variantStyles[variant],
    ...style,
  };

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      aria-busy={isLoading}
      style={combinedStyles}
      className={`cutroom-button cutroom-button-${variant} ${className}`}
      {...props}
    >
      {isLoading ? (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: '14px',
            height: '14px',
            border: '2px solid currentColor',
            borderRightColor: 'transparent',
            borderRadius: '50%',
            animation: 'cutroom-spin 0.75s linear infinite',
          }}
        />
      ) : leftIcon}
      <span>{children}</span>
      {!isLoading && rightIcon}
    </button>
  );
});

Button.displayName = 'Button';

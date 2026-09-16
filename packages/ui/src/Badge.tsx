import React from 'react';

export type BadgeVariant = 'draft' | 'in_review' | 'approved' | 'changes_req' | 'neutral' | 'violet' | 'destructive' | 'fixture';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  children,
  style,
  className = '',
  ...props
}) => {
  const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
    draft: {
      backgroundColor: 'var(--ochre-subtle, rgba(214, 174, 105, 0.14))',
      color: 'var(--ochre, #D6AE69)',
      border: '1px solid rgba(214, 174, 105, 0.35)',
    },
    in_review: {
      backgroundColor: 'var(--sky-subtle, rgba(140, 200, 232, 0.14))',
      color: 'var(--sky, #8CC8E8)',
      border: '1px solid rgba(140, 200, 232, 0.35)',
    },
    approved: {
      backgroundColor: 'var(--positive-subtle, rgba(167, 215, 161, 0.14))',
      color: 'var(--positive, #A7D7A1)',
      border: '1px solid rgba(167, 215, 161, 0.35)',
    },
    changes_req: {
      backgroundColor: 'var(--maroon-subtle, rgba(113, 61, 80, 0.22))',
      color: '#E0B2C3', // High-contrast tinted light text on maroon background
      border: '1px solid rgba(113, 61, 80, 0.6)',
    },
    neutral: {
      backgroundColor: 'rgba(255, 255, 255, 0.06)',
      color: 'var(--text-secondary, #C2BCCC)',
      border: '1px solid var(--border-subtle, #1E1E2A)',
    },
    violet: {
      backgroundColor: 'var(--accent-violet-subtle, rgba(196, 181, 253, 0.14))',
      color: 'var(--accent-violet, #C4B5FD)',
      border: '1px solid rgba(196, 181, 253, 0.35)',
    },
    destructive: {
      backgroundColor: 'var(--destructive-subtle, rgba(224, 108, 117, 0.16))',
      color: 'var(--destructive, #E06C75)',
      border: '1px solid rgba(224, 108, 117, 0.35)',
    },
    fixture: {
      backgroundColor: 'rgba(214, 174, 105, 0.2)',
      color: 'var(--ochre, #D6AE69)',
      border: '1px dashed var(--ochre, #D6AE69)',
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
    },
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: 600,
        lineHeight: '16px',
        whiteSpace: 'nowrap',
        ...variantStyles[variant],
        ...style,
      }}
      className={`cutroom-badge cutroom-badge-${variant} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
};

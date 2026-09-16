import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  raised?: boolean;
  bordered?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const Card: React.FC<CardProps> = ({
  raised = false,
  bordered = true,
  padding = 'md',
  children,
  className = '',
  style,
  ...props
}) => {
  const paddingMap = {
    none: '0',
    sm: '12px',
    md: '16px',
    lg: '24px',
  };

  return (
    <div
      style={{
        backgroundColor: raised ? 'var(--bg-raised, #17171F)' : 'var(--bg-panel, #0F0F16)',
        border: bordered ? '1px solid var(--border-default, #2A2A3A)' : 'none',
        borderRadius: '12px',
        padding: paddingMap[padding],
        boxSizing: 'border-box',
        ...style,
      }}
      className={`cutroom-card ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

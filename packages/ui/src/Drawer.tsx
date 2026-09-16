import React, { useEffect, useRef } from 'react';
import { CloseIcon } from './Icons';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  width?: string;
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  width = '460px',
}) => {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(10, 8, 14, 0.7)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        zIndex: 900,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        ref={drawerRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: width,
          height: '100%',
          backgroundColor: 'var(--bg-panel, #0F0F16)',
          borderLeft: '1px solid var(--border-strong, #3D3D55)',
          boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          overflow: 'hidden',
          animation: 'cutroom-slide-left 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Drawer Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px',
            borderBottom: '1px solid var(--border-subtle, #1E1E2A)',
            backgroundColor: 'var(--bg-raised, #17171F)',
          }}
        >
          <div>
            <h2
              id="drawer-title"
              style={{
                margin: 0,
                fontSize: '17px',
                fontWeight: 600,
                color: 'var(--text-primary, #FAF8FF)',
              }}
            >
              {title}
            </h2>
            {description && (
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary, #C2BCCC)' }}>
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary, #C2BCCC)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
            }}
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Drawer Content */}
        <div
          style={{
            flex: 1,
            padding: '24px',
            overflowY: 'auto',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

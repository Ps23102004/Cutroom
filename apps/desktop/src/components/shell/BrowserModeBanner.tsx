import React from 'react';
import { useApp } from '../../context/AppContext';
import { AlertCircleIcon } from '@cutroom/ui';

export const BrowserModeBanner: React.FC = () => {
  const { isNativeConnected } = useApp();

  if (isNativeConnected) return null;

  return (
    <div
      role="status"
      style={{
        backgroundColor: 'rgba(214, 174, 105, 0.12)',
        borderBottom: '1px solid rgba(214, 174, 105, 0.3)',
        padding: '6px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '12px',
        color: 'var(--ochre, #D6AE69)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <AlertCircleIcon size={14} />
        <span>
          <strong>Browser Preview Mode:</strong> The desktop engine is unavailable. You can explore the interface, but project changes cannot be saved.
        </span>
      </div>
      <span style={{ fontSize: '11px', opacity: 0.8 }}>Preview only</span>
    </div>
  );
};

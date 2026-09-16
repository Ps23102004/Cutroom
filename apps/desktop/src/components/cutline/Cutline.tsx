import React, { useState, useEffect, useCallback, Suspense } from 'react';

const cutlineSnapshotUrl = '/assets/3d/fallback/cutline-runtime-fallback.png';
const LazyCutlineCanvas = React.lazy(() => import('./CutlineCanvas'));

export interface CutlineProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

function checkWebGLSupport(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // The renderer checks actual driver support and falls back on failure.
    // Avoid allocating a probe context that would retain GPU resources.
    return Boolean(window.WebGL2RenderingContext);
  } catch {
    return false;
  }
}

export const Cutline: React.FC<CutlineProps> = ({ size = 72, className, style }) => {
  const [hasError, setHasError] = useState(false);
  const [shouldUseFallback, setShouldUseFallback] = useState(true);
  const handleError = useCallback(() => setHasError(true), []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setShouldUseFallback(true);
      return;
    }

    // Reduced motion or reduced transparency preferences yield static fallback
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const transparency = window.matchMedia?.('(prefers-reduced-transparency: reduce)');
    const update = () => setShouldUseFallback(
      !motion || !transparency || motion.matches || transparency.matches || !checkWebGLSupport()
    );
    update();
    motion?.addEventListener('change', update);
    transparency?.addEventListener('change', update);
    return () => {
      motion?.removeEventListener('change', update);
      transparency?.removeEventListener('change', update);
    };
  }, []);

  const staticFallback = (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '10px',
        backgroundColor: 'var(--bg-panel, #0F0F16)',
        border: '1px solid var(--border-subtle, #1E1E2A)',
        overflow: 'hidden',
        boxSizing: 'border-box',
        ...style,
      }}
      aria-hidden="true"
    >
      <img
        src={cutlineSnapshotUrl}
        alt=""
        aria-hidden="true"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
        }}
      />
    </div>
  );

  if (shouldUseFallback || hasError) {
    return staticFallback;
  }

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '10px',
        backgroundColor: 'var(--bg-panel, #0F0F16)',
        border: '1px solid var(--border-subtle, #1E1E2A)',
        overflow: 'hidden',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
      aria-hidden="true"
    >
      <Suspense fallback={staticFallback}>
        <LazyCutlineCanvas size={size} onError={handleError} />
      </Suspense>
    </div>
  );
};

export default Cutline;

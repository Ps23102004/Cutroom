import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const cutlineGlbUrl = '/assets/3d/fallback/cutline-ribbon-fallback.glb';

interface CutlineCanvasProps {
  size: number;
  onError: () => void;
}

export const CutlineCanvas: React.FC<CutlineCanvasProps> = ({ size, onError }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let rafId: number | null = null;
    let isAnimating = false;
    let isDisposed = false;
    let isVisible = true;

    // Rotation targets and current values
    let targetRotX = 0;
    let targetRotY = 0;
    let currentRotX = 0;
    let currentRotY = 0;

    // Setup Three.js scene
    const scene = new THREE.Scene();

    // Camera setup: centered framing of the 4.8-unit procedural ribbon
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    camera.position.set(1.4, 1.2, 8.4);
    camera.lookAt(0, 0, 0);

    // Diffuse neutral lighting matching ASSET_PLAN.md
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.15);
    dirLight.position.set(4, 6, 5);
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xa18af7, 0.35);
    fillLight.position.set(-4, -2, -3);
    scene.add(fillLight);

    // WebGL Renderer with capped DPR <= 1.5
    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      });
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      renderer.setPixelRatio(dpr);
      renderer.setSize(size, size);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
    } catch (err) {
      console.warn('WebGL initialization failed, falling back to static snapshot:', err);
      onError();
      return;
    }

    const ribbonGroup = new THREE.Group();
    scene.add(ribbonGroup);

    // Demand rendering step (runs only when animating orientation, stops immediately on settle)
    const step = () => {
      if (isDisposed || !renderer || !isVisible || document.hidden) {
        rafId = null;
        isAnimating = false;
        return;
      }

      currentRotX += (targetRotX - currentRotX) * 0.15;
      currentRotY += (targetRotY - currentRotY) * 0.15;
      ribbonGroup.rotation.x = currentRotX;
      ribbonGroup.rotation.y = currentRotY;
      renderer.render(scene, camera);

      const delta = Math.abs(targetRotX - currentRotX) + Math.abs(targetRotY - currentRotY);
      if (delta > 0.001) {
        rafId = requestAnimationFrame(step);
      } else {
        // Snap to target and halt RAF completely
        ribbonGroup.rotation.x = targetRotX;
        ribbonGroup.rotation.y = targetRotY;
        renderer.render(scene, camera);
        rafId = null;
        isAnimating = false;
      }
    };

    const scheduleFrame = () => {
      if (!isAnimating && !isDisposed && isVisible && !document.hidden) {
        isAnimating = true;
        rafId = requestAnimationFrame(step);
      }
    };

    // Load procedural ribbon GLB
    const disposeObject = (root: THREE.Object3D) => root.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    });
    const loader = new GLTFLoader();
    loader.load(
      cutlineGlbUrl,
      (gltf) => {
        if (isDisposed || !renderer) {
          disposeObject(gltf.scene);
          return;
        }
        // Center the ribbon: bounds y center is ~0.31
        gltf.scene.position.set(0, -0.31, 0);
        ribbonGroup.add(gltf.scene);

        // Initial static render (no continuous RAF)
        if (isVisible && !document.hidden) renderer.render(scene, camera);
      },
      undefined,
      (error) => {
        if (isDisposed) return;
        console.warn('Failed to load Cutline GLB, falling back to static snapshot:', error);
        onError();
      }
    );

    // Pointer events for gentle scheduled orientation response
    const handlePointerMove = (e: PointerEvent) => {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      // Max tilt ~14 degrees (0.24 rad)
      targetRotY = nx * 0.25;
      targetRotX = -ny * 0.2;
      scheduleFrame();
    };

    const handlePointerLeave = () => {
      targetRotX = 0;
      targetRotY = 0;
      scheduleFrame();
    };

    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerleave', handlePointerLeave);

    // Stop hidden/offscreen
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          isVisible = entry.isIntersecting;
          if (!isVisible && rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
            isAnimating = false;
          } else if (isVisible && !document.hidden && renderer && ribbonGroup.children.length > 0) {
            // Re-render single static frame when re-entering viewport
            renderer.render(scene, camera);
          }
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(container);

    const handleVisibilityChange = () => {
      if (document.hidden && rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
        isAnimating = false;
      }
      if (!document.hidden && isVisible && renderer && ribbonGroup.children.length > 0) {
        renderer.render(scene, camera);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup & GPU disposal
    return () => {
      isDisposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerleave', handlePointerLeave);

      disposeObject(scene);

      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
      }
    };
  }, [size, onError]);

  return (
    <div
      ref={containerRef}
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '10px',
        overflow: 'hidden',
        cursor: 'default',
      }}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          display: 'block',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

export default CutlineCanvas;

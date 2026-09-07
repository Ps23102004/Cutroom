import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Cutline } from '../components/cutline/Cutline';

describe('Cutline Component & Procedural 3D Fallback Mesh', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders static raster fallback when prefers-reduced-motion is requested', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion: reduce'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { container } = render(<Cutline size={72} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/assets/3d/fallback/cutline-runtime-fallback.png');
    expect(img?.getAttribute('aria-hidden')).toBe('true');
    expect(img?.getAttribute('alt')).toBe('');
  });

  it('renders static raster fallback when prefers-reduced-transparency is requested', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-transparency: reduce'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { container } = render(<Cutline size={80} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/assets/3d/fallback/cutline-runtime-fallback.png');
    expect(container.querySelector('img')).not.toBeNull();
    expect((container.firstChild as HTMLElement).style.width).toBe('80px');
    expect((container.firstChild as HTMLElement).style.height).toBe('80px');
  });

  it('verifies actual procedural GLB file loads correctly into Three.js scene', async () => {
    // Resolve absolute path to the verified procedural GLB
    const glbPath = path.resolve(__dirname, '../../../../assets/3d/fallback/cutline-ribbon-fallback.glb');
    expect(fs.existsSync(glbPath)).toBe(true);

    const glbBuffer = fs.readFileSync(glbPath);
    expect(glbBuffer.length).toBeGreaterThan(10000);
    expect(glbBuffer.length).toBeLessThan(2000000); // Target <=2MB payload

    // Verify GLB magic header
    expect(glbBuffer.subarray(0, 4).toString()).toBe('glTF');

    // Parse GLTF via Three.js GLTFLoader
    const loader = new GLTFLoader();
    const arrayBuffer = new ArrayBuffer(glbBuffer.byteLength);
    new Uint8Array(arrayBuffer).set(glbBuffer);

    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(arrayBuffer, '', resolve, reject);
    });

    expect(gltf).toBeDefined();
    expect(gltf.scene).toBeDefined();

    let meshFound: THREE.Mesh | null = null;
    gltf.scene.traverse((obj: THREE.Object3D) => {
      if ((obj as THREE.Mesh).isMesh) {
        meshFound = obj as THREE.Mesh;
      }
    });

    expect(meshFound).not.toBeNull();
    const mesh = meshFound!;
    expect(mesh.name).toBe('CutlineRibbon');

    // Topology & vertex verification
    const positionAttr = mesh.geometry.attributes.position;
    expect(positionAttr.count).toBe(776);
    expect(mesh.geometry.index).toBeDefined();
    expect(mesh.geometry.index!.count).toBe(1164); // 388 triangles

    // Verify vertex colors
    const colorAttr = mesh.geometry.attributes.color;
    expect(colorAttr).toBeDefined();
    expect(colorAttr.count).toBe(776);

    // Verify material properties
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material).toBeDefined();
    expect(material.vertexColors).toBe(true);

    // Verify morph target (BendToStraight)
    expect(mesh.geometry.morphAttributes.position).toBeDefined();
    expect(mesh.geometry.morphAttributes.position).toHaveLength(1);
    expect(mesh.morphTargetInfluences).toBeDefined();
    expect(mesh.morphTargetInfluences![0]).toBe(0.0);

    // Verify finite bounding box
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    expect(Number.isFinite(bb.min.x)).toBe(true);
    expect(Number.isFinite(bb.max.x)).toBe(true);
    expect(bb.max.x - bb.min.x).toBeCloseTo(4.8, 1);

    // Verify clean disposal
    mesh.geometry.dispose();
    material.dispose();
  });
});

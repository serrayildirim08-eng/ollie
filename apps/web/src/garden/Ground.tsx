import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { fixMeshyMaterials } from './fixMaterials';

useGLTF.preload('/assets/garden/ground.glb');

interface Patch {
  pos: [number, number, number];
  rot: number;
  scale: number;
  opacity: number;
}

function buildPatches(): Patch[] {
  const out: Patch[] = [];
  let seed = 1;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  // Base grid anchors the floor color. HALF=14 → 29×29 = 841 tiles,
  // balanced for visual density without tanking perf.
  const STEP = 0.7;
  const HALF = 14;
  for (let i = -HALF; i <= HALF; i++) {
    for (let j = -HALF; j <= HALF; j++) {
      out.push({
        pos: [i * STEP + (rand() - 0.5) * 0.2, rand() * 0.015, j * STEP + (rand() - 0.5) * 0.2],
        rot: rand() * Math.PI * 2,
        scale: 0.55 + rand() * 0.25,
        opacity: 0.6 + rand() * 0.3,
      });
    }
  }
  // Fill cloud to feather edges and break grid pattern.
  const REACH = HALF * STEP + 1;
  for (let k = 0; k < 500; k++) {
    out.push({
      pos: [(rand() - 0.5) * 2 * REACH, 0.02 + rand() * 0.04, (rand() - 0.5) * 2 * REACH],
      rot: rand() * Math.PI * 2,
      scale: 0.22 + rand() * 0.28,
      opacity: 0.4 + rand() * 0.45,
    });
  }
  return out;
}

export function Ground() {
  const { scene } = useGLTF('/assets/garden/ground.glb');
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { fixMeshyMaterials(scene); invalidate(); }, [scene, invalidate]);

  const patches = useMemo(buildPatches, []);

  const clones = useMemo(() => {
    return patches.map((p) => {
      const c = scene.clone(true);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.material) return;
        const src = Array.isArray(m.material) ? m.material[0] : m.material;
        const mat = (src as THREE.MeshStandardMaterial).clone();
        mat.transparent = true;
        mat.opacity = p.opacity;
        mat.depthWrite = false;
        mat.alphaTest = 0;
        mat.needsUpdate = true;
        m.material = mat;
      });
      return c;
    });
  }, [patches, scene]);

  return (
    <>
      {/* Solid backdrop so any sub-tile gap reads as deep soil shadow,
          never the canvas behind. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]} receiveShadow>
        <planeGeometry args={[160, 160]} />
        <meshStandardMaterial color="#3D2817" roughness={0.95} metalness={0} />
      </mesh>
      {clones.map((c, i) => (
        <primitive
          key={i}
          object={c}
          position={patches[i].pos}
          rotation={[0, patches[i].rot, 0]}
          scale={patches[i].scale}
          receiveShadow
        />
      ))}
    </>
  );
}

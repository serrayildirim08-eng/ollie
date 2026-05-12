import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF, Clone } from '@react-three/drei';
import * as THREE from 'three';
import { fixMeshyMaterials } from './fixMaterials';

useGLTF.preload('/assets/garden/wooden-fence.glb');

// Fence bbox 1.9m × scale 1.1 = 2.09m wide. Spacing 2.05 = 4cm overlap.
// 7 segments span x ∈ [-6.15, 6.15] ≈ 12.3m so the fence runs edge to
// edge across the camera frame at every zoom level (2 → 4.5).
// Y = 0.85 lifts pivot so the scaled fence base (y=-0.76 local) sits
// just above the soil top (patches reach ~0.1m).
const FENCE_Y = 0.85;
const POSITIONS: { pos: [number, number, number]; rot: number }[] = (() => {
  const arr: { pos: [number, number, number]; rot: number }[] = [];
  for (let i = -20; i <= 20; i++) {
    arr.push({ pos: [i * 2.05, FENCE_Y, -2.3], rot: 0 });
  }
  return arr;
})();

export function Fence() {
  const { scene } = useGLTF('/assets/garden/wooden-fence.glb');
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    fixMeshyMaterials(scene);
    // One-shot color brightening on the shared glb scene. Without the
    // guard a Strict-Mode / HMR re-run compounds the multiplier and the
    // fence walks toward pure white.
    if (!scene.userData.fenceTinted) {
      scene.userData.fenceTinted = true;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.material) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          const sm = mat as THREE.MeshStandardMaterial;
          if (sm.color) sm.color.multiplyScalar(1.4);
          sm.needsUpdate = true;
        }
      });
    }
    invalidate();
  }, [scene, invalidate]);

  return (
    <>
      {POSITIONS.map((f, i) => (
        <Clone
          key={i}
          object={scene}
          position={f.pos}
          rotation={[0, f.rot, 0]}
          scale={1.1}
        />
      ))}
    </>
  );
}

import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF, Instances, Instance } from '@react-three/drei';
import * as THREE from 'three';
import { fixMeshyMaterials } from './fixMaterials';
import { findFirstMesh } from './glbHelpers';

useGLTF.preload('/assets/garden/wooden-fence.glb');

const FENCE_Y = 0.85;
const POSITIONS: [number, number, number][] = (() => {
  const arr: [number, number, number][] = [];
  for (let i = -10; i <= 10; i++) arr.push([i * 2.05, FENCE_Y, -2.3]);
  return arr;
})();

export function Fence() {
  const { scene } = useGLTF('/assets/garden/wooden-fence.glb');
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    fixMeshyMaterials(scene);
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

  const source = useMemo(() => findFirstMesh(scene), [scene]);
  if (!source) return null;

  return (
    <Instances
      geometry={source.geometry}
      material={source.material as THREE.Material}
      limit={POSITIONS.length}
    >
      {POSITIONS.map((pos, i) => (
        <Instance key={i} position={pos} scale={1.1} />
      ))}
    </Instances>
  );
}

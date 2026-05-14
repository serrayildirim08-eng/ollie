import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF, Clone } from '@react-three/drei';
import { fixMeshyMaterials } from './fixMaterials';

useGLTF.preload('/models/garden/tree-ring.glb');

// bbox 1.9 × 0.41 × 1.9m. scale 0.8 → 1.52m diameter ring, 33cm wall.
// z=2.8 aligns with Burhan's forward position.
export function TreeRing() {
  const { scene } = useGLTF('/models/garden/tree-ring.glb');
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { fixMeshyMaterials(scene); invalidate(); }, [scene, invalidate]);
  return (
    <Clone
      object={scene}
      position={[0, 0, 2.8]}
      scale={0.8}
      receiveShadow
    />
  );
}

import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF, Clone } from '@react-three/drei';
import { fixMeshyMaterials } from './fixMaterials';

useGLTF.preload('/assets/garden/path-stone.glb');

interface Stone {
  pos: [number, number, number];
  rot: number;
  scale: number;
}

// Straight row in front of daisies (daisies z≈-1.9, path z=-1.2).
// Spacing 0.7 with scale ~0.42 (0.79m tile) → slight overlap, no gaps.
function buildPath(): Stone[] {
  let seed = 13;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const out: Stone[] = [];
  for (let x = -10.5; x <= 10.5; x += 0.7) {
    out.push({
      pos: [x, 0.02, -1.2 + (rand() - 0.5) * 0.06],
      rot: (rand() - 0.5) * 0.3,
      scale: 0.4 + rand() * 0.06,
    });
  }
  return out;
}

export function Path() {
  const { scene } = useGLTF('/assets/garden/path-stone.glb');
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { fixMeshyMaterials(scene); invalidate(); }, [scene, invalidate]);

  const stones = useMemo(buildPath, []);

  return (
    <>
      {stones.map((s, i) => (
        <Clone
          key={i}
          object={scene}
          position={s.pos}
          rotation={[0, s.rot, 0]}
          scale={s.scale}
          receiveShadow
        />
      ))}
    </>
  );
}

import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF, Clone } from '@react-three/drei';
import { fixMeshyMaterials } from './fixMaterials';

useGLTF.preload('/assets/garden/daisies.glb');

// daisies.glb bbox 1.89 × 0.51 × 1.89m (meadow patch, ~50cm tall).
// Render a row of varying-size patches just in front of the fence
// (fence z=-2.3, daisies z≈-1.9 ±0.2), spanning the full fence width
// so the join reads as naturally overgrown.
interface Patch {
  pos: [number, number, number];
  rot: number;
  scale: number;
}

function buildPatches(): Patch[] {
  let seed = 7;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const out: Patch[] = [];
  for (let i = 0; i < 55; i++) {
    out.push({
      pos: [
        -10.5 + (i / 54) * 21 + (rand() - 0.5) * 0.5,
        0.1 + rand() * 0.05,
        -1.9 + (rand() - 0.5) * 0.5,
      ],
      rot: rand() * Math.PI * 2,
      scale: 0.45 + rand() * 0.4,
    });
  }
  return out;
}

export function Daisies() {
  const { scene } = useGLTF('/assets/garden/daisies.glb');
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { fixMeshyMaterials(scene); invalidate(); }, [scene, invalidate]);

  const patches = useMemo(buildPatches, []);

  return (
    <>
      {patches.map((p, i) => (
        <Clone
          key={i}
          object={scene}
          position={p.pos}
          rotation={[0, p.rot, 0]}
          scale={p.scale}
          receiveShadow
        />
      ))}
    </>
  );
}

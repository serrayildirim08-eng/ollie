import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF, Instances, Instance } from '@react-three/drei';
import * as THREE from 'three';
import { fixMeshyMaterials } from './fixMaterials';
import { findFirstMesh } from './glbHelpers';

useGLTF.preload('/models/garden/daisies.glb');

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
  for (let i = 0; i < 20; i++) {
    out.push({
      pos: [
        -8 + (i / 19) * 16 + (rand() - 0.5) * 0.5,
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
  const { scene } = useGLTF('/models/garden/daisies.glb');
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { fixMeshyMaterials(scene); invalidate(); }, [scene, invalidate]);

  const patches = useMemo(buildPatches, []);
  const source = useMemo(() => findFirstMesh(scene), [scene]);
  if (!source) return null;

  return (
    <Instances
      geometry={source.geometry}
      material={source.material as THREE.Material}
      limit={patches.length}
      receiveShadow
    >
      {patches.map((p, i) => (
        <Instance key={i} position={p.pos} rotation={[0, p.rot, 0]} scale={p.scale} />
      ))}
    </Instances>
  );
}

import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF, Instances, Instance } from '@react-three/drei';
import * as THREE from 'three';
import { fixMeshyMaterials } from './fixMaterials';
import { findFirstMesh } from './glbHelpers';

useGLTF.preload('/models/garden/path-stone.glb');

interface Stone {
  pos: [number, number, number];
  rot: number;
  scale: number;
}

function buildPath(): Stone[] {
  let seed = 13;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const out: Stone[] = [];
  for (let x = -7; x <= 7; x += 0.85) {
    out.push({
      pos: [x, 0.02, -1.2 + (rand() - 0.5) * 0.06],
      rot: (rand() - 0.5) * 0.3,
      scale: 0.4 + rand() * 0.06,
    });
  }
  return out;
}

export function Path() {
  const { scene } = useGLTF('/models/garden/path-stone.glb');
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { fixMeshyMaterials(scene); invalidate(); }, [scene, invalidate]);

  const stones = useMemo(buildPath, []);
  const source = useMemo(() => findFirstMesh(scene), [scene]);
  if (!source) return null;

  return (
    <Instances
      geometry={source.geometry}
      material={source.material as THREE.Material}
      limit={stones.length}
      receiveShadow
    >
      {stones.map((s, i) => (
        <Instance key={i} position={s.pos} rotation={[0, s.rot, 0]} scale={s.scale} />
      ))}
    </Instances>
  );
}

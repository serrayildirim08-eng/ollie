/**
 * apps/web/garden · Daisies — Serra's daisy field, repaired + instanced
 *
 * `daisies.glb` is the ORIGINAL daisy field — same geometry, same textures
 * Serra authored. The raw export was triangle soup: 2.17M vertices across
 * 324K disconnected fragments (~88 MB GPU memory), the cause of the WebGL
 * "context lost" crash. It was repaired offline by a distance-weld (the
 * equivalent of Blender's "Merge by Distance") which reconnected the soup,
 * then simplified — 2.17M → 66K verts, 7.6 MB → 1.1 MB, no visual rebuild.
 *
 * The asset is one ~1.9 m field tile; it's instanced a few times along the
 * back border with rotation jitter so the repeat doesn't read. Original
 * full-resolution export archived in .garden-glb-backup/garden/.
 */

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

/** Field bbox is centre-pivoted (±0.26 in y) — lift so the base grounds. */
function buildPatches(): Patch[] {
  let seed = 7;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const out: Patch[] = [];
  const N = 6;
  for (let i = 0; i < N; i++) {
    const scale = 1.1 + rand() * 0.4;
    out.push({
      pos: [
        -7 + (i / (N - 1)) * 14 + (rand() - 0.5) * 0.8,
        0.26 * scale - 0.05,
        -2.2 + (rand() - 0.5) * 0.9,
      ],
      rot: rand() * Math.PI * 2,
      scale,
    });
  }
  return out;
}

export function Daisies() {
  const { scene } = useGLTF('/models/garden/daisies.glb');
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    fixMeshyMaterials(scene);
    invalidate();
  }, [scene, invalidate]);

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

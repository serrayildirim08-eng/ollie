import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF, Instances, Instance } from '@react-three/drei';
import * as THREE from 'three';
import { fixMeshyMaterials } from './fixMaterials';

useGLTF.preload('/models/garden/ground.glb');

// 5 opacity tiers → 5 InstancedMesh draw calls for the entire floor,
// regardless of patch count. Sharing geometry + per-bucket material is
// what keeps perf O(1) in draw calls.
const OPACITY_BUCKETS = [0.5, 0.65, 0.78, 0.9, 1.0];

interface Patch {
  pos: [number, number, number];
  rot: number;
  scale: number;
  bucket: number;
}

function buildPatches(): Patch[] {
  const out: Patch[] = [];
  let seed = 1;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const STEP = 0.7;
  const HALF = 8;
  for (let i = -HALF; i <= HALF; i++) {
    for (let j = -HALF; j <= HALF; j++) {
      out.push({
        pos: [i * STEP + (rand() - 0.5) * 0.2, rand() * 0.015, j * STEP + (rand() - 0.5) * 0.2],
        rot: rand() * Math.PI * 2,
        scale: 0.55 + rand() * 0.25,
        bucket: Math.min(4, Math.floor(rand() * 5)),
      });
    }
  }
  const REACH = HALF * STEP + 1;
  for (let k = 0; k < 150; k++) {
    out.push({
      pos: [(rand() - 0.5) * 2 * REACH, 0.02 + rand() * 0.04, (rand() - 0.5) * 2 * REACH],
      rot: rand() * Math.PI * 2,
      scale: 0.22 + rand() * 0.28,
      bucket: Math.min(4, Math.floor(rand() * 5)),
    });
  }
  return out;
}

function findFirstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (found) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) found = m;
  });
  return found;
}

export function Ground() {
  const { scene } = useGLTF('/models/garden/ground.glb');
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { fixMeshyMaterials(scene); invalidate(); }, [scene, invalidate]);

  const source = useMemo(() => findFirstMesh(scene), [scene]);

  const bucketMaterials = useMemo(() => {
    if (!source) return [];
    const src = Array.isArray(source.material) ? source.material[0] : source.material;
    return OPACITY_BUCKETS.map((op) => {
      const mat = (src as THREE.MeshStandardMaterial).clone();
      mat.transparent = op < 0.99;
      mat.opacity = op;
      mat.depthWrite = op > 0.95;
      mat.needsUpdate = true;
      return mat;
    });
  }, [source]);

  const patches = useMemo(buildPatches, []);
  const byBucket = useMemo(() => {
    const out: Patch[][] = OPACITY_BUCKETS.map(() => []);
    for (const p of patches) out[p.bucket].push(p);
    return out;
  }, [patches]);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]} receiveShadow>
        <planeGeometry args={[160, 160]} />
        <meshStandardMaterial color="#3D2817" roughness={0.95} metalness={0} />
      </mesh>
      {source && bucketMaterials.length > 0 &&
        OPACITY_BUCKETS.map((_, bIdx) => (
          <Instances
            key={bIdx}
            geometry={source.geometry}
            material={bucketMaterials[bIdx]}
            limit={byBucket[bIdx].length}
            receiveShadow
          >
            {byBucket[bIdx].map((p, i) => (
              <Instance
                key={i}
                position={p.pos}
                rotation={[0, p.rot, 0]}
                scale={p.scale}
              />
            ))}
          </Instances>
        ))}
    </>
  );
}

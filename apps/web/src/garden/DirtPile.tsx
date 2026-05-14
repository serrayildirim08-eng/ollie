import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { fixMeshyMaterials } from './fixMaterials';

useGLTF.preload('/models/garden/dirt-pile.glb');

// Layer one big central pile + 6 smaller satellites around it inside the
// ring. Each instance has its own faded material so the pile edges
// feather into the ring's inner soil instead of cutting a hard mound
// silhouette.
interface Mound {
  pos: [number, number, number];
  rot: number;
  scale: number;
  opacity: number;
}

function buildMounds(): Mound[] {
  let seed = 21;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const out: Mound[] = [
    { pos: [0, 0.02, 2.8], rot: 0, scale: 0.7, opacity: 1.0 },
  ];
  // Ring inner radius (ring scale 0.8 × bbox half 0.95) = ~0.76m.
  // Keep satellites well inside that radius.
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2 + rand() * 0.6;
    const r = 0.25 + rand() * 0.2;
    out.push({
      pos: [Math.cos(t) * r, 0.015 + rand() * 0.02, 2.8 + Math.sin(t) * r],
      rot: rand() * Math.PI * 2,
      scale: 0.32 + rand() * 0.18,
      opacity: 0.5 + rand() * 0.35,
    });
  }
  return out;
}

export function DirtPile() {
  const { scene } = useGLTF('/models/garden/dirt-pile.glb');
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { fixMeshyMaterials(scene); invalidate(); }, [scene, invalidate]);

  const mounds = useMemo(buildMounds, []);

  const clones = useMemo(() => {
    return mounds.map((m) => {
      const c = scene.clone(true);
      c.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const mat = (src as THREE.MeshStandardMaterial).clone();
        mat.transparent = true;
        mat.opacity = m.opacity;
        mat.depthWrite = m.opacity > 0.95;
        mat.alphaTest = 0;
        mat.needsUpdate = true;
        mesh.material = mat;
      });
      return c;
    });
  }, [mounds, scene]);

  return (
    <>
      {clones.map((c, i) => (
        <primitive
          key={i}
          object={c}
          position={mounds[i].pos}
          rotation={[0, mounds[i].rot, 0]}
          scale={mounds[i].scale}
          receiveShadow
        />
      ))}
    </>
  );
}

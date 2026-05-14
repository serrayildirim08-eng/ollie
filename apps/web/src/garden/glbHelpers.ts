import * as THREE from 'three';

export function findFirstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (found) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) found = m;
  });
  return found;
}

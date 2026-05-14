import * as THREE from 'three';

/**
 * Meshy AI assets ship with metallicRoughnessTexture where wood/dirt is
 * tagged metalness≈1. Without an env map those materials render pitch
 * black under directional + ambient lighting. We force metalness to 0
 * and roughness to ~0.85 so the standard 3-point rig actually lights
 * them.
 *
 * One-shot via `userData.fixed`: useGLTF caches the same scene ref
 * across hooks, and multiple components may mutate it. Without the
 * guard we re-traverse on every effect run and (for Fence) compound
 * color tints into white.
 */
export function fixMeshyMaterials(scene: THREE.Object3D): void {
  if (scene.userData.materialsFixed) return;
  scene.userData.materialsFixed = true;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm && 'metalness' in sm) {
        sm.metalness = 0;
        sm.roughness = 0.85;
        sm.metalnessMap = null;
        sm.envMapIntensity = 1;
        sm.needsUpdate = true;
      }
    }
    mesh.receiveShadow = true;
  });
}

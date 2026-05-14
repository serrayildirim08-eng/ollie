import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, Clone } from '@react-three/drei';
import { useStoreSlice } from '../store';
import type { BurhanState } from '@ollie/logic/burhan';
import { fixMeshyMaterials } from './fixMaterials';

useGLTF.preload('/assets/burhan/seedling.glb');
useGLTF.preload('/assets/burhan/young.glb');
useGLTF.preload('/assets/burhan/burhan-v1.glb');

type Stage = 'seedling' | 'sapling' | 'young' | 'mature' | 'ancient';

function getStage(activeDays: number): Stage {
  if (activeDays < 15)  return 'seedling';
  if (activeDays < 61)  return 'sapling';
  if (activeDays < 181) return 'young';
  if (activeDays < 541) return 'mature';
  return 'ancient';
}

// sapling and ancient glbs don't exist yet — fall back to nearest stage.
// Pile peak is ~0.25m above ground (dirt-pile scale 0.7, position y=0.02);
// mature/ancient glbs are center-pivot so add their bbox half-height.
const PILE_PEAK = 0.25;
const STAGES: Record<Stage, { file: string; y: number }> = {
  seedling: { file: '/assets/burhan/seedling.glb',  y: PILE_PEAK },
  sapling:  { file: '/assets/burhan/seedling.glb',  y: PILE_PEAK },
  young:    { file: '/assets/burhan/young.glb',     y: PILE_PEAK },
  mature:   { file: '/assets/burhan/burhan-v1.glb', y: PILE_PEAK + 0.817 },
  ancient:  { file: '/assets/burhan/burhan-v1.glb', y: PILE_PEAK + 0.817 },
};

function computeActiveDays(events: { ts: number }[]): number {
  const days = new Set<string>();
  for (const e of events) days.add(new Date(e.ts).toISOString().slice(0, 10));
  return days.size;
}

export function Burhan() {
  const [burhanState] = useStoreSlice<BurhanState>('burhan', 'state', { events: [] });
  const activeDays = useMemo(() => computeActiveDays(burhanState.events), [burhanState.events]);
  const stage = getStage(activeDays);

  const { scene } = useGLTF(STAGES[stage].file);
  const controls = useThree((s) => s.controls) as { getAzimuthalAngle?: () => number; setAzimuthalAngle?: (a: number) => void; update?: () => void } | null;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { fixMeshyMaterials(scene); invalidate(); }, [scene, invalidate]);

  // Click-to-center: tweens the orbit azimuth back to 0 over a few frames.
  const resetting = useRef(false);
  useFrame(() => {
    if (!resetting.current || !controls?.getAzimuthalAngle || !controls.setAzimuthalAngle) return;
    const cur = controls.getAzimuthalAngle();
    if (Math.abs(cur) < 0.002) {
      controls.setAzimuthalAngle(0);
      controls.update?.();
      resetting.current = false;
      invalidate();
      return;
    }
    controls.setAzimuthalAngle(cur * 0.82);
    controls.update?.();
    invalidate();
  });

  const handleClick = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    resetting.current = true;
    invalidate();
  }, [invalidate]);

  return (
    <group position={[0, 0, 2.8]} onClick={handleClick}>
      {/* Rim light from behind/above catches the leaf edges so Burhan
          reads as its own silhouette against the sky + fence backdrop.
          Soft front fill keeps the trunk from going inky. */}
      <directionalLight position={[-2, 5, -4]} intensity={2.4} color="#fff4d6" />
      <directionalLight position={[1.5, 2, 4]} intensity={0.5} color="#fff8eb" />
      <Clone
        object={scene}
        position={[0, STAGES[stage].y, 0]}
        rotation={[0, -0.1, 0]}
        castShadow
        receiveShadow
      />
    </group>
  );
}

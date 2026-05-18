import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Stats } from '@react-three/drei';
import * as THREE from 'three';
import { Camera } from './Camera';
import { Lighting } from './Lighting';
import { Sky } from './Sky';
import { Ground } from './Ground';
import { Fence } from './Fence';
import { Daisies } from './Daisies';
import { Path } from './Path';
import { TreeRing } from './TreeRing';
import { DirtPile } from './DirtPile';
import { Burhan } from './Burhan';
import { Signboard } from './Signboard';
import { Rain } from './Rain';
import { HabitsZone } from './HabitsZone';

export interface GardenCanvasProps {
  paused: boolean;
  raining: boolean;
  /** Player tapped an empty habits slot — open the plant picker. */
  onSlotClick: (slotId: string) => void;
  /** Player tapped a planted plant — grow it. */
  onPlantClick: (plantingId: string) => void;
}

export default function GardenCanvas({
  paused,
  raining,
  onSlotClick,
  onPlantClick,
}: GardenCanvasProps) {
  const showStats = import.meta.env.DEV && new URLSearchParams(window.location.search).has('stats');

  // WebGL context-loss recovery. Without preventDefault() on `contextlost`
  // the browser will NOT attempt to restore the context — the scene freezes
  // dead (which reads as "nothing is clickable"). preventDefault() opts into
  // restoration; on `contextrestored` we kick a re-render.
  const handleCreated = (state: { gl: THREE.WebGLRenderer; invalidate: () => void }) => {
    const canvas = state.gl.domElement;
    canvas.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault();
        console.warn('[GardenCanvas] WebGL context lost — awaiting restore');
      },
      false,
    );
    canvas.addEventListener(
      'webglcontextrestored',
      () => {
        console.warn('[GardenCanvas] WebGL context restored');
        state.invalidate();
      },
      false,
    );
  };

  return (
    <Canvas
      dpr={[1, 1.25]}
      frameloop={paused ? 'never' : raining || showStats ? 'always' : 'demand'}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, powerPreference: 'high-performance' }}
      onCreated={handleCreated}
      style={{ width: '100%', height: '100%', display: 'block', background: '#f5f4f0' }}
    >
      {showStats && <Stats />}
      <Camera />
      <Lighting />
      <Suspense fallback={null}>
        <Environment preset="sunset" background={false} resolution={32} />
        <Sky />
        <Ground />
        <Fence />
        <Daisies />
        <Path />
        <TreeRing />
        <DirtPile />
        <Burhan />
        <HabitsZone onSlotClick={onSlotClick} onPlantClick={onPlantClick} />
        <Signboard />
        <Rain active={raining} center={[0, 3.5, 0]} radius={5} count={600} />
      </Suspense>
    </Canvas>
  );
}

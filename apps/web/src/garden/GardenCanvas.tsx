import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
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

export interface GardenCanvasProps {
  paused: boolean;
  raining: boolean;
}

export default function GardenCanvas({ paused, raining }: GardenCanvasProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      frameloop={paused ? 'never' : raining ? 'always' : 'demand'}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      style={{ width: '100%', height: '100%', display: 'block', background: '#f5f4f0' }}
    >
      <Camera />
      <Lighting />
      <Suspense fallback={null}>
        <Environment preset="sunset" background={false} resolution={64} />
        <Sky />
        <Ground />
        <Fence />
        <Daisies />
        <Path />
        <TreeRing />
        <DirtPile />
        <Burhan />
        <Signboard />
        <Rain active={raining} center={[0, 3.5, 0]} radius={5} count={1200} />
      </Suspense>
    </Canvas>
  );
}

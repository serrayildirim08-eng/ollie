import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, Bounds, Center } from '@react-three/drei';
import type { Group } from 'three';

// Begin fetching the model as soon as this chunk loads.
useGLTF.preload('/models/burhan.glb');

const ROTATION_PERIOD_SECONDS = 8;
const ROTATION_SPEED = (Math.PI * 2) / ROTATION_PERIOD_SECONDS;
const SWAY_AMPLITUDE = 0.018;
const SWAY_FREQUENCY = 0.6;

function Model({ rotating, swaying }: { rotating: boolean; swaying: boolean }) {
  const { scene } = useGLTF('/models/burhan.glb');
  const groupRef = useRef<Group>(null);

  // Clone so we don't mutate the cached source on remount.
  const cloned = useMemo(() => scene.clone(true), [scene]);

  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    if (rotating) g.rotation.y += ROTATION_SPEED * delta;
    if (swaying) {
      g.rotation.z = Math.sin(state.clock.elapsedTime * SWAY_FREQUENCY) * SWAY_AMPLITUDE;
    } else {
      g.rotation.z = 0;
    }
  });

  return (
    <group ref={groupRef}>
      <Center>
        <primitive object={cloned} />
      </Center>
    </group>
  );
}

export interface Burhan3DCanvasProps {
  width: number;
  height: number;
  reducedMotion: boolean;
  paused: boolean;
}

export default function Burhan3DCanvas({
  width,
  height,
  reducedMotion,
  paused,
}: Burhan3DCanvasProps) {
  const rotating = !reducedMotion && !paused;
  const swaying = !reducedMotion && !paused;
  const frameloop = paused ? 'never' : rotating || swaying ? 'always' : 'demand';

  return (
    <Canvas
      dpr={[1, 2]}
      frameloop={frameloop}
      camera={{ position: [0, 0.3, 4.2], fov: 35 }}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: true }}
      style={{ width, height, background: '#F5F4F0' }}
    >
      {/* Warm cream ambient + golden-hour key light */}
      <ambientLight intensity={0.85} color="#FFF1D9" />
      <directionalLight
        position={[3.5, 4.5, 2.5]}
        intensity={1.5}
        color="#FFD7A0"
      />
      {/* Cool fill from behind to keep silhouette readable */}
      <directionalLight
        position={[-2.5, 1.5, -2]}
        intensity={0.35}
        color="#DDE8F0"
      />
      <Suspense fallback={null}>
        <Bounds fit clip observe margin={1.15}>
          <Model rotating={rotating} swaying={swaying} />
        </Bounds>
      </Suspense>
    </Canvas>
  );
}

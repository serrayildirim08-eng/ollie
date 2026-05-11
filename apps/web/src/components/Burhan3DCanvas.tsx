import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, Bounds, Center } from '@react-three/drei';
import type { Group } from 'three';

// Begin fetching the model as soon as this chunk loads.
useGLTF.preload('/models/burhan.glb');

const SWAY_AMPLITUDE = 0.018;
const SWAY_FREQUENCY = 0.6;

function Model({ swaying }: { swaying: boolean }) {
  const { scene } = useGLTF('/models/burhan.glb');
  const groupRef = useRef<Group>(null);

  // Clone so we don't mutate the cached source on remount.
  const cloned = useMemo(() => scene.clone(true), [scene]);

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
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
  const swaying = !reducedMotion && !paused;
  const frameloop = paused ? 'never' : swaying ? 'always' : 'demand';

  return (
    <Canvas
      dpr={[1, 2]}
      frameloop={frameloop}
      camera={{ position: [0, 0.3, 4.2], fov: 35 }}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: true, premultipliedAlpha: false }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      style={{ width, height, background: 'transparent' }}
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
          <Model swaying={swaying} />
        </Bounds>
      </Suspense>
    </Canvas>
  );
}

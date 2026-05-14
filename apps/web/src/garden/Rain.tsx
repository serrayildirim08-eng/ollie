import { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface Props {
  active: boolean;
  duration?: number;
  center?: [number, number, number];
  radius?: number;
  count?: number;
}

export function Rain({ active, duration = 3000, center = [0, 3, 0], radius = 1.0, count = 400 }: Props) {
  const points = useRef<THREE.Points>(null);
  const [enabled, setEnabled] = useState(false);
  const invalidate = useThree((s) => s.invalidate);

  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      arr[i * 3]     = center[0] + Math.cos(theta) * r;
      arr[i * 3 + 1] = center[1] + Math.random() * 3.5;
      arr[i * 3 + 2] = center[2] + Math.sin(theta) * r;
    }
    return arr;
  }, [center, radius, count]);

  useEffect(() => {
    if (!active) return;
    setEnabled(true);
    const t = setTimeout(() => setEnabled(false), duration);
    return () => clearTimeout(t);
  }, [active, duration]);

  useFrame(() => {
    if (!enabled || !points.current) return;
    const arr = points.current.geometry.attributes.position.array as Float32Array;
    for (let i = 1; i < arr.length; i += 3) {
      arr[i] -= 0.06;
      if (arr[i] < 0.25) arr[i] = center[1] + 1.5;
    }
    points.current.geometry.attributes.position.needsUpdate = true;
    invalidate();
  });

  if (!enabled) return null;

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={positions}
          count={count}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.035}
        color="#a8c8e8"
        transparent
        opacity={0.75}
        sizeAttenuation
      />
    </points>
  );
}

import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF, Text } from '@react-three/drei';
import { fixMeshyMaterials } from './fixMaterials';

useGLTF.preload('/models/garden/signboard.glb');

export function Signboard() {
  const { scene } = useGLTF('/models/garden/signboard.glb');
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => { fixMeshyMaterials(cloned); invalidate(); }, [cloned, invalidate]);

  return (
    <group position={[0.25, 0.42, 3.35]} rotation={[0, 0.25, 0]}>
      <primitive object={cloned} scale={0.45} castShadow />
      <Text
        fontSize={0.12}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
        position={[0, 0.28, 0.07]}
        outlineWidth={0.006}
        outlineColor="#3a2412"
      >
        ollie
      </Text>
    </group>
  );
}

import { PerspectiveCamera, OrbitControls } from '@react-three/drei';

export function Camera() {
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 2.4, 9]} fov={42} near={0.1} far={50} />
      <OrbitControls
        makeDefault
        target={[0, 0.5, 0]}
        enableRotate
        enablePan={false}
        enableZoom
        minDistance={5}
        maxDistance={11}
        minAzimuthAngle={-Math.PI / 9}
        maxAzimuthAngle={Math.PI / 9}
        minPolarAngle={Math.PI * 0.45}
        maxPolarAngle={Math.PI * 0.45}
        rotateSpeed={2.5}
        zoomSpeed={1.4}
        enableDamping
        dampingFactor={0.08}
      />
    </>
  );
}

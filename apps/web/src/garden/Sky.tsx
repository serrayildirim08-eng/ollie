import { Sky as DreiSky } from '@react-three/drei';

export function Sky() {
  return (
    <DreiSky
      distance={450000}
      sunPosition={[5, 2, -8]}
      inclination={0.49}
      azimuth={0.25}
      turbidity={6}
      rayleigh={2}
      mieCoefficient={0.005}
      mieDirectionalG={0.8}
    />
  );
}

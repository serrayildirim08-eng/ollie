export function Lighting() {
  return (
    <>
      <ambientLight intensity={0.6} color="#fff8eb" />
      <directionalLight position={[4, 6, 3]} intensity={1.1} color="#ffe8b0" />
      <directionalLight position={[-3, 2, -2]} intensity={0.3} color="#d0e0ff" />
      <hemisphereLight args={['#fff5d0', '#a89060', 0.4]} />
    </>
  );
}

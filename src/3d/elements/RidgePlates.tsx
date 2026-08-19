import React, { useMemo } from 'react';
import { plateMaterial } from '../materials';
import type { ConnectionPlateResults } from '../../types';

interface RidgePlatesProps {
  span: number;
  columnSpacing: number;
  numberOfFrames: number;
  ridgeHeight: number;
  connectionPlates: ConnectionPlateResults;
}

/**
 * Renders vertical ridge plates at the apex (ridge point) of each frame.
 * Positioned at Y=ridgeHeight, Z=span/2, oriented vertically.
 * 1 per frame.
 */
export const RidgePlates = React.memo(function RidgePlates({
  span,
  columnSpacing,
  numberOfFrames,
  ridgeHeight,
  connectionPlates,
}: RidgePlatesProps) {
  const { width, height, thickness } = connectionPlates.ridgePlate;

  // Convert mm to meters
  const plateW = width / 1000;
  const plateH = height / 1000;
  const plateT = Math.max(thickness / 1000, 0.05);

  const positions = useMemo(() => {
    const pos: number[] = [];
    for (let i = 0; i < numberOfFrames; i++) {
      pos.push(i * columnSpacing);
    }
    return pos;
  }, [numberOfFrames, columnSpacing]);

  return (
    <group name="ridge-plates">
      {positions.map((x, i) => (
        <mesh
          key={i}
          material={plateMaterial}
          position={[x, ridgeHeight, span / 2]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[plateW, plateH, plateT]} />
        </mesh>
      ))}
    </group>
  );
});

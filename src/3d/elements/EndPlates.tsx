import React, { useMemo } from 'react';
import { plateMaterial } from '../materials';
import type { ConnectionPlateResults } from '../../types';

interface EndPlatesProps {
  wallHeight: number;
  span: number;
  columnSpacing: number;
  numberOfFrames: number;
  connectionPlates: ConnectionPlateResults;
  rafterType: 'ipe' | 'truss';
  columnFlangeOffset: number;
  roofAngle: number;
}

/**
 * Renders end plates (column-to-rafter connection) at the top of each side column.
 * Only rendered when rafterType === 'ipe' (IPE rafter).
 * When truss is active, TrussColumnHead provides its own end plates.
 * Positioned at Y=wallHeight, oriented in the YZ plane (flat face visible from building side),
 * tilted by roofAngle to be perpendicular to the rafter.
 * 2 per frame (one at Z=columnFlangeOffset, one at Z=span-columnFlangeOffset).
 */
export const EndPlates = React.memo(function EndPlates({
  wallHeight,
  span,
  columnSpacing,
  numberOfFrames,
  connectionPlates,
  rafterType,
  columnFlangeOffset,
  roofAngle,
}: EndPlatesProps) {
  // When truss is active, do not render end plates (TrussColumnHead has its own)
  if (rafterType === 'truss') {
    return null;
  }

  const { width, height, thickness } = connectionPlates.endPlate;

  const roofAngleRad = (roofAngle * Math.PI) / 180;

  // Convert mm to meters, ensure minimum 0.3m height
  const plateW = width / 1000;
  const plateH = Math.max(height / 1000, 0.3);
  const plateT = thickness / 1000;

  const positions = useMemo(() => {
    const pos: Array<{ x: number; z: number; side: 'left' | 'right' }> = [];
    for (let i = 0; i < numberOfFrames; i++) {
      const x = i * columnSpacing;
      pos.push({ x, z: columnFlangeOffset, side: 'left' });
      pos.push({ x, z: span - columnFlangeOffset, side: 'right' });
    }
    return pos;
  }, [numberOfFrames, columnSpacing, span, columnFlangeOffset]);

  return (
    <group name="end-plates">
      {positions.map((pos, i) => (
        <mesh
          key={i}
          material={plateMaterial}
          position={[pos.x, wallHeight, pos.z]}
          rotation={[
            pos.side === 'left' ? -roofAngleRad : roofAngleRad,
            Math.PI / 2,
            0,
          ]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[plateW, plateH, plateT]} />
        </mesh>
      ))}
    </group>
  );
});

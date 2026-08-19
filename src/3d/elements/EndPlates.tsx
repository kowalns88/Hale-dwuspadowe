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
}

/**
 * Renders end plates (column-to-rafter connection) at the top of each side column.
 * Only rendered when rafterType === 'ipe' (IPE rafter).
 * When truss is active, TrussColumnHead provides its own end plates.
 * Positioned at Y=wallHeight, perpendicular to the Z axis (thin in X, wide in Z).
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
}: EndPlatesProps) {
  // When truss is active, do not render end plates (TrussColumnHead has its own)
  if (rafterType === 'truss') {
    return null;
  }

  const { width, height, thickness } = connectionPlates.endPlate;

  // Convert mm to meters, ensure minimum 0.3m height
  const plateW = width / 1000;
  const plateH = Math.max(height / 1000, 0.3);
  const plateT = thickness / 1000;

  const positions = useMemo(() => {
    const pos: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < numberOfFrames; i++) {
      const x = i * columnSpacing;
      pos.push({ x, z: columnFlangeOffset });
      pos.push({ x, z: span - columnFlangeOffset });
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
          rotation={[0, 0, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[plateW, plateH, plateT]} />
        </mesh>
      ))}
    </group>
  );
});

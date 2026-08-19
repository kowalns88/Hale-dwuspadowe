import React, { useMemo } from 'react';
import { useIBeamGeometry } from '../profiles/IBeamGeometry';
import { columnMaterial } from '../materials';
import type { SteelProfile } from '../../types';

interface SideColumnsProps {
  profile: SteelProfile;
  wallHeight: number;
  span: number;
  columnSpacing: number;
  numberOfFrames: number;
  columnFlangeOffset: number;
}

export const SideColumns = React.memo(function SideColumns({
  profile,
  wallHeight,
  span,
  columnSpacing,
  numberOfFrames,
}: SideColumnsProps) {
  const h = profile.h / 1000;
  const b = profile.b / 1000;
  const tw = (profile.tw ?? 7) / 1000;
  const tf = (profile.tf ?? 11) / 1000;

  const columnHeight = wallHeight;

  const geometry = useIBeamGeometry({ h, b, tw, tf, length: columnHeight });

  const positions = useMemo(() => {
    const pos: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < numberOfFrames; i++) {
      const x = i * columnSpacing;
      pos.push({ x, z: 0 });
      pos.push({ x, z: span });
    }
    return pos;
  }, [numberOfFrames, columnSpacing, span]);

  return (
    <group name="side-columns">
      {positions.map((pos, i) => (
        <mesh
          key={i}
          geometry={geometry}
          material={columnMaterial}
          position={[pos.x, 0, pos.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
});

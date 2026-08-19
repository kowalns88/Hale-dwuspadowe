import React from 'react';
import { useRHSGeometry } from '../profiles/RHSGeometry';
import { girtMaterial } from '../materials';
import type { SteelProfile } from '../../types';

interface EaveBeamsProps {
  profile: SteelProfile;
  wallHeight: number;
  span: number;
  hallLength: number;
}

/**
 * Renders two RHS eave beams running along the full building length (X direction)
 * at Y=wallHeight on both sides (Z=0 and Z=span).
 *
 * The RHS geometry extrudes along Z axis. To make beams run along X,
 * we create geometry with length=hallLength and rotate [0, Math.PI/2, 0].
 */
export const EaveBeams = React.memo(function EaveBeams({
  profile,
  wallHeight,
  span,
  hallLength,
}: EaveBeamsProps) {
  const width = profile.b / 1000;
  const height = profile.h / 1000;
  const thickness = (profile.t ?? 4) / 1000;

  const geometry = useRHSGeometry({ width, height, thickness, length: hallLength });

  return (
    <group name="eave-beams">
      {/* Eave beam on Z=0 side (offset inward to avoid column overlap) */}
      <mesh
        geometry={geometry}
        material={girtMaterial}
        position={[0, wallHeight, 0.08]}
        rotation={[0, Math.PI / 2, 0]}
        castShadow
        receiveShadow
      />
      {/* Eave beam on Z=span side (offset inward to avoid column overlap) */}
      <mesh
        geometry={geometry}
        material={girtMaterial}
        position={[0, wallHeight, span - 0.08]}
        rotation={[0, Math.PI / 2, 0]}
        castShadow
        receiveShadow
      />
    </group>
  );
});

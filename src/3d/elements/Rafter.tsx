import React, { useMemo } from 'react';
import { useIBeamGeometry } from '../profiles/IBeamGeometry';
import { rafterMaterial } from '../materials';
import type { SteelProfile } from '../../types';

interface RafterProps {
  profile: SteelProfile;
  wallHeight: number;
  span: number;
  roofAngle: number;
  columnSpacing: number;
  numberOfFrames: number;
  columnFlangeOffset: number;
}

/**
 * Renders IPE rafters for span <= 18m.
 * Each frame has a pair of rafters going from wall top to ridge.
 * Left rafter: from (X, wallHeight, columnFlangeOffset) to (X, ridgeHeight, span/2)
 * Right rafter: mirror
 * The columnFlangeOffset shifts the start inward so the rafter does not
 * penetrate the inner flange of the side column.
 */
export const Rafter = React.memo(function Rafter({
  profile,
  wallHeight,
  span,
  roofAngle,
  columnSpacing,
  numberOfFrames,
  columnFlangeOffset,
}: RafterProps) {
  const h = profile.h / 1000;
  const b = profile.b / 1000;
  const tw = (profile.tw ?? 7) / 1000;
  const tf = (profile.tf ?? 11) / 1000;

  const ridgePlateGap = -0.02; // negative — rafter extends 20mm past ridge axis (overlap hidden by ridge plate)
  const effectiveHalfSpanZ = span / 2 - columnFlangeOffset - ridgePlateGap;
  const roofAngleRad = (roofAngle * Math.PI) / 180;
  const slopeLength = effectiveHalfSpanZ / Math.cos(roofAngleRad);
  const geometry = useIBeamGeometry({ h, b, tw, tf, length: slopeLength });

  const framePositions = useMemo(() => {
    const positions: number[] = [];
    for (let i = 0; i < numberOfFrames; i++) {
      positions.push(i * columnSpacing);
    }
    return positions;
  }, [numberOfFrames, columnSpacing]);

  return (
    <group name="rafters">
      {framePositions.map((x, i) => (
        <group key={i} position={[x, wallHeight, 0]}>
          {/* Left rafter (Z=columnFlangeOffset to Z=span/2) */}
          <mesh
            geometry={geometry}
            material={rafterMaterial}
            position={[0, 0, columnFlangeOffset]}
            rotation={[-roofAngleRad, 0, 0]}
            castShadow
            receiveShadow
          />
          {/* Right rafter (Z=span-columnFlangeOffset to Z=span/2) - mirror */}
          <mesh
            geometry={geometry}
            material={rafterMaterial}
            position={[0, 0, span - columnFlangeOffset]}
            rotation={[roofAngleRad, Math.PI, 0]}
            castShadow
            receiveShadow
          />
        </group>
      ))}
    </group>
  );
});

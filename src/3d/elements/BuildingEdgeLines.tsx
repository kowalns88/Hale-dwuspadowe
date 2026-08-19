import React, { useMemo } from 'react';
import * as THREE from 'three';
import { getRALHex } from '../../data/colors';

interface BuildingEdgeLinesProps {
  span: number;
  hallLength: number;
  wallHeight: number;
  roofAngle: number; // degrees
  columnOuterFlangeOffset: number;
  endColumnOuterOffset: number;
  sideWallThicknessOffset: number;
  endWallThicknessOffset: number;
  flashingColor: string; // RAL code
  eaveOverhang: number; // meters
}

/**
 * Renders architectural sheet metal flashings (obrobki blacharskie) at building edges
 * using simple BoxGeometry for correct and predictable positioning:
 * - Ridge cap (kalenica): flat strip along the ridge
 * - Eave trims (okap): vertical strips along both eaves
 * - Corner trims (narozniki): L-shaped vertical strips at 4 corners
 * - Gable edge trims: tilted strips along roof slope edges on gable ends
 */
export const BuildingEdgeLines = React.memo(function BuildingEdgeLines({
  span,
  hallLength,
  wallHeight,
  roofAngle,
  columnOuterFlangeOffset,
  endColumnOuterOffset,
  sideWallThicknessOffset,
  endWallThicknessOffset,
  flashingColor,
  eaveOverhang,
}: BuildingEdgeLinesProps) {
  const roofAngleRad = (roofAngle * Math.PI) / 180;

  // Key coordinates
  const sideOffset = columnOuterFlangeOffset + sideWallThicknessOffset;
  const endOffset = endColumnOuterOffset + endWallThicknessOffset;

  // Wall boundaries
  const xMin = -endOffset;
  const xMax = hallLength + endOffset;
  const zMin = -sideOffset;
  const zMax = span + sideOffset;

  // Building total length along X
  const buildingLength = xMax - xMin;

  // Roof geometry
  const ridgeY = wallHeight + (span / 2) * Math.tan(roofAngleRad);
  const ridgeTriangleHeight = ridgeY - wallHeight;
  const roofSlopeLength = (span / 2) / Math.cos(roofAngleRad);
  const slopeLen = roofSlopeLength + eaveOverhang;

  // Shared material for all flashings
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: getRALHex(flashingColor),
      metalness: 0.3,
      roughness: 0.6,
      side: THREE.DoubleSide,
    });
  }, [flashingColor]);

  return (
    <group>
      {/* ===== Ridge Cap (kalenica) ===== */}
      {/* Flat strip sitting on top of the ridge */}
      <mesh
        position={[hallLength / 2, ridgeY + 0.003, span / 2]}
        material={material}
        castShadow
      >
        <boxGeometry args={[buildingLength + 0.1, 0.005, 0.300]} />
      </mesh>

      {/* ===== Eave Trims (okap) ===== */}
      {/* Left eave (Z = zMin side) - vertical strip along building length */}
      <mesh
        position={[hallLength / 2, wallHeight - 0.075, zMin - 0.003]}
        material={material}
        castShadow
      >
        <boxGeometry args={[buildingLength + 0.1, 0.150, 0.005]} />
      </mesh>
      {/* Right eave (Z = zMax side) - vertical strip along building length */}
      <mesh
        position={[hallLength / 2, wallHeight - 0.075, zMax + 0.003]}
        material={material}
        castShadow
      >
        <boxGeometry args={[buildingLength + 0.1, 0.150, 0.005]} />
      </mesh>

      {/* ===== Corner Trims (narozniki) ===== */}
      {/* Each corner has 2 boxes forming an L-shape */}

      {/* Front-left corner */}
      <mesh
        position={[xMin, wallHeight / 2, zMin - 0.003]}
        material={material}
        castShadow
      >
        <boxGeometry args={[0.080, wallHeight, 0.005]} />
      </mesh>
      <mesh
        position={[xMin - 0.003, wallHeight / 2, zMin]}
        material={material}
        castShadow
      >
        <boxGeometry args={[0.005, wallHeight, 0.080]} />
      </mesh>

      {/* Front-right corner */}
      <mesh
        position={[xMin, wallHeight / 2, zMax + 0.003]}
        material={material}
        castShadow
      >
        <boxGeometry args={[0.080, wallHeight, 0.005]} />
      </mesh>
      <mesh
        position={[xMin - 0.003, wallHeight / 2, zMax]}
        material={material}
        castShadow
      >
        <boxGeometry args={[0.005, wallHeight, 0.080]} />
      </mesh>

      {/* Back-left corner */}
      <mesh
        position={[xMax, wallHeight / 2, zMin - 0.003]}
        material={material}
        castShadow
      >
        <boxGeometry args={[0.080, wallHeight, 0.005]} />
      </mesh>
      <mesh
        position={[xMax + 0.003, wallHeight / 2, zMin]}
        material={material}
        castShadow
      >
        <boxGeometry args={[0.005, wallHeight, 0.080]} />
      </mesh>

      {/* Back-right corner */}
      <mesh
        position={[xMax, wallHeight / 2, zMax + 0.003]}
        material={material}
        castShadow
      >
        <boxGeometry args={[0.080, wallHeight, 0.005]} />
      </mesh>
      <mesh
        position={[xMax + 0.003, wallHeight / 2, zMax]}
        material={material}
        castShadow
      >
        <boxGeometry args={[0.005, wallHeight, 0.080]} />
      </mesh>

      {/* ===== Gable Edge Trims (krawedzie szczytowe dachu) ===== */}
      {/* Front gable - left slope (from eave at zMin up to ridge) */}
      <mesh
        position={[xMin - 0.003, wallHeight + ridgeTriangleHeight / 2, zMin + span / 4]}
        rotation={[-roofAngleRad, 0, 0]}
        material={material}
        castShadow
      >
        <boxGeometry args={[0.005, 0.080, slopeLen]} />
      </mesh>

      {/* Front gable - right slope (from eave at zMax up to ridge) */}
      <mesh
        position={[xMin - 0.003, wallHeight + ridgeTriangleHeight / 2, zMax - span / 4]}
        rotation={[roofAngleRad, 0, 0]}
        material={material}
        castShadow
      >
        <boxGeometry args={[0.005, 0.080, slopeLen]} />
      </mesh>

      {/* Back gable - left slope */}
      <mesh
        position={[xMax + 0.003, wallHeight + ridgeTriangleHeight / 2, zMin + span / 4]}
        rotation={[-roofAngleRad, 0, 0]}
        material={material}
        castShadow
      >
        <boxGeometry args={[0.005, 0.080, slopeLen]} />
      </mesh>

      {/* Back gable - right slope */}
      <mesh
        position={[xMax + 0.003, wallHeight + ridgeTriangleHeight / 2, zMax - span / 4]}
        rotation={[roofAngleRad, 0, 0]}
        material={material}
        castShadow
      >
        <boxGeometry args={[0.005, 0.080, slopeLen]} />
      </mesh>
    </group>
  );
});

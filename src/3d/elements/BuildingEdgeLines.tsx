import React, { useEffect, useMemo } from 'react';
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

// Flashing dimensions (meters)
const RIDGE_CAP_HALF_WIDTH = 0.150; // 150mm per side (300mm total cap width)
const RIDGE_CAP_THICKNESS = 0.005; // 5mm thick

const EAVE_VERTICAL_LEG = 0.150; // 150mm
const EAVE_HORIZONTAL_LEG = 0.050; // 50mm
const EAVE_THICKNESS = 0.002; // 2mm

const CORNER_LEG = 0.080; // 80mm per leg
const CORNER_THICKNESS = 0.002; // 2mm

const GABLE_LEG_A = 0.050; // 50mm
const GABLE_LEG_B = 0.050; // 50mm
const GABLE_THICKNESS = 0.002; // 2mm

/**
 * Creates a V-shaped cross-section shape for ridge cap flashing.
 * The V opens downward, matching the roof angle.
 */
function createRidgeCapShape(roofAngleRad: number): THREE.Shape {
  const shape = new THREE.Shape();
  const halfWidth = RIDGE_CAP_HALF_WIDTH;
  const t = RIDGE_CAP_THICKNESS;

  // V-shape: two legs meeting at center, opening downward
  // Left leg goes from center downward-left at roof angle
  // Right leg goes from center downward-right at roof angle
  const leftDx = -halfWidth * Math.cos(roofAngleRad);
  const leftDy = -halfWidth * Math.sin(roofAngleRad);
  const rightDx = halfWidth * Math.cos(roofAngleRad);
  const rightDy = -halfWidth * Math.sin(roofAngleRad);

  // Outer V (top surface)
  shape.moveTo(0, 0); // apex
  shape.lineTo(leftDx, leftDy); // left tip outer
  // Offset inward by thickness (perpendicular to the leg surface)
  const normalLeftX = Math.sin(roofAngleRad);
  const normalLeftY = -Math.cos(roofAngleRad);
  shape.lineTo(leftDx - normalLeftX * t, leftDy - normalLeftY * t);
  // Inner apex
  shape.lineTo(0, -t / Math.cos(roofAngleRad));
  // Inner right
  const normalRightX = -Math.sin(roofAngleRad);
  const normalRightY = -Math.cos(roofAngleRad);
  shape.lineTo(rightDx - normalRightX * t, rightDy - normalRightY * t);
  // Right tip outer
  shape.lineTo(rightDx, rightDy);
  shape.lineTo(0, 0); // close

  return shape;
}

/**
 * Creates an L-shaped cross-section shape for eave trims.
 * Vertical leg goes down, horizontal leg goes outward.
 */
function createEaveTrimShape(): THREE.Shape {
  const shape = new THREE.Shape();
  const vLeg = EAVE_VERTICAL_LEG;
  const hLeg = EAVE_HORIZONTAL_LEG;
  const t = EAVE_THICKNESS;

  // Start at top-left corner of vertical leg
  shape.moveTo(0, 0);
  shape.lineTo(t, 0);
  shape.lineTo(t, -(vLeg - t));
  shape.lineTo(hLeg, -(vLeg - t));
  shape.lineTo(hLeg, -vLeg);
  shape.lineTo(0, -vLeg);
  shape.lineTo(0, 0);

  return shape;
}

/**
 * Creates an L-shaped cross-section for corner trims.
 * Two equal legs at 90 degrees.
 */
function createCornerTrimShape(): THREE.Shape {
  const shape = new THREE.Shape();
  const leg = CORNER_LEG;
  const t = CORNER_THICKNESS;

  // L shape: vertical leg up, horizontal leg right
  shape.moveTo(0, 0);
  shape.lineTo(leg, 0);
  shape.lineTo(leg, t);
  shape.lineTo(t, t);
  shape.lineTo(t, leg);
  shape.lineTo(0, leg);
  shape.lineTo(0, 0);

  return shape;
}

/**
 * Creates an L-shaped cross-section for gable edge trims.
 */
function createGableEdgeTrimShape(): THREE.Shape {
  const shape = new THREE.Shape();
  const legA = GABLE_LEG_A;
  const legB = GABLE_LEG_B;
  const t = GABLE_THICKNESS;

  shape.moveTo(0, 0);
  shape.lineTo(legA, 0);
  shape.lineTo(legA, t);
  shape.lineTo(t, t);
  shape.lineTo(t, legB);
  shape.lineTo(0, legB);
  shape.lineTo(0, 0);

  return shape;
}

/**
 * Renders architectural sheet metal flashings (obrobki blacharskie) at building edges:
 * - Ridge cap (kalenica): V-shaped along ridge
 * - Eave trims (okap): L-shaped along both eaves
 * - Corner trims (narozniki): L-shaped vertical strips at 4 corners
 * - Gable edge trims: L-shaped along roof slope edges on gable ends
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

  // Material for all flashings
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: getRALHex(flashingColor),
      metalness: 0.4,
      roughness: 0.5,
      side: THREE.DoubleSide,
    });
  }, [flashingColor]);

  // Key coordinates
  const sideOffset = columnOuterFlangeOffset + sideWallThicknessOffset;
  const endOffset = endColumnOuterOffset + endWallThicknessOffset;

  // Wall boundaries
  const xMin = -endOffset;
  const xMax = hallLength + endOffset;
  const zMin = -sideOffset;
  const zMax = span + sideOffset;

  // Eave trim length covers entire building length including end wall offsets
  const eaveTrimLength = xMax - xMin;

  // Roof geometry
  const ridgeY = wallHeight + (span / 2) * Math.tan(roofAngleRad);
  const ridgeZ = span / 2;
  const roofSlopeLength = (span / 2) / Math.cos(roofAngleRad);

  // Ridge cap length extends the full building length
  const ridgeCapLength = eaveTrimLength;

  // ===== Ridge Cap Geometry =====
  const ridgeCapGeometry = useMemo(() => {
    const shape = createRidgeCapShape(roofAngleRad);
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      steps: 1,
      depth: ridgeCapLength,
      bevelEnabled: false,
    };
    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
  }, [roofAngleRad, ridgeCapLength]);

  // ===== Eave Trim Geometry =====
  const eaveTrimGeometry = useMemo(() => {
    const shape = createEaveTrimShape();
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      steps: 1,
      depth: eaveTrimLength,
      bevelEnabled: false,
    };
    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
  }, [eaveTrimLength]);

  // ===== Corner Trim Geometry =====
  const cornerTrimGeometry = useMemo(() => {
    const shape = createCornerTrimShape();
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      steps: 1,
      depth: wallHeight,
      bevelEnabled: false,
    };
    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
  }, [wallHeight]);

  // ===== Gable Edge Trim Geometry =====
  const gableEdgeTrimGeometry = useMemo(() => {
    const shape = createGableEdgeTrimShape();
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      steps: 1,
      depth: roofSlopeLength + eaveOverhang,
      bevelEnabled: false,
    };
    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
  }, [roofSlopeLength, eaveOverhang]);

  // Dispose geometries and material on unmount or when dependencies change
  useEffect(() => {
    return () => {
      ridgeCapGeometry.dispose();
    };
  }, [ridgeCapGeometry]);

  useEffect(() => {
    return () => {
      eaveTrimGeometry.dispose();
    };
  }, [eaveTrimGeometry]);

  useEffect(() => {
    return () => {
      cornerTrimGeometry.dispose();
    };
  }, [cornerTrimGeometry]);

  useEffect(() => {
    return () => {
      gableEdgeTrimGeometry.dispose();
    };
  }, [gableEdgeTrimGeometry]);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  return (
    <group>
      {/* ===== Ridge Cap (kalenica) ===== */}
      {/* V-shaped flashing along the ridge, extruded along building X axis */}
      <mesh
        geometry={ridgeCapGeometry}
        material={material}
        position={[xMin, ridgeY, ridgeZ]}
        rotation={[0, -Math.PI / 2, 0]}
        castShadow
      />

      {/* ===== Eave Trims (okap) ===== */}
      {/* Left eave (Z = zMin side) - L-shape with vertical leg going down, horizontal leg outward (-Z) */}
      <mesh
        geometry={eaveTrimGeometry}
        material={material}
        position={[xMin, wallHeight, zMin]}
        rotation={[0, -Math.PI / 2, 0]}
        castShadow
      />
      {/* Right eave (Z = zMax side) - mirrored, horizontal leg goes outward (+Z) */}
      <mesh
        geometry={eaveTrimGeometry}
        material={material}
        position={[xMax, wallHeight, zMax]}
        rotation={[0, Math.PI / 2, 0]}
        castShadow
      />

      {/* ===== Corner Trims (narozniki) ===== */}
      {/* Front-left corner */}
      <mesh
        geometry={cornerTrimGeometry}
        material={material}
        position={[xMin, 0, zMin]}
        rotation={[Math.PI / 2, 0, 0]}
        castShadow
      />
      {/* Front-right corner */}
      <mesh
        geometry={cornerTrimGeometry}
        material={material}
        position={[xMin, 0, zMax]}
        rotation={[Math.PI / 2, 0, Math.PI / 2]}
        castShadow
      />
      {/* Back-left corner */}
      <mesh
        geometry={cornerTrimGeometry}
        material={material}
        position={[xMax, 0, zMin]}
        rotation={[Math.PI / 2, 0, -Math.PI / 2]}
        castShadow
      />
      {/* Back-right corner */}
      <mesh
        geometry={cornerTrimGeometry}
        material={material}
        position={[xMax, 0, zMax]}
        rotation={[Math.PI / 2, 0, Math.PI]}
        castShadow
      />

      {/* ===== Gable Edge Trims (krawedzie szczytowe) ===== */}
      {/* Front gable - left slope (from eave at zMin up to ridge) */}
      <mesh
        geometry={gableEdgeTrimGeometry}
        material={material}
        position={[xMin, wallHeight, zMin - eaveOverhang * Math.cos(roofAngleRad)]}
        rotation={[roofAngleRad, 0, 0]}
        castShadow
      />
      {/* Front gable - right slope (from eave at zMax up to ridge) */}
      <mesh
        geometry={gableEdgeTrimGeometry}
        material={material}
        position={[xMin, wallHeight, zMax + eaveOverhang * Math.cos(roofAngleRad)]}
        rotation={[-roofAngleRad, 0, 0]}
        scale={[1, -1, 1]}
        castShadow
      />
      {/* Back gable - left slope */}
      <mesh
        geometry={gableEdgeTrimGeometry}
        material={material}
        position={[xMax, wallHeight, zMin - eaveOverhang * Math.cos(roofAngleRad)]}
        rotation={[roofAngleRad, 0, 0]}
        castShadow
      />
      {/* Back gable - right slope */}
      <mesh
        geometry={gableEdgeTrimGeometry}
        material={material}
        position={[xMax, wallHeight, zMax + eaveOverhang * Math.cos(roofAngleRad)]}
        rotation={[-roofAngleRad, 0, 0]}
        scale={[1, -1, 1]}
        castShadow
      />
    </group>
  );
});

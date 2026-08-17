import { useMemo } from 'react';
import * as THREE from 'three';

interface BuildingEdgeLinesProps {
  span: number;
  hallLength: number;
  wallHeight: number;
  roofAngle: number;
  ridgeHeight: number;
  columnOuterFlangeOffset: number;
  endColumnOuterOffset: number;
}

/**
 * Renders dark silhouette edge lines at building envelope boundaries
 * using Three.js LineSegments for crisp architectural edge visualization.
 *
 * Lines mark:
 * - 4 vertical corner edges
 * - 2 eave lines along building length (both sides)
 * - Ridge line along building length
 * - 4 gable roof slope edges (2 per gable end)
 * - Bottom perimeter edges along ground
 */
export function BuildingEdgeLines({
  span,
  hallLength,
  wallHeight,
  roofAngle,
  ridgeHeight,
  columnOuterFlangeOffset,
  endColumnOuterOffset,
}: BuildingEdgeLinesProps) {
  const geometry = useMemo(() => {
    // Offsets: place edge lines slightly outside cladding surface (~20mm beyond column flange)
    const sideOffset = columnOuterFlangeOffset + 0.05;
    const endOffset = endColumnOuterOffset + 0.05;

    // Key coordinates
    const xMin = -endOffset;             // front end wall (just outside)
    const xMax = hallLength + endOffset;  // back end wall (just outside)
    const zMin = -sideOffset;             // left side wall (just outside)
    const zMax = span + sideOffset;       // right side wall (just outside)
    const yBottom = 0;
    const yEave = wallHeight;
    const yRidge = ridgeHeight;
    const zMid = span / 2;               // ridge is at mid-span

    // ridgeHeight already encodes the roof angle
    void roofAngle;

    const points: number[] = [];

    function addLine(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) {
      points.push(x1, y1, z1, x2, y2, z2);
    }

    // === 4 Vertical corner edges ===
    addLine(xMin, yBottom, zMin, xMin, yEave, zMin); // front-left
    addLine(xMax, yBottom, zMin, xMax, yEave, zMin); // back-left
    addLine(xMin, yBottom, zMax, xMin, yEave, zMax); // front-right
    addLine(xMax, yBottom, zMax, xMax, yEave, zMax); // back-right

    // === 2 Eave lines along building length (both sides) ===
    addLine(xMin, yEave, zMin, xMax, yEave, zMin); // left eave
    addLine(xMin, yEave, zMax, xMax, yEave, zMax); // right eave

    // === Ridge line along building length ===
    addLine(xMin, yRidge, zMid, xMax, yRidge, zMid);

    // === 4 Gable roof slope edges (2 per gable end) ===
    // Front gable (x = xMin)
    addLine(xMin, yEave, zMin, xMin, yRidge, zMid); // front left slope
    addLine(xMin, yEave, zMax, xMin, yRidge, zMid); // front right slope
    // Back gable (x = xMax)
    addLine(xMax, yEave, zMin, xMax, yRidge, zMid); // back left slope
    addLine(xMax, yEave, zMax, xMax, yRidge, zMid); // back right slope

    // === Bottom perimeter edges along ground ===
    addLine(xMin, yBottom, zMin, xMax, yBottom, zMin); // left bottom
    addLine(xMin, yBottom, zMax, xMax, yBottom, zMax); // right bottom
    addLine(xMin, yBottom, zMin, xMin, yBottom, zMax); // front bottom
    addLine(xMax, yBottom, zMin, xMax, yBottom, zMax); // back bottom

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return geom;
  }, [span, hallLength, wallHeight, ridgeHeight, columnOuterFlangeOffset, endColumnOuterOffset, roofAngle]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#303030" linewidth={1} />
    </lineSegments>
  );
}

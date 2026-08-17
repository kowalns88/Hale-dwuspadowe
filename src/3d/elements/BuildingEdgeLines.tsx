import { useMemo } from 'react';
import * as THREE from 'three';

interface BuildingEdgeLinesProps {
  span: number;
  hallLength: number;
  wallHeight: number;
  ridgeHeight: number;
  columnOuterFlangeOffset: number;
  endColumnOuterOffset: number;
}

/**
 * Renders dark silhouette edge lines at building envelope boundaries
 * using actual 3D mesh geometry (thin cylinders ~18mm thick) for visibility.
 * WebGL lineSegments always render at 1px regardless of linewidth,
 * so we use CylinderGeometry tubes instead for proper architectural edge visualization.
 *
 * Lines mark:
 * - 4 vertical corner edges
 * - 2 eave lines along building length (both sides)
 * - Ridge line along building length
 * - 4 gable roof slope edges (2 per gable end)
 * - Bottom perimeter edges along ground
 */

const EDGE_THICKNESS = 0.025; // 25mm diameter tubes
const EDGE_COLOR = '#1a1a1a';
const RADIAL_SEGMENTS = 4; // Low poly for performance (square-ish tubes)

interface EdgeSegment {
  start: THREE.Vector3;
  end: THREE.Vector3;
}

function EdgeTube({ start, end, geometry, material }: {
  start: THREE.Vector3;
  end: THREE.Vector3;
  geometry: THREE.CylinderGeometry;
  material: THREE.MeshStandardMaterial;
}) {
  const { position, quaternion, scaleY } = useMemo(() => {
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

    // CylinderGeometry is oriented along Y axis by default
    // We need to rotate it to align with the direction vector
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion();
    const dir = direction.clone().normalize();

    // If direction is exactly (anti-)parallel to up, handle edge case
    if (Math.abs(dir.dot(up)) > 0.9999) {
      if (dir.y < 0) {
        quat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
      }
    } else {
      quat.setFromUnitVectors(up, dir);
    }

    return {
      position: midpoint,
      quaternion: quat,
      scaleY: length,
    };
  }, [start, end]);

  return (
    <mesh
      position={[position.x, position.y, position.z]}
      quaternion={quaternion}
      scale={[1, scaleY, 1]}
      geometry={geometry}
      material={material}
    />
  );
}

export function BuildingEdgeLines({
  span,
  hallLength,
  wallHeight,
  ridgeHeight,
  columnOuterFlangeOffset,
  endColumnOuterOffset,
}: BuildingEdgeLinesProps) {
  // Shared geometry and material for all edge tubes (performance optimization)
  const sharedGeometry = useMemo(() => {
    // Unit height cylinder (height=1), will be scaled per segment
    const geo = new THREE.CylinderGeometry(
      EDGE_THICKNESS / 2,
      EDGE_THICKNESS / 2,
      1,
      RADIAL_SEGMENTS,
      1
    );
    return geo;
  }, []);

  const sharedMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: EDGE_COLOR,
      roughness: 0.8,
      metalness: 0.1,
    });
  }, []);

  const segments: EdgeSegment[] = useMemo(() => {
    // Offsets: place edge lines slightly outside cladding surface (~20mm beyond column flange)
    const sideOffset = columnOuterFlangeOffset + 0.15;
    const endOffset = endColumnOuterOffset + 0.15;

    // Key coordinates
    const xMin = -endOffset;             // front end wall (just outside)
    const xMax = hallLength + endOffset;  // back end wall (just outside)
    const zMin = -sideOffset;             // left side wall (just outside)
    const zMax = span + sideOffset;       // right side wall (just outside)
    const yBottom = 0;
    const yEave = wallHeight;
    const yRidge = ridgeHeight;
    const zMid = span / 2;               // ridge is at mid-span

    const edges: EdgeSegment[] = [];

    function addLine(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) {
      edges.push({
        start: new THREE.Vector3(x1, y1, z1),
        end: new THREE.Vector3(x2, y2, z2),
      });
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

    return edges;
  }, [span, hallLength, wallHeight, ridgeHeight, columnOuterFlangeOffset, endColumnOuterOffset]);

  return (
    <group>
      {segments.map((seg, i) => (
        <EdgeTube
          key={i}
          start={seg.start}
          end={seg.end}
          geometry={sharedGeometry}
          material={sharedMaterial}
        />
      ))}
    </group>
  );
}

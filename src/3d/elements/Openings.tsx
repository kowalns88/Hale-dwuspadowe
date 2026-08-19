import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { getRALHex } from '../../data/colors';
import type { HallParameters, Opening, WallIdentifier } from '../../types';

interface OpeningsProps {
  params: HallParameters;
  openings: Opening[];
  wallZOffset: number;
}

/**
 * Computes the 3D position and rotation of an opening on its wall.
 * Walls are positioned at columnOuterFlangeOffset outward from the column centers,
 * so openings must also be placed on that outer surface.
 */
function getOpeningTransform(
  opening: Opening,
  params: HallParameters,
  wallZOffset: number
): { position: [number, number, number]; rotation: [number, number, number] } {
  const { span, length: hallLength } = params;

  switch (opening.wall) {
    case 'side_left':
      // Wall is at Z = -columnOuterFlangeOffset, opening sits just outside
      return {
        position: [opening.positionX, opening.positionY, -wallZOffset],
        rotation: [0, 0, 0],
      };
    case 'side_right':
      // Wall is at Z = span + columnOuterFlangeOffset, opening sits just outside
      // positionX is stored in mirrored local coords (worldToLocal on PI-rotated mesh flips X),
      // so we un-mirror with hallLength - positionX to recover world X
      return {
        position: [hallLength - opening.positionX, opening.positionY, span + wallZOffset],
        rotation: [0, Math.PI, 0],
      };
    case 'end_front':
      // Wall is at X = -columnOuterFlangeOffset, opening sits just outside
      // positionX is stored in rotated local coords (PI/2 rotation mirrors Z),
      // so we un-mirror with span - positionX to recover world Z
      return {
        position: [-wallZOffset, opening.positionY, span - opening.positionX],
        rotation: [0, Math.PI / 2, 0],
      };
    case 'end_back':
      // Wall is at X = hallLength + columnOuterFlangeOffset, opening sits just outside
      // positionX is stored in rotated local coords (-PI/2 rotation),
      // which maps directly to world Z without mirroring
      return {
        position: [hallLength + wallZOffset, opening.positionY, opening.positionX],
        rotation: [0, -Math.PI / 2, 0],
      };
  }
}

/**
 * Renders a single opening with type-specific decorations.
 */
function OpeningMesh({ opening, params, wallZOffset, cutoutMat, detailMat }: { opening: Opening; params: HallParameters; wallZOffset: number; cutoutMat: THREE.MeshStandardMaterial; detailMat: THREE.MeshStandardMaterial }) {
  const { position, rotation } = useMemo(
    () => getOpeningTransform(opening, params, wallZOffset),
    [opening, params, wallZOffset]
  );

  const { width, height, type, wall } = opening;
  const isEndWall = wall === 'end_front' || wall === 'end_back';

  // Sliding gate hangs on a rail in front of the wall - add Z offset
  const slidingGateZOffset = type === 'sliding_gate' ? 0.08 : 0;

  return (
    <group position={position} rotation={rotation}>
      {/* Dark rectangle (cutout) */}
      <mesh material={cutoutMat}>
        <planeGeometry args={[width, height]} />
      </mesh>

      {/* Type-specific decorations */}
      {type === 'sliding_gate' && (
        <group position={[0, 0, slidingGateZOffset]}>
          <SlidingGateDetail width={width} height={height} material={detailMat} wall={wall} />
        </group>
      )}
      {type === 'sectional_gate' && <SectionalGateDetail width={width} height={height} material={detailMat} />}
      {type === 'door' && <DoorDetail width={width} height={height} material={detailMat} />}
      {type === 'window' && <WindowDetail width={width} height={height} material={detailMat} />}

      {/* Lintel beam for end wall gates */}
      {isEndWall && (type === 'sliding_gate' || type === 'sectional_gate') && (
        <mesh position={[0, height / 2 + 0.15, 0.075]} material={detailMat}>
          <boxGeometry args={[width + 0.6, 0.2, 0.15]} />
        </mesh>
      )}
    </group>
  );
}

/**
 * Sliding gate: rail at the top.
 * Side walls: single rail extending to +X direction by the gate width.
 * End walls: two half-rails extending to both sides from gate edges.
 */
function SlidingGateDetail({ width, height, material, wall }: { width: number; height: number; material: THREE.MeshStandardMaterial; wall: WallIdentifier }) {
  const railHeight = 0.06;
  const railDepth = 0.04;
  const isSideWall = wall === 'side_left' || wall === 'side_right';

  const panelMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: getRALHex('9002'),
    side: THREE.DoubleSide,
    depthWrite: true,
  }), []);

  useEffect(() => {
    return () => { panelMat.dispose(); };
  }, [panelMat]);

  if (isSideWall) {
    // Single rail: total length = 2 * width (gate itself + sliding space to one side)
    const railLength = width * 2;
    // Offset so the rail extends from -width/2 to +width*1.5 (gate occupies -width/2 to +width/2, rail extends +width to the right)
    const offsetX = width / 2;
    return (
      <>
        {/* Gate panel body */}
        <mesh position={[0, 0, 0.02]} material={panelMat}>
          <boxGeometry args={[width - 0.02, height - 0.02, 0.04]} />
        </mesh>
        <mesh
          position={[offsetX, height / 2 + railHeight / 2, railDepth / 2]}
          material={material}
        >
          <boxGeometry args={[railLength, railHeight, railDepth]} />
        </mesh>
      </>
    );
  } else {
    // End walls: two half-rails extending outward from both sides of the gate
    const halfRailLength = width / 2;
    // Left rail: from gate left edge extending further left
    const leftOffsetX = -width / 2 - halfRailLength / 2;
    // Right rail: from gate right edge extending further right
    const rightOffsetX = width / 2 + halfRailLength / 2;
    return (
      <>
        {/* Gate panel body */}
        <mesh position={[0, 0, 0.02]} material={panelMat}>
          <boxGeometry args={[width - 0.02, height - 0.02, 0.04]} />
        </mesh>
        <mesh
          position={[leftOffsetX, height / 2 + railHeight / 2, railDepth / 2]}
          material={material}
        >
          <boxGeometry args={[halfRailLength, railHeight, railDepth]} />
        </mesh>
        <mesh
          position={[rightOffsetX, height / 2 + railHeight / 2, railDepth / 2]}
          material={material}
        >
          <boxGeometry args={[halfRailLength, railHeight, railDepth]} />
        </mesh>
      </>
    );
  }
}

/**
 * Sectional (panel) gate: box with 60mm thickness, RAL 9002 light grey, with horizontal segment lines.
 */
function SectionalGateDetail({ width, height, material }: { width: number; height: number; material: THREE.MeshStandardMaterial }) {
  const segmentCount = Math.max(3, Math.round(height / 0.5));
  const segmentSpacing = height / segmentCount;
  const lineThickness = 0.02;

  const panelMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: getRALHex('9002'),
    side: THREE.DoubleSide,
    depthWrite: true,
  }), []);

  useEffect(() => {
    return () => { panelMat.dispose(); };
  }, [panelMat]);

  const lines = useMemo(() => {
    const arr: number[] = [];
    for (let i = 1; i < segmentCount; i++) {
      arr.push(-height / 2 + i * segmentSpacing);
    }
    return arr;
  }, [segmentCount, segmentSpacing, height]);

  return (
    <>
      {/* Gate panel body with 60mm thickness */}
      <mesh position={[0, 0, 0.03]} material={panelMat}>
        <boxGeometry args={[width - 0.02, height - 0.02, 0.06]} />
      </mesh>
      {/* Horizontal segment lines */}
      {lines.map((y, idx) => (
        <mesh key={idx} position={[0, y, 0.065]} material={material}>
          <boxGeometry args={[width - 0.04, lineThickness, 0.01]} />
        </mesh>
      ))}
    </>
  );
}

/**
 * Door: frame border (4 thin boxes).
 */
function DoorDetail({ width, height, material }: { width: number; height: number; material: THREE.MeshStandardMaterial }) {
  const frameWidth = 0.05;
  const frameDepth = 0.02;

  return (
    <>
      {/* Top frame */}
      <mesh position={[0, height / 2 - frameWidth / 2, frameDepth / 2]} material={material}>
        <boxGeometry args={[width, frameWidth, frameDepth]} />
      </mesh>
      {/* Bottom frame */}
      <mesh position={[0, -height / 2 + frameWidth / 2, frameDepth / 2]} material={material}>
        <boxGeometry args={[width, frameWidth, frameDepth]} />
      </mesh>
      {/* Left frame */}
      <mesh position={[-width / 2 + frameWidth / 2, 0, frameDepth / 2]} material={material}>
        <boxGeometry args={[frameWidth, height, frameDepth]} />
      </mesh>
      {/* Right frame */}
      <mesh position={[width / 2 - frameWidth / 2, 0, frameDepth / 2]} material={material}>
        <boxGeometry args={[frameWidth, height, frameDepth]} />
      </mesh>
    </>
  );
}

/**
 * Window: cross dividers (horizontal + vertical center lines).
 */
function WindowDetail({ width, height, material }: { width: number; height: number; material: THREE.MeshStandardMaterial }) {
  const barWidth = 0.03;
  const barDepth = 0.015;

  return (
    <>
      {/* Horizontal center bar */}
      <mesh position={[0, 0, barDepth / 2]} material={material}>
        <boxGeometry args={[width - 0.02, barWidth, barDepth]} />
      </mesh>
      {/* Vertical center bar */}
      <mesh position={[0, 0, barDepth / 2]} material={material}>
        <boxGeometry args={[barWidth, height - 0.02, barDepth]} />
      </mesh>
      {/* Frame */}
      <DoorDetail width={width} height={height} material={material} />
    </>
  );
}

/**
 * Helper to compute wall dimensions.
 */
export function getWallDimensions(
  wall: WallIdentifier,
  params: HallParameters
): { width: number; height: number } {
  const { span, length: hallLength, wallHeight } = params;
  switch (wall) {
    case 'side_left':
    case 'side_right':
      return { width: hallLength, height: wallHeight };
    case 'end_front':
    case 'end_back':
      return { width: span, height: wallHeight };
  }
}

/**
 * Checks if two openings overlap (AABB collision in 2D local wall coords).
 */
export function checkCollision(a: Opening, b: Opening): boolean {
  if (a.wall !== b.wall) return false;

  const aLeft = a.positionX - a.width / 2;
  const aRight = a.positionX + a.width / 2;
  const aBottom = a.positionY - a.height / 2;
  const aTop = a.positionY + a.height / 2;

  const bLeft = b.positionX - b.width / 2;
  const bRight = b.positionX + b.width / 2;
  const bBottom = b.positionY - b.height / 2;
  const bTop = b.positionY + b.height / 2;

  return aLeft < bRight && aRight > bLeft && aBottom < bTop && aTop > bBottom;
}

/**
 * Checks if an opening fits within the wall bounds.
 */
export function fitsInWall(opening: Opening, params: HallParameters): boolean {
  const { width: wallWidth, height: wallHeight } = getWallDimensions(opening.wall, params);
  const left = opening.positionX - opening.width / 2;
  const right = opening.positionX + opening.width / 2;
  const bottom = opening.positionY - opening.height / 2;
  const top = opening.positionY + opening.height / 2;

  return left >= 0 && right <= wallWidth && bottom >= 0 && top <= wallHeight;
}

/**
 * Openings component rendering all openings from the array.
 * Materials are created inside the component and disposed on unmount.
 */
export const Openings = React.memo(function Openings({ params, openings, wallZOffset }: OpeningsProps) {
  const cutoutMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1a1a1a',
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    []
  );

  const detailMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#555555',
        side: THREE.DoubleSide,
      }),
    []
  );

  // Dispose materials on unmount
  useEffect(() => {
    return () => {
      cutoutMat.dispose();
      detailMat.dispose();
    };
  }, [cutoutMat, detailMat]);

  if (openings.length === 0) return null;

  return (
    <group name="openings">
      {openings.map((opening) => (
        <OpeningMesh key={opening.id} opening={opening} params={params} wallZOffset={wallZOffset} cutoutMat={cutoutMat} detailMat={detailMat} />
      ))}
    </group>
  );
});

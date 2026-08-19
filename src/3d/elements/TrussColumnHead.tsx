import React, { useMemo } from 'react';
import * as THREE from 'three';
import { rafterMaterial, bracingMaterial, plateMaterial } from '../materials';
import type { SteelProfile, ConnectionPlateResults } from '../../types';

interface TrussColumnHeadProps {
  chordProfile: SteelProfile;
  wallHeight: number;
  span: number;
  roofAngle: number;
  trussHeight: number;
  columnSpacing: number;
  numberOfFrames: number;
  connectionPlates: ConnectionPlateResults;
  columnFlangeOffset: number;
}

/**
 * Renders truss column heads (short truss stubs) at the top of each side column
 * when the rafter type is truss. Each head consists of:
 * - A short upper chord segment (~1000mm) extending toward the hall center
 * - A short lower chord segment (~1000mm) parallel, offset down by trussHeight
 * - One diagonal web member connecting them
 * - End plates (vertical, in XY plane) at the far ends of both chords
 *
 * The head is inclined at the roof angle, matching the truss slope.
 */
export const TrussColumnHead = React.memo(function TrussColumnHead({
  chordProfile,
  wallHeight,
  span,
  roofAngle,
  trussHeight,
  columnSpacing,
  numberOfFrames,
  connectionPlates: _connectionPlates,
  columnFlangeOffset,
}: TrussColumnHeadProps) {
  const framePositions = useMemo(() => {
    const positions: number[] = [];
    for (let i = 0; i < numberOfFrames; i++) {
      positions.push(i * columnSpacing);
    }
    return positions;
  }, [numberOfFrames, columnSpacing]);

  const chordSize = chordProfile.h / 1000;
  const webSize = 0.03; // 30x30mm diagonal
  const headLength = 1.0; // 1000mm stub length (horizontal projection along Z)

  const roofAngleRad = (roofAngle * Math.PI) / 180;

  return (
    <group name="truss-column-heads">
      {framePositions.map((x, i) => (
        <React.Fragment key={i}>
          {/* Left side (Z=0): head extends toward +Z */}
          <ColumnHead
            x={x}
            wallHeight={wallHeight}
            roofAngleRad={roofAngleRad}
            trussHeight={trussHeight}
            headLength={headLength}
            chordSize={chordSize}
            webSize={webSize}
            side="left"
            columnFlangeOffset={columnFlangeOffset}
          />
          {/* Right side (Z=span): head extends toward -Z */}
          <ColumnHead
            x={x}
            wallHeight={wallHeight}
            roofAngleRad={roofAngleRad}
            trussHeight={trussHeight}
            headLength={headLength}
            chordSize={chordSize}
            webSize={webSize}
            side="right"
            span={span}
            columnFlangeOffset={columnFlangeOffset}
          />
        </React.Fragment>
      ))}
    </group>
  );
});

interface ColumnHeadProps {
  x: number;
  wallHeight: number;
  roofAngleRad: number;
  trussHeight: number;
  headLength: number;
  chordSize: number;
  webSize: number;
  side: 'left' | 'right';
  span?: number;
  columnFlangeOffset: number;
}

function ColumnHead({
  x,
  wallHeight,
  roofAngleRad,
  trussHeight,
  headLength,
  chordSize,
  webSize,
  side,
  span = 0,
  columnFlangeOffset,
}: ColumnHeadProps) {
  const members = useMemo(() => {
    // Rise over the 500mm horizontal run
    const rise = headLength * Math.tan(roofAngleRad);

    let topStart: THREE.Vector3;
    let topEnd: THREE.Vector3;
    let bottomStart: THREE.Vector3;
    let bottomEnd: THREE.Vector3;

    if (side === 'left') {
      // Left side: starts at Z=columnFlangeOffset, extends toward +Z
      topStart = new THREE.Vector3(x, wallHeight, columnFlangeOffset);
      topEnd = new THREE.Vector3(x, wallHeight + rise, columnFlangeOffset + headLength);
      bottomStart = new THREE.Vector3(x, wallHeight - trussHeight, columnFlangeOffset);
      bottomEnd = new THREE.Vector3(x, wallHeight - trussHeight + rise, columnFlangeOffset + headLength);
    } else {
      // Right side: starts at Z=span - columnFlangeOffset, extends toward -Z (mirror)
      const startZ = span - columnFlangeOffset;
      topStart = new THREE.Vector3(x, wallHeight, startZ);
      topEnd = new THREE.Vector3(x, wallHeight + rise, startZ - headLength);
      bottomStart = new THREE.Vector3(x, wallHeight - trussHeight, startZ);
      bottomEnd = new THREE.Vector3(x, wallHeight - trussHeight + rise, startZ - headLength);
    }

    return { topStart, topEnd, bottomStart, bottomEnd };
  }, [x, wallHeight, roofAngleRad, trussHeight, headLength, side, span, columnFlangeOffset]);

  const plateSize = chordSize + 0.04;

  return (
    <group>
      {/* Upper chord */}
      <TrussHeadMember
        start={members.topStart}
        end={members.topEnd}
        size={chordSize}
        material={rafterMaterial}
      />
      {/* Lower chord */}
      <TrussHeadMember
        start={members.bottomStart}
        end={members.bottomEnd}
        size={chordSize}
        material={rafterMaterial}
      />
      {/* Diagonal web member: from top start to bottom end */}
      <TrussHeadMember
        start={members.topStart}
        end={members.bottomEnd}
        size={webSize}
        material={bracingMaterial}
      />
      {/* End plate on top chord far end */}
      <mesh
        material={plateMaterial}
        position={[members.topEnd.x, members.topEnd.y, members.topEnd.z]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[plateSize, plateSize, 0.015]} />
      </mesh>
      {/* End plate on bottom chord far end */}
      <mesh
        material={plateMaterial}
        position={[members.bottomEnd.x, members.bottomEnd.y, members.bottomEnd.z]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[plateSize, plateSize, 0.015]} />
      </mesh>
      {/* Connection plate at stub start (column junction) */}
      <mesh
        material={plateMaterial}
        position={[
          x,
          wallHeight - trussHeight / 2,
          side === 'left' ? columnFlangeOffset : span - columnFlangeOffset,
        ]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[plateSize + 0.06, trussHeight + chordSize + 0.04, 0.025]} />
      </mesh>
    </group>
  );
}

interface TrussHeadMemberProps {
  start: THREE.Vector3;
  end: THREE.Vector3;
  size: number;
  material: THREE.Material;
}

function TrussHeadMember({ start, end, size, material }: TrussHeadMemberProps) {
  const { position, rotation, memberLength } = useMemo(() => {
    const direction = new THREE.Vector3().subVectors(end, start);
    const len = direction.length();
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

    // Align box (Y-axis default) with the direction vector
    const dir = direction.normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(up, dir);
    const euler = new THREE.Euler().setFromQuaternion(quaternion);

    return {
      position: [mid.x, mid.y, mid.z] as [number, number, number],
      rotation: [euler.x, euler.y, euler.z] as [number, number, number],
      memberLength: len,
    };
  }, [start, end]);

  return (
    <mesh
      position={position}
      rotation={rotation}
      castShadow
      receiveShadow
      material={material}
    >
      <boxGeometry args={[size, memberLength, size]} />
    </mesh>
  );
}

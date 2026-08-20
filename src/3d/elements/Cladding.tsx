import React, { useMemo, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { ThreeEvent } from '@react-three/fiber';
import { getRALHex } from '../../data/colors';
import { checkCollision, fitsInWall } from './Openings';
import type { HallParameters, CladdingParameters, Opening, OpeningType, WallIdentifier, SelectedSheet } from '../../types';

interface CladdingProps {
  params: HallParameters;
  cladding: CladdingParameters;
  showCladding: boolean;
  columnOuterFlangeOffset: number;
  endColumnOuterOffset: number;
  columnSpacing: number;
  numberOfFrames: number;
  placementMode?: boolean;
  openings?: Opening[];
  onPlaceOpening?: (opening: Opening) => void;
  selectedOpeningType?: OpeningType;
  openingWidth?: number;
  openingHeight?: number;
  sillHeight?: number;
  selectedSheet?: SelectedSheet | null;
  onSelectSheet?: (sheet: SelectedSheet | null) => void;
}

/**
 * Creates a fully opaque material for a given RAL color code.
 */
function makeCladdingMaterial(ralCode: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: getRALHex(ralCode),
    opacity: 1.0,
    side: THREE.DoubleSide,
    depthWrite: true,
    metalness: 0.15,
    roughness: 0.6,
  });
}

/**
 * Trapezoidal profile height function.
 * Profile: flat valley at bottom -> slope up -> flat plateau at top -> slope down -> next valley.
 */
function trapezoidHeight(x: number, period: number, plateauWidth: number, valleyWidth: number, height: number): number {
  const p = ((x % period) + period) % period;
  const slopeWidth = (period - plateauWidth - valleyWidth) / 2;

  if (p < valleyWidth / 2) return 0;
  if (p < valleyWidth / 2 + slopeWidth) {
    const t = (p - valleyWidth / 2) / slopeWidth;
    return t * height;
  }
  if (p < valleyWidth / 2 + slopeWidth + plateauWidth) return height;
  if (p < valleyWidth / 2 + slopeWidth + plateauWidth + slopeWidth) {
    const t = (p - valleyWidth / 2 - slopeWidth - plateauWidth) / slopeWidth;
    return (1 - t) * height;
  }
  return 0;
}

/**
 * Creates a PlaneGeometry with V-groove microlining on the surface.
 * V-groove every 33mm (0.033m), depth 0.5mm (0.0005m).
 * The grooves run horizontally (along the width of the plane).
 */
function createMicrolinedGeometry(
  width: number,
  height: number,
): THREE.PlaneGeometry {
  const grooveSpacing = 0.033; // 33mm
  const grooveDepth = 0.0005; // 0.5mm

  // We need enough vertical segments to represent grooves
  const segY = Math.min(Math.ceil(height / grooveSpacing) * 4, 2000);
  const segX = Math.max(Math.ceil(width * 2), 20);

  const geo = new THREE.PlaneGeometry(width, height, segX, segY);
  const pos = geo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    // Position in groove cycle (offset to start from bottom)
    const localY = y + height / 2;
    const phase = ((localY % grooveSpacing) + grooveSpacing) % grooveSpacing;
    const normalized = phase / grooveSpacing;
    // V-groove: sharp dip at the groove line (normalized ~ 0 or ~ 1)
    // Use a triangle wave that creates a V-shape at each groove boundary
    const distFromGroove = Math.abs(normalized - 0.5) * 2; // 0 at center, 1 at edges (groove lines)
    // Invert: deepest at edges (groove lines), flat at center
    const displacement = -grooveDepth * Math.pow(distFromGroove, 4);
    pos.setZ(i, displacement);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Profile parameters for trapezoidal sheets (in meters).
 * T18: height 18mm, plateau 70mm, valley 188mm, period ~290mm
 * T35: height 35mm, plateau 126mm, valley 210mm, period ~381mm
 * T35_ROOF: height 12mm, plateau 36mm, valley 130mm, period 213mm (reduced amplitude for roof)
 * ROOF_SANDWICH: height 42mm, plateau 100mm, valley 200mm, period 350mm
 */
function getTrapezoidalParams(type: 'T18' | 'T35' | 'T35_ROOF' | 'ROOF_SANDWICH') {
  if (type === 'T35') {
    return { height: 0.035, plateau: 0.036, valley: 0.130, period: 0.213 };
  }
  if (type === 'T35_ROOF') {
    return { height: 0.012, plateau: 0.036, valley: 0.130, period: 0.213 };
  }
  if (type === 'ROOF_SANDWICH') {
    return { height: 0.042, plateau: 0.040, valley: 0.260, period: 0.350 };
  }
  // T18
  return { height: 0.018, plateau: 0.033, valley: 0.188, period: 0.290 };
}



/**
 * Creates a BufferGeometry with a dense vertex grid INSIDE a trapezoid shape,
 * with optional trapezoidal profile displacement along Z.
 * This avoids the earcut triangulation issue where ShapeGeometry with 4 vertices
 * only produces 2 triangles, causing deformed edges when displacement is applied.
 */
function createTrapezoidMeshGeometry(
  panelWidth: number,
  hLeft: number,
  hRight: number,
  profileType: 'T18' | 'T35' | 'T35_ROOF' | 'ROOF_SANDWICH' | null,
  waveAxis: 'x' | 'y',
): THREE.BufferGeometry {
  const segX = 20;
  const maxH = Math.max(hLeft, hRight);
  if (maxH < 0.01) return new THREE.PlaneGeometry(panelWidth, 0.01);

  // For sandwich panels (no profile): use ExtrudeGeometry with thickness
  if (!profileType) {
    const shape = new THREE.Shape();
    shape.moveTo(-panelWidth / 2, 0);
    shape.lineTo(panelWidth / 2, 0);
    shape.lineTo(panelWidth / 2, hRight);
    shape.lineTo(-panelWidth / 2, hLeft);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false });
    geo.translate(0, 0, -0.05);
    geo.computeVertexNormals();
    return geo;
  }

  const segY = Math.max(10, Math.ceil(maxH * 20));

  const vertices: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];

  const cols = segX + 1;
  const rows = segY + 1;

  for (let iy = 0; iy < rows; iy++) {
    const ty = iy / segY;
    for (let ix = 0; ix < cols; ix++) {
      const tx = ix / segX;

      const x = -panelWidth / 2 + tx * panelWidth;
      const maxYatX = hLeft + tx * (hRight - hLeft);
      const y = ty * maxYatX;

      let z = 0;
      if (profileType) {
        const { height: amp, plateau, valley, period } = getTrapezoidalParams(profileType);
        const coord = waveAxis === 'x' ? x : y;
        const extent = waveAxis === 'x' ? panelWidth : maxH;
        z = -trapezoidHeight(coord + extent / 2, period, plateau, valley, amp);
      }

      vertices.push(x, y, z);
      normals.push(0, 0, 1);
    }
  }

  for (let iy = 0; iy < segY; iy++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iy * cols + ix;
      const b = iy * cols + ix + 1;
      const c = (iy + 1) * cols + ix;
      const d = (iy + 1) * cols + ix + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/**
 * Creates a PlaneGeometry with trapezoidal vertex displacement.
 * Waves run along the waveAxis ('x' for walls = vertical ribs, 'y' for roof along slope).
 * Displacement is applied along the Z normal of the plane.
 */
function createTrapezoidalGeometry(
  width: number,
  height: number,
  profileType: 'T18' | 'T35' | 'T35_ROOF' | 'ROOF_SANDWICH',
  waveAxis: 'x' | 'y',
  invert: boolean = false,
): THREE.PlaneGeometry {
  const { height: amp, plateau, valley, period } = getTrapezoidalParams(profileType);

  // Scale segments: 10 vertices per wave period along wave axis for proper trapezoid rendering
  const waveCount = waveAxis === 'x' ? Math.ceil(width / period) : Math.ceil(height / period);
  const segAlongWave = Math.min(waveCount * 20, 2500);
  const segCross = Math.min(Math.ceil((waveAxis === 'x' ? height : width) * 2), 100);
  const segW = waveAxis === 'x' ? segAlongWave : segCross;
  const segH = waveAxis === 'x' ? segCross : segAlongWave;

  const geo = new THREE.PlaneGeometry(width, height, segW, segH);
  const pos = geo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // Determine the coordinate along which the wave varies
    const coord = waveAxis === 'x' ? x : y;
    const displacement = trapezoidHeight(coord + (waveAxis === 'x' ? width : height) / 2, period, plateau, valley, amp);
    pos.setZ(i, invert ? -displacement : displacement);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}



/**
 * Individual sheet mesh component with memoized geometry and flicker-free highlighting.
 * Geometry is created once per unique parameter tuple and disposed on unmount.
 * Highlight is achieved by toggling emissive on a per-instance cloned material,
 * avoiding child material mount/unmount that causes one-frame flicker.
 */
interface SheetMeshProps {
  sheetWidth: number;
  sheetHeight: number;
  position: [number, number, number];
  rotation?: [number, number, number];
  isTrapezoid: boolean;
  profileType: 'T18' | 'T35' | 'T35_ROOF' | 'ROOF_SANDWICH';
  waveAxis: 'x' | 'y';
  sandwichThickness: number;
  baseMaterial: THREE.MeshStandardMaterial;
  selected: boolean;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
}

const SheetMesh = React.memo(function SheetMesh({
  sheetWidth,
  sheetHeight,
  position,
  rotation,
  isTrapezoid,
  profileType,
  waveAxis,
  sandwichThickness,
  baseMaterial,
  selected,
  onPointerDown,
}: SheetMeshProps) {
  // Memoize geometry per unique parameter tuple
  const geometry = useMemo(() => {
    if (isTrapezoid) {
      return createTrapezoidalGeometry(sheetWidth, sheetHeight, profileType, waveAxis, true);
    }
    return new THREE.BoxGeometry(sheetWidth, sheetHeight, sandwichThickness);
  }, [sheetWidth, sheetHeight, isTrapezoid, profileType, waveAxis, sandwichThickness]);

  // Dispose geometry on unmount or when it changes
  useEffect(() => {
    return () => { geometry.dispose(); };
  }, [geometry]);

  // Clone base material so emissive toggling doesn't bleed to other sheets
  const material = useMemo(() => baseMaterial.clone(), [baseMaterial]);

  useEffect(() => {
    return () => { material.dispose(); };
  }, [material]);

  // Toggle emissive on the cloned material based on selection state
  useEffect(() => {
    if (selected) {
      material.emissive.set('#ffffff');
      material.emissiveIntensity = 0.3;
    } else {
      material.emissive.set('#000000');
      material.emissiveIntensity = 0;
    }
  }, [selected, material]);

  return (
    <mesh
      position={position}
      rotation={rotation}
      geometry={geometry}
      castShadow
      material={material}
      onPointerDown={onPointerDown}
    />
  );
});


interface ColorSegment { startLayer: number; endLayer: number; color: string; }

/**
 * Cladding component rendering walls and roof panels with RAL colors.
 * Trapezoidal profiles use proper trapezoidal waveform (not sinusoidal).
 * Sandwich panels use BoxGeometry with 100mm thickness.
 * Roof panels have ribs running along slope (waveAxis = 'x' on the plane, which corresponds to building length axis).
 */
export const Cladding = React.memo(function Cladding({
  params,
  cladding,
  showCladding,
  columnOuterFlangeOffset,
  endColumnOuterOffset,
  columnSpacing,
  numberOfFrames,
  placementMode,
  openings,
  onPlaceOpening,
  selectedOpeningType,
  openingWidth,
  openingHeight,
  sillHeight,
  selectedSheet,
  onSelectSheet,
}: CladdingProps) {
  const { span, length: hallLength, wallHeight, roofAngle } = params;

  const roofAngleRad = (roofAngle * Math.PI) / 180;
  const ridgeHeight = wallHeight + (span / 2) * Math.tan(roofAngleRad);
  const gableTriangleHeight = ridgeHeight - wallHeight;
  const roofSlopeLength = (span / 2) / Math.cos(roofAngleRad);

  // Eave overhang in meters
  const eaveOverhangM = (cladding.eaveOverhang ?? 300) / 1000;

  // Determine if walls are trapezoidal or sandwich
  const isSideWallTrapezoid = cladding.sideWallType === 'trapezoid';
  const isEndWallTrapezoid = cladding.endWallType === 'trapezoid';

  // Wall thickness offset: shift walls outward by their thickness to avoid column collision
  const sideWallThicknessOffset = isSideWallTrapezoid
    ? getTrapezoidalParams((cladding.sideWallType as string) === 'T35' ? 'T35' : 'T18').height
    : (cladding.sandwichThickness ?? 100) / 1000 / 2;
  const endWallThicknessOffset = isEndWallTrapezoid
    ? getTrapezoidalParams((cladding.endWallType as string) === 'T35' ? 'T35' : 'T18').height
    : (cladding.sandwichThickness ?? 100) / 1000 / 2;

  // Wall geometries
  // panelOrientation determines the direction of ribs:
  // 'horizontal' -> ribs run horizontally -> wave repeats along Y -> waveAxis = 'y'
  // 'vertical' -> ribs run vertically -> wave repeats along X -> waveAxis = 'x'
  const wallWaveAxis = cladding.panelOrientation === 'horizontal' ? 'y' : 'x';

  const sideWallHeight = wallHeight - 0.05;

  const sandwichThicknessM = (cladding.sandwichThickness ?? 100) / 1000;
  const sideWallProfileType: 'T18' | 'T35' = 'T18';
  const numberOfBays = numberOfFrames - 1;

  // Roof geometry: ribs run along the slope (from ridge to eave).
  // The plane is hallLength x roofSlopeLengthWithOverhang.
  // On the plane, X = along building length, Y = along slope.
  // Ribs along slope means wave varies along X (perpendicular to slope direction),
  // so each rib stripe runs along Y (the slope direction).
  // Actually: "garby wzdluz spadku" means ridges go from ridge to eave = along Y on the plane.
  // That means the wave pattern repeats along X. So waveAxis = 'x'.
  const roofWidth = hallLength + 2 * (endColumnOuterOffset + 2 * endWallThicknessOffset);
  const roofSlopeLengthWithOverhang = roofSlopeLength + eaveOverhangM;

  // Roof sheet parameters
  const roofModuleWidth = cladding.roofType === 'T35' ? 1.050 
    : cladding.roofType === 'T18' ? 1.064 
    : 1.050; // sandwich roof module = 1050mm
  const roofProfileType: 'T18' | 'T35' | 'T35_ROOF' | 'ROOF_SANDWICH' = 
    cladding.roofType === 'T35' ? 'T35_ROOF' 
    : cladding.roofType === 'T18' ? 'T18' 
    : 'ROOF_SANDWICH';
  const numRoofSheets = Math.ceil(roofWidth / roofModuleWidth);

  // Materials
  const sideWallMat = useMemo(() => {
    const mat = makeCladdingMaterial(cladding.sideWallColor);
    if (!isSideWallTrapezoid) {
      mat.roughness = 0.5;
      mat.metalness = 0.1;
    }
    return mat;
  }, [cladding.sideWallColor, isSideWallTrapezoid]);
  const endWallMat = useMemo(() => makeCladdingMaterial(cladding.endWallColor), [cladding.endWallColor]);
  const highlightedEndWallMat = useMemo(() => {
    const mat = makeCladdingMaterial(cladding.endWallColor);
    mat.emissive.set('#ffffff');
    mat.emissiveIntensity = 0.3;
    return mat;
  }, [cladding.endWallColor]);
  const roofMat = useMemo(() => makeCladdingMaterial(cladding.roofColor), [cladding.roofColor]);

  // Highlighted roof material for selected sheet
  const highlightedRoofMat = useMemo(() => {
    const mat = roofMat.clone();
    mat.emissive.set('#ffffff');
    mat.emissiveIntensity = 0.3;
    return mat;
  }, [roofMat]);

  // Dispose materials on color change or unmount
  useEffect(() => {
    return () => { sideWallMat.dispose(); };
  }, [sideWallMat]);
  useEffect(() => {
    return () => { endWallMat.dispose(); };
  }, [endWallMat]);
  useEffect(() => {
    return () => { highlightedEndWallMat.dispose(); };
  }, [highlightedEndWallMat]);
  useEffect(() => {
    return () => { roofMat.dispose(); };
  }, [roofMat]);
  useEffect(() => {
    return () => { highlightedRoofMat.dispose(); };
  }, [highlightedRoofMat]);

  // Side wall stripes
  const sideStripes = useMemo(
    () => cladding.colorStripes.filter((s) => s.wallType === 'side'),
    [cladding.colorStripes]
  );

  // End wall stripes
  const endStripes = useMemo(
    () => cladding.colorStripes.filter((s) => s.wallType === 'end'),
    [cladding.colorStripes]
  );

  // End wall column Z positions (same logic as EndColumns, incorporating gates)
  // Uniform positions (fallback when no gates on a wall)
  const endColZPositionsUniform = useMemo(() => {
    const targetSpacing = 3.0;
    const n = Math.max(1, Math.round(span / targetSpacing) - 1);
    const uniformPositions = [0];
    for (let i = 1; i <= n; i++) uniformPositions.push((i / (n + 1)) * span);
    uniformPositions.push(span);
    uniformPositions.sort((a, b) => a - b);
    return uniformPositions;
  }, [span]);

  // Gates on end walls (for column position computation)
  const endFrontGates = useMemo(() => {
    if (!openings) return [] as Opening[];
    return openings.filter(
      (o) => o.wall === 'end_front' && (o.type === 'sectional_gate' || o.type === 'sliding_gate')
    );
  }, [openings]);

  const endBackGates = useMemo(() => {
    if (!openings) return [] as Opening[];
    return openings.filter(
      (o) => o.wall === 'end_back' && (o.type === 'sectional_gate' || o.type === 'sliding_gate')
    );
  }, [openings]);

  // Dynamic end wall column Z positions incorporating gate jambs
  // For front wall: gate center Z = span - gate.positionX
  const endColZPositionsFront = useMemo(() => {
    if (endFrontGates.length === 0) return endColZPositionsUniform;
    // Start with corner positions
    const positions = new Set<number>([0, span]);
    // Add gate jamb positions
    for (const gate of endFrontGates) {
      const centerZ = span - gate.positionX;
      const leftJamb = centerZ - gate.width / 2;
      const rightJamb = centerZ + gate.width / 2;
      if (leftJamb > 0.01 && leftJamb < span - 0.01) positions.add(leftJamb);
      if (rightJamb > 0.01 && rightJamb < span - 0.01) positions.add(rightJamb);
    }
    // Add filler columns between boundaries (same logic as EndColumns)
    const sorted = [...positions].sort((a, b) => a - b);
    const fillerPositions: number[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const leftZ = sorted[i];
      const rightZ = sorted[i + 1];
      const gap = rightZ - leftZ;
      // Check if this gap IS the gate span (skip filler inside gate)
      const isGateSpan = endFrontGates.some((gate) => {
        const centerZ = span - gate.positionX;
        const lj = centerZ - gate.width / 2;
        const rj = centerZ + gate.width / 2;
        return Math.abs(leftZ - lj) < 0.01 && Math.abs(rightZ - rj) < 0.01;
      });
      if (isGateSpan) continue;
      if (gap > 3.0) {
        fillerPositions.push(leftZ + gap / 3);
        fillerPositions.push(leftZ + (2 * gap) / 3);
      } else if (gap > 0.5) {
        fillerPositions.push(leftZ + gap / 2);
      }
    }
    for (const p of fillerPositions) positions.add(p);
    return [...positions].sort((a, b) => a - b);
  }, [endFrontGates, endColZPositionsUniform, span]);

  // For back wall: gate center Z = gate.positionX
  const endColZPositionsBack = useMemo(() => {
    if (endBackGates.length === 0) return endColZPositionsUniform;
    // Start with corner positions
    const positions = new Set<number>([0, span]);
    // Add gate jamb positions
    for (const gate of endBackGates) {
      const centerZ = gate.positionX;
      const leftJamb = centerZ - gate.width / 2;
      const rightJamb = centerZ + gate.width / 2;
      if (leftJamb > 0.01 && leftJamb < span - 0.01) positions.add(leftJamb);
      if (rightJamb > 0.01 && rightJamb < span - 0.01) positions.add(rightJamb);
    }
    // Add filler columns between boundaries (same logic as EndColumns)
    const sorted = [...positions].sort((a, b) => a - b);
    const fillerPositions: number[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const leftZ = sorted[i];
      const rightZ = sorted[i + 1];
      const gap = rightZ - leftZ;
      // Check if this gap IS the gate span (skip filler inside gate)
      const isGateSpan = endBackGates.some((gate) => {
        const centerZ = gate.positionX;
        const lj = centerZ - gate.width / 2;
        const rj = centerZ + gate.width / 2;
        return Math.abs(leftZ - lj) < 0.01 && Math.abs(rightZ - rj) < 0.01;
      });
      if (isGateSpan) continue;
      if (gap > 3.0) {
        fillerPositions.push(leftZ + gap / 3);
        fillerPositions.push(leftZ + (2 * gap) / 3);
      } else if (gap > 0.5) {
        fillerPositions.push(leftZ + gap / 2);
      }
    }
    for (const p of fillerPositions) positions.add(p);
    return [...positions].sort((a, b) => a - b);
  }, [endBackGates, endColZPositionsUniform, span]);




  /**
   * Handle side wall click for opening placement.
   * Side walls are per-bay panels, so localPoint is relative to the panel, not the full wall.
   * This function simply centers the opening in the clicked bay without coordinate conversion.
   */
  const handleSideWallClick = (wall: WallIdentifier, bayIndex: number, event: ThreeEvent<PointerEvent>) => {
    if (!placementMode || !onPlaceOpening || !selectedOpeningType) return;
    event.stopPropagation();

    const w = openingWidth ?? 1;
    const h = openingHeight ?? 1;

    if (w > columnSpacing) return;

    const bayStart = bayIndex * columnSpacing;
    const bayEnd = (bayIndex + 1) * columnSpacing;
    const posX = (bayStart + bayEnd) / 2;

    let finalPosY: number;
    let finalSillHeight: number;
    if (selectedOpeningType === 'window') {
      finalSillHeight = sillHeight ?? 0.9;
      finalPosY = finalSillHeight + h / 2;
    } else {
      finalSillHeight = 0;
      finalPosY = h / 2;
    }
    finalPosY = Math.round(finalPosY * 10) / 10;

    const newOpening: Opening = {
      id: `opening-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: selectedOpeningType,
      width: w,
      height: h,
      wall,
      positionX: posX,
      positionY: finalPosY,
      sillHeight: finalSillHeight,
    };

    if (!fitsInWall(newOpening, params)) return;
    if (openings) {
      for (const existing of openings) {
        if (checkCollision(newOpening, existing)) return;
      }
    }
    onPlaceOpening(newOpening);
  };

  /**
   * Handle wall click for opening placement.
   * Computes local coordinates, snaps to 100mm grid, validates bounds + collision.
   * On side walls, gates are centered within the clicked bay.
   */
  const handleWallClick = (wall: WallIdentifier, wallWidth: number, event: ThreeEvent<PointerEvent>) => {
    if (!placementMode || !onPlaceOpening || !selectedOpeningType) return;
    event.stopPropagation();

    const w = openingWidth ?? 1;
    const h = openingHeight ?? 1;

    // Get the local point on the plane geometry
    const localPoint = event.point.clone();
    const mesh = event.object as THREE.Mesh;
    mesh.worldToLocal(localPoint);

    // Convert from plane-local to wall-local coordinates
    let posX = localPoint.x + wallWidth / 2;
    let posY = localPoint.y + wallHeight / 2;

    // Snap to 100mm grid
    posX = Math.round(posX * 10) / 10;
    posY = Math.round(posY * 10) / 10;

    // For side walls, center the opening within the clicked bay
    if (wall === 'side_left' || wall === 'side_right') {
      // Reject if gate is wider than bay
      if (w > columnSpacing) return;
      const bayIndex = Math.floor(posX / columnSpacing);
      const bayStart = bayIndex * columnSpacing;
      const bayEnd = bayStart + columnSpacing;
      posX = (bayStart + bayEnd) / 2;
    }

    // For gates and doors, bottom should be at ground level
    // For windows, bottom should be at sill height
    let finalPosY: number;
    let finalSillHeight: number;
    if (selectedOpeningType === 'window') {
      finalSillHeight = sillHeight ?? 0.9;
      finalPosY = finalSillHeight + h / 2;
    } else {
      // Gates and doors sit on the ground
      finalSillHeight = 0;
      finalPosY = h / 2;
    }

    // Snap Y to grid too
    finalPosY = Math.round(finalPosY * 10) / 10;

    const newOpening: Opening = {
      id: `opening-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: selectedOpeningType,
      width: w,
      height: h,
      wall,
      positionX: posX,
      positionY: finalPosY,
      sillHeight: finalSillHeight,
    };

    // Check bounds
    if (!fitsInWall(newOpening, params)) return;

    // Check collision with existing openings
    if (openings) {
      for (const existing of openings) {
        if (checkCollision(newOpening, existing)) return;
      }
    }

    onPlaceOpening(newOpening);
  };

  // Joint line (dark strip) material for visible locks/dilation at column positions
  const jointLineMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#1a1a1a',
    roughness: 0.6,
    metalness: 0.3,
    depthWrite: true,
  }), []);

  useEffect(() => {
    return () => { jointLineMaterial.dispose(); };
  }, [jointLineMaterial]);

  // Sheet gap line material (2mm dark lines between sheets)
  const sheetGapMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#353535',
    roughness: 0.7,
    metalness: 0.2,
    depthWrite: true,
  }), []);

  useEffect(() => {
    return () => { sheetGapMaterial.dispose(); };
  }, [sheetGapMaterial]);

  // Sheet module width based on wall type
  const sheetModuleWidth = useMemo(() => {
    if (isSideWallTrapezoid) {
      // T18 = 1.064m, T35 = 1.050m
      const profileType: string = sideWallProfileType;
      return profileType === 'T35' ? 1.050 : 1.064;
    }
    // Sandwich: panelWidth in mm -> meters
    return cladding.panelWidth / 1000;
  }, [isSideWallTrapezoid, sideWallProfileType, cladding.panelWidth]);

  // Module width in mm for display in SheetInfoPanel
  const sheetModuleWidthMm = useMemo(() => {
    if (isSideWallTrapezoid) {
      const profileType: string = sideWallProfileType;
      return profileType === 'T35' ? 1050 : 1064;
    }
    return cladding.panelWidth;
  }, [isSideWallTrapezoid, sideWallProfileType, cladding.panelWidth]);

  // Whether side wall sheets are laid out horizontally (strips along Y)
  const isHorizontalLayout = cladding.panelOrientation === 'horizontal';

  // Gap width between sheets (2mm) - only in horizontal layout; vertical panels have no gap
  const sheetGapWidth = isHorizontalLayout ? 0.002 : 0;

  /**
   * Compute individual sheet sizes for a given dimension (width or height).
   * Returns array of sheet sizes (in meters).
   * Used for both vertical strips (dividing along X) and horizontal strips (dividing along Y).
   * When moduleOverride is provided, it uses that instead of the default sheetModuleWidth.
   */
  const computeSheetSizes = useCallback((availableDimension: number, moduleOverride?: number): number[] => {
    const moduleW = moduleOverride ?? sheetModuleWidth;
    // Layout: [sheet][gap][sheet][gap]...[sheet] (no trailing gap)
    // numFullSheets such that numFull * moduleW + (numFull - 1) * gap <= availableDimension
    // numFull <= (availableDimension + gap) / (moduleW + gap)
    const numFull = Math.floor((availableDimension + sheetGapWidth) / (moduleW + sheetGapWidth));

    if (numFull <= 0) {
      return [availableDimension];
    }

    const usedByFull = numFull * moduleW + (numFull - 1) * sheetGapWidth;
    const remainderWidth = availableDimension - usedByFull - sheetGapWidth; // subtract gap before remainder

    const sheets: number[] = [];
    for (let i = 0; i < numFull; i++) {
      sheets.push(moduleW);
    }

    // If remainder is large enough (>= 50mm), add it as a trimmed sheet
    if (remainderWidth >= 0.05) {
      sheets.push(remainderWidth);
    } else if (remainderWidth > 0.001 && sheets.length > 0) {
      // Merge small remainder into the last full sheet
      sheets[sheets.length - 1] += remainderWidth + sheetGapWidth;
    }

    return sheets;
  }, [sheetModuleWidth, sheetGapWidth]);

  // Keep backward-compatible alias
  const computeSheetWidths = computeSheetSizes;

  // End wall sheet module width
  const endWallSheetModuleWidth = useMemo(() => {
    if (isEndWallTrapezoid) {
      return 1.064; // T18 module
    }
    return cladding.panelWidth / 1000;
  }, [isEndWallTrapezoid, cladding.panelWidth]);

  /**
   * Handle sheet click - select this sheet
   */
  const handleSheetClick = useCallback((
    wall: string,
    bayIndex: number,
    sheetIndex: number,
    length: number,
    width: number,
    color: string,
    thickness: number | undefined,
    moduleWidth: number,
    event: ThreeEvent<PointerEvent>,
  ) => {
    if (placementMode) return; // Don't select sheets in placement mode
    event.stopPropagation();
    onSelectSheet?.({
      wall,
      bayIndex,
      sheetIndex,
      length: length * 1000,
      width: width * 1000,
      color,
      thickness,
      module: moduleWidth,
    });
  }, [placementMode, onSelectSheet]);

  /**
   * Check if a sheet is currently selected
   */
  const isSheetSelected = useCallback((wall: string, bayIndex: number, sheetIndex: number): boolean => {
    if (!selectedSheet) return false;
    return selectedSheet.wall === wall && selectedSheet.bayIndex === bayIndex && selectedSheet.sheetIndex === sheetIndex;
  }, [selectedSheet]);

  // Microlining overlay material (slightly darker than sandwich panel, to show groove shadow)
  const microlineMaterialSide = useMemo(() => new THREE.MeshStandardMaterial({
    color: getRALHex(cladding.sideWallColor),
    roughness: 0.4,
    metalness: 0.1,
    side: THREE.FrontSide,
    depthWrite: true,
  }), [cladding.sideWallColor]);

  useEffect(() => {
    return () => { microlineMaterialSide.dispose(); };
  }, [microlineMaterialSide]);

  const microlineMaterialEnd = useMemo(() => new THREE.MeshStandardMaterial({
    color: getRALHex(cladding.endWallColor),
    roughness: 0.4,
    metalness: 0.1,
    side: THREE.FrontSide,
    depthWrite: true,
  }), [cladding.endWallColor]);

  useEffect(() => {
    return () => { microlineMaterialEnd.dispose(); };
  }, [microlineMaterialEnd]);

  // Column X positions for joint lines on side walls
  const columnXPositions = useMemo(() => {
    const positions: number[] = [];
    for (let i = 0; i <= numberOfBays; i++) {
      positions.push(i * columnSpacing);
    }
    return positions;
  }, [numberOfBays, columnSpacing]);

  if (!showCladding) return null;

  return (
    <group name="cladding">
      {/* Side wall panels - left (Z=0 side) */}
      {Array.from({ length: numberOfBays }).map((_, bayIndex) => {
        const bayStart = bayIndex * columnSpacing;
        const bayEnd = (bayIndex + 1) * columnSpacing;
        let panelWidth = columnSpacing - 0.020;
        let panelCenterX = (bayStart + bayEnd) / 2;

        if (bayIndex === 0) {
          const leftEdge = -(endColumnOuterOffset + endWallThicknessOffset) + (isEndWallTrapezoid ? endWallThicknessOffset : sandwichThicknessM / 2) + 0.010;
          const rightEdge = columnSpacing - 0.010;
          panelWidth = rightEdge - leftEdge;
          panelCenterX = (leftEdge + rightEdge) / 2;
        } else if (bayIndex === numberOfBays - 1) {
          const leftEdge = (numberOfBays - 1) * columnSpacing + 0.010;
          const rightEdge = hallLength + (endColumnOuterOffset + endWallThicknessOffset) - (isEndWallTrapezoid ? endWallThicknessOffset : sandwichThicknessM / 2) - 0.010;
          panelWidth = rightEdge - leftEdge;
          panelCenterX = (leftEdge + rightEdge) / 2;
        }

        // Compute color segments for this bay panel
        const panelHeightM = cladding.panelWidth / 1000;
        const numLayers = Math.floor(sideWallHeight / panelHeightM);

        const zPosition = -(columnOuterFlangeOffset + sideWallThicknessOffset);

        // Horizontal layout: sheets are horizontal strips (full panelWidth, divided along Y)
        // Vertical layout: sheets are vertical strips (divided along X, full height)
        if (isHorizontalLayout) {
          // Horizontal: divide along Y
          const sheetHeights = computeSheetSizes(sideWallHeight);
          const sheetYPositions: { y: number; height: number }[] = [];
          let currentY = 0;
          for (let si = 0; si < sheetHeights.length; si++) {
            sheetYPositions.push({ y: currentY + sheetHeights[si] / 2, height: sheetHeights[si] });
            currentY += sheetHeights[si] + (si < sheetHeights.length - 1 ? sheetGapWidth : 0);
          }

          if (sideStripes.length === 0) {
            return (
              <React.Fragment key={`side-left-${bayIndex}`}>
                {sheetYPositions.map((sheet, sheetIdx) => {
                  const selected = isSheetSelected('side_left', bayIndex, sheetIdx);
                  return (
                    <SheetMesh
                      key={`side-left-${bayIndex}-sheet-${sheetIdx}`}
                      sheetWidth={panelWidth}
                      sheetHeight={sheet.height}
                      position={[panelCenterX, sheet.y, zPosition]}
                      isTrapezoid={isSideWallTrapezoid}
                      profileType={sideWallProfileType}
                      waveAxis={wallWaveAxis}
                      sandwichThickness={sandwichThicknessM}
                      baseMaterial={sideWallMat}
                      selected={selected}
                      onPointerDown={placementMode
                        ? (e) => handleSideWallClick('side_left', bayIndex, e)
                        : (e) => handleSheetClick('side_left', bayIndex, sheetIdx, sheet.height, panelWidth, cladding.sideWallColor, isSideWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100), sheetModuleWidthMm, e)
                      }
                    />
                  );
                })}
                {/* Gap lines between horizontal sheets */}
                {sheetYPositions.slice(0, -1).map((sheet, gapIdx) => (
                  <mesh
                    key={`side-left-${bayIndex}-gap-${gapIdx}`}
                    position={[panelCenterX, sheet.y + sheet.height / 2 + sheetGapWidth / 2, zPosition]}
                    material={sheetGapMaterial}
                  >
                    <boxGeometry args={[panelWidth, sheetGapWidth, 0.015]} />
                  </mesh>
                ))}
              </React.Fragment>
            );
          }

          // With color stripes: determine color per horizontal sheet based on its Y position
          return (
            <React.Fragment key={`side-left-${bayIndex}`}>
              {sheetYPositions.map((sheet, sheetIdx) => {
                // Determine color: find stripe that covers this sheet's center layer
                const sheetCenterY = sheet.y;
                const layerAtCenter = Math.floor(sheetCenterY / panelHeightM) + 1;
                const stripe = sideStripes.find(s => layerAtCenter >= s.layerStart && layerAtCenter <= s.layerEnd);
                const sheetColor = stripe ? stripe.color : cladding.sideWallColor;
                const segMat = sheetColor === cladding.sideWallColor ? sideWallMat : makeCladdingMaterial(sheetColor);
                const selected = isSheetSelected('side_left', bayIndex, sheetIdx);
                return (
                  <SheetMesh
                    key={`side-left-${bayIndex}-sheet-${sheetIdx}`}
                    sheetWidth={panelWidth}
                    sheetHeight={sheet.height}
                    position={[panelCenterX, sheet.y, zPosition]}
                    isTrapezoid={isSideWallTrapezoid}
                    profileType={sideWallProfileType}
                    waveAxis={wallWaveAxis}
                    sandwichThickness={sandwichThicknessM}
                    baseMaterial={segMat}
                    selected={selected}
                    onPointerDown={placementMode
                      ? (e) => handleSideWallClick('side_left', bayIndex, e)
                      : (e) => handleSheetClick('side_left', bayIndex, sheetIdx, sheet.height, panelWidth, sheetColor, isSideWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100), sheetModuleWidthMm, e)
                    }
                  />
                );
              })}
              {/* Gap lines between horizontal sheets */}
              {sheetYPositions.slice(0, -1).map((sheet, gapIdx) => (
                <mesh
                  key={`side-left-${bayIndex}-gap-${gapIdx}`}
                  position={[panelCenterX, sheet.y + sheet.height / 2 + sheetGapWidth / 2, zPosition]}
                  material={sheetGapMaterial}
                >
                  <boxGeometry args={[panelWidth, sheetGapWidth, 0.015]} />
                </mesh>
              ))}
            </React.Fragment>
          );
        }

        // Vertical layout (default): divide along X
        // Compute individual sheet widths for this bay
        const sheetWidths = computeSheetWidths(panelWidth);
        const panelLeftEdge = panelCenterX - panelWidth / 2;

        // Compute sheet X positions (left edge of each sheet)
        const sheetPositions: { x: number; width: number }[] = [];
        let currentX = panelLeftEdge;
        for (let si = 0; si < sheetWidths.length; si++) {
          sheetPositions.push({ x: currentX + sheetWidths[si] / 2, width: sheetWidths[si] });
          currentX += sheetWidths[si] + (si < sheetWidths.length - 1 ? sheetGapWidth : 0);
        }

        // When no color stripes, render individual sheets covering full sideWallHeight
        if (sideStripes.length === 0) {
          return (
            <React.Fragment key={`side-left-${bayIndex}`}>
              {sheetPositions.map((sheet, sheetIdx) => {
                const selected = isSheetSelected('side_left', bayIndex, sheetIdx);
                return (
                  <SheetMesh
                    key={`side-left-${bayIndex}-sheet-${sheetIdx}`}
                    sheetWidth={sheet.width}
                    sheetHeight={sideWallHeight}
                    position={[sheet.x, sideWallHeight / 2, zPosition]}
                    isTrapezoid={isSideWallTrapezoid}
                    profileType={sideWallProfileType}
                    waveAxis={wallWaveAxis}
                    sandwichThickness={sandwichThicknessM}
                    baseMaterial={sideWallMat}
                    selected={selected}
                    onPointerDown={placementMode
                      ? (e) => handleSideWallClick('side_left', bayIndex, e)
                      : (e) => handleSheetClick('side_left', bayIndex, sheetIdx, sideWallHeight, sheet.width, cladding.sideWallColor, isSideWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100), sheetModuleWidthMm, e)
                    }
                  />
                );
              })}
              {/* Gap lines between sheets (only when gap > 0) */}
              {sheetGapWidth > 0 && sheetPositions.slice(0, -1).map((sheet, gapIdx) => (
                <mesh
                  key={`side-left-${bayIndex}-gap-${gapIdx}`}
                  position={[sheet.x + sheet.width / 2 + sheetGapWidth / 2, sideWallHeight / 2, zPosition]}
                  material={sheetGapMaterial}
                >
                  <boxGeometry args={[sheetGapWidth, sideWallHeight, 0.015]} />
                </mesh>
              ))}
            </React.Fragment>
          );
        }

        const layerColors: string[] = [];
        for (let layer = 1; layer <= numLayers; layer++) {
          const stripe = sideStripes.find(s => layer >= s.layerStart && layer <= s.layerEnd);
          layerColors.push(stripe ? stripe.color : cladding.sideWallColor);
        }

        const segments: ColorSegment[] = [];
        if (numLayers > 0) {
          let currentColor = layerColors[0];
          let segStartLayer = 1;
          for (let i = 1; i < layerColors.length; i++) {
            if (layerColors[i] !== currentColor) {
              segments.push({ startLayer: segStartLayer, endLayer: i, color: currentColor });
              currentColor = layerColors[i];
              segStartLayer = i + 1;
            }
          }
          segments.push({ startLayer: segStartLayer, endLayer: numLayers, color: currentColor });
        }

        // Ensure segments cover the full sideWallHeight: if numLayers * panelHeightM < sideWallHeight,
        // extend the last segment to reach sideWallHeight
        const coveredHeight = numLayers * panelHeightM;
        const remainder = sideWallHeight - coveredHeight;

        return (
          <React.Fragment key={`side-left-${bayIndex}`}>
            {segments.map((seg, segIdx) => {
              let segHeight = (seg.endLayer - seg.startLayer + 1) * panelHeightM;
              const segBottomY = (seg.startLayer - 1) * panelHeightM;
              // Add remainder to the last segment so it reaches sideWallHeight
              if (segIdx === segments.length - 1 && remainder > 0.0001) {
                segHeight += remainder;
              }
              const segCenterY = segBottomY + segHeight / 2;
              const segMat = seg.color === cladding.sideWallColor ? sideWallMat : makeCladdingMaterial(seg.color);

              return (
                <React.Fragment key={`side-left-${bayIndex}-seg-${segIdx}`}>
                  {sheetPositions.map((sheet, sheetIdx) => {
                    const selected = isSheetSelected('side_left', bayIndex, sheetIdx);
                    return (
                      <SheetMesh
                        key={`side-left-${bayIndex}-seg-${segIdx}-sheet-${sheetIdx}`}
                        sheetWidth={sheet.width}
                        sheetHeight={segHeight}
                        position={[sheet.x, segCenterY, zPosition]}
                        isTrapezoid={isSideWallTrapezoid}
                        profileType={sideWallProfileType}
                        waveAxis={wallWaveAxis}
                        sandwichThickness={sandwichThicknessM}
                        baseMaterial={segMat}
                        selected={selected}
                        onPointerDown={placementMode
                          ? (e) => handleSideWallClick('side_left', bayIndex, e)
                          : (e) => handleSheetClick('side_left', bayIndex, sheetIdx, segHeight, sheet.width, seg.color, isSideWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100), sheetModuleWidthMm, e)
                        }
                      />
                    );
                  })}
                  {/* Gap lines between sheets in this segment (only when gap > 0) */}
                  {sheetGapWidth > 0 && sheetPositions.slice(0, -1).map((sheet, gapIdx) => (
                    <mesh
                      key={`side-left-${bayIndex}-seg-${segIdx}-gap-${gapIdx}`}
                      position={[sheet.x + sheet.width / 2 + sheetGapWidth / 2, segCenterY, zPosition]}
                      material={sheetGapMaterial}
                    >
                      <boxGeometry args={[sheetGapWidth, segHeight, 0.015]} />
                    </mesh>
                  ))}
                </React.Fragment>
              );
            })}
          </React.Fragment>
        );
      })}

      {/* Side wall panels - right (Z=span side) */}
      {Array.from({ length: numberOfBays }).map((_, bayIndex) => {
        const bayStart = bayIndex * columnSpacing;
        const bayEnd = (bayIndex + 1) * columnSpacing;
        let panelWidth = columnSpacing - 0.020;
        let panelCenterX = (bayStart + bayEnd) / 2;

        if (bayIndex === 0) {
          const leftEdge = -(endColumnOuterOffset + endWallThicknessOffset) + (isEndWallTrapezoid ? endWallThicknessOffset : sandwichThicknessM / 2) + 0.010;
          const rightEdge = columnSpacing - 0.010;
          panelWidth = rightEdge - leftEdge;
          panelCenterX = (leftEdge + rightEdge) / 2;
        } else if (bayIndex === numberOfBays - 1) {
          const leftEdge = (numberOfBays - 1) * columnSpacing + 0.010;
          const rightEdge = hallLength + (endColumnOuterOffset + endWallThicknessOffset) - (isEndWallTrapezoid ? endWallThicknessOffset : sandwichThicknessM / 2) - 0.010;
          panelWidth = rightEdge - leftEdge;
          panelCenterX = (leftEdge + rightEdge) / 2;
        }

        // Compute color segments for this bay panel
        const panelHeightM = cladding.panelWidth / 1000;
        const numLayers = Math.floor(sideWallHeight / panelHeightM);

        const zPosition = span + columnOuterFlangeOffset + sideWallThicknessOffset;

        // Horizontal layout: sheets are horizontal strips (full panelWidth, divided along Y)
        // Vertical layout: sheets are vertical strips (divided along X, full height)
        if (isHorizontalLayout) {
          // Horizontal: divide along Y
          const sheetHeights = computeSheetSizes(sideWallHeight);
          const sheetYPositions: { y: number; height: number }[] = [];
          let currentY = 0;
          for (let si = 0; si < sheetHeights.length; si++) {
            sheetYPositions.push({ y: currentY + sheetHeights[si] / 2, height: sheetHeights[si] });
            currentY += sheetHeights[si] + (si < sheetHeights.length - 1 ? sheetGapWidth : 0);
          }

          if (sideStripes.length === 0) {
            return (
              <React.Fragment key={`side-right-${bayIndex}`}>
                {sheetYPositions.map((sheet, sheetIdx) => {
                  const selected = isSheetSelected('side_right', bayIndex, sheetIdx);
                  return (
                    <SheetMesh
                      key={`side-right-${bayIndex}-sheet-${sheetIdx}`}
                      sheetWidth={panelWidth}
                      sheetHeight={sheet.height}
                      position={[panelCenterX, sheet.y, zPosition]}
                      rotation={[0, Math.PI, 0]}
                      isTrapezoid={isSideWallTrapezoid}
                      profileType={sideWallProfileType}
                      waveAxis={wallWaveAxis}
                      sandwichThickness={sandwichThicknessM}
                      baseMaterial={sideWallMat}
                      selected={selected}
                      onPointerDown={placementMode
                        ? (e) => handleSideWallClick('side_right', bayIndex, e)
                        : (e) => handleSheetClick('side_right', bayIndex, sheetIdx, sheet.height, panelWidth, cladding.sideWallColor, isSideWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100), sheetModuleWidthMm, e)
                      }
                    />
                  );
                })}
                {/* Gap lines between horizontal sheets */}
                {sheetYPositions.slice(0, -1).map((sheet, gapIdx) => (
                  <mesh
                    key={`side-right-${bayIndex}-gap-${gapIdx}`}
                    position={[panelCenterX, sheet.y + sheet.height / 2 + sheetGapWidth / 2, zPosition]}
                    material={sheetGapMaterial}
                  >
                    <boxGeometry args={[panelWidth, sheetGapWidth, 0.015]} />
                  </mesh>
                ))}
              </React.Fragment>
            );
          }

          // With color stripes: determine color per horizontal sheet based on its Y position
          return (
            <React.Fragment key={`side-right-${bayIndex}`}>
              {sheetYPositions.map((sheet, sheetIdx) => {
                const sheetCenterY = sheet.y;
                const layerAtCenter = Math.floor(sheetCenterY / panelHeightM) + 1;
                const stripe = sideStripes.find(s => layerAtCenter >= s.layerStart && layerAtCenter <= s.layerEnd);
                const sheetColor = stripe ? stripe.color : cladding.sideWallColor;
                const segMat = sheetColor === cladding.sideWallColor ? sideWallMat : makeCladdingMaterial(sheetColor);
                const selected = isSheetSelected('side_right', bayIndex, sheetIdx);
                return (
                  <SheetMesh
                    key={`side-right-${bayIndex}-sheet-${sheetIdx}`}
                    sheetWidth={panelWidth}
                    sheetHeight={sheet.height}
                    position={[panelCenterX, sheet.y, zPosition]}
                    rotation={[0, Math.PI, 0]}
                    isTrapezoid={isSideWallTrapezoid}
                    profileType={sideWallProfileType}
                    waveAxis={wallWaveAxis}
                    sandwichThickness={sandwichThicknessM}
                    baseMaterial={segMat}
                    selected={selected}
                    onPointerDown={placementMode
                      ? (e) => handleSideWallClick('side_right', bayIndex, e)
                      : (e) => handleSheetClick('side_right', bayIndex, sheetIdx, sheet.height, panelWidth, sheetColor, isSideWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100), sheetModuleWidthMm, e)
                    }
                  />
                );
              })}
              {/* Gap lines between horizontal sheets */}
              {sheetYPositions.slice(0, -1).map((sheet, gapIdx) => (
                <mesh
                  key={`side-right-${bayIndex}-gap-${gapIdx}`}
                  position={[panelCenterX, sheet.y + sheet.height / 2 + sheetGapWidth / 2, zPosition]}
                  material={sheetGapMaterial}
                >
                  <boxGeometry args={[panelWidth, sheetGapWidth, 0.015]} />
                </mesh>
              ))}
            </React.Fragment>
          );
        }

        // Vertical layout (default): divide along X
        // Compute individual sheet widths for this bay
        const sheetWidths = computeSheetWidths(panelWidth);
        const panelLeftEdge = panelCenterX - panelWidth / 2;

        // Compute sheet X positions (center of each sheet)
        const sheetPositions: { x: number; width: number }[] = [];
        let currentX = panelLeftEdge;
        for (let si = 0; si < sheetWidths.length; si++) {
          sheetPositions.push({ x: currentX + sheetWidths[si] / 2, width: sheetWidths[si] });
          currentX += sheetWidths[si] + (si < sheetWidths.length - 1 ? sheetGapWidth : 0);
        }

        // When no color stripes, render individual sheets covering full sideWallHeight
        if (sideStripes.length === 0) {
          return (
            <React.Fragment key={`side-right-${bayIndex}`}>
              {sheetPositions.map((sheet, sheetIdx) => {
                const selected = isSheetSelected('side_right', bayIndex, sheetIdx);
                return (
                  <SheetMesh
                    key={`side-right-${bayIndex}-sheet-${sheetIdx}`}
                    sheetWidth={sheet.width}
                    sheetHeight={sideWallHeight}
                    position={[sheet.x, sideWallHeight / 2, zPosition]}
                    rotation={[0, Math.PI, 0]}
                    isTrapezoid={isSideWallTrapezoid}
                    profileType={sideWallProfileType}
                    waveAxis={wallWaveAxis}
                    sandwichThickness={sandwichThicknessM}
                    baseMaterial={sideWallMat}
                    selected={selected}
                    onPointerDown={placementMode
                      ? (e) => handleSideWallClick('side_right', bayIndex, e)
                      : (e) => handleSheetClick('side_right', bayIndex, sheetIdx, sideWallHeight, sheet.width, cladding.sideWallColor, isSideWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100), sheetModuleWidthMm, e)
                    }
                  />
                );
              })}
              {/* Gap lines between sheets (only when gap > 0) */}
              {sheetGapWidth > 0 && sheetPositions.slice(0, -1).map((sheet, gapIdx) => (
                <mesh
                  key={`side-right-${bayIndex}-gap-${gapIdx}`}
                  position={[sheet.x + sheet.width / 2 + sheetGapWidth / 2, sideWallHeight / 2, zPosition]}
                  material={sheetGapMaterial}
                >
                  <boxGeometry args={[sheetGapWidth, sideWallHeight, 0.015]} />
                </mesh>
              ))}
            </React.Fragment>
          );
        }

        const layerColors: string[] = [];
        for (let layer = 1; layer <= numLayers; layer++) {
          const stripe = sideStripes.find(s => layer >= s.layerStart && layer <= s.layerEnd);
          layerColors.push(stripe ? stripe.color : cladding.sideWallColor);
        }

        const segments: ColorSegment[] = [];
        if (numLayers > 0) {
          let currentColor = layerColors[0];
          let segStartLayer = 1;
          for (let i = 1; i < layerColors.length; i++) {
            if (layerColors[i] !== currentColor) {
              segments.push({ startLayer: segStartLayer, endLayer: i, color: currentColor });
              currentColor = layerColors[i];
              segStartLayer = i + 1;
            }
          }
          segments.push({ startLayer: segStartLayer, endLayer: numLayers, color: currentColor });
        }

        // Ensure segments cover the full sideWallHeight: if numLayers * panelHeightM < sideWallHeight,
        // extend the last segment to reach sideWallHeight
        const coveredHeight = numLayers * panelHeightM;
        const remainder = sideWallHeight - coveredHeight;

        return (
          <React.Fragment key={`side-right-${bayIndex}`}>
            {segments.map((seg, segIdx) => {
              let segHeight = (seg.endLayer - seg.startLayer + 1) * panelHeightM;
              const segBottomY = (seg.startLayer - 1) * panelHeightM;
              // Add remainder to the last segment so it reaches sideWallHeight
              if (segIdx === segments.length - 1 && remainder > 0.0001) {
                segHeight += remainder;
              }
              const segCenterY = segBottomY + segHeight / 2;
              const segMat = seg.color === cladding.sideWallColor ? sideWallMat : makeCladdingMaterial(seg.color);

              return (
                <React.Fragment key={`side-right-${bayIndex}-seg-${segIdx}`}>
                  {sheetPositions.map((sheet, sheetIdx) => {
                    const selected = isSheetSelected('side_right', bayIndex, sheetIdx);
                    return (
                      <SheetMesh
                        key={`side-right-${bayIndex}-seg-${segIdx}-sheet-${sheetIdx}`}
                        sheetWidth={sheet.width}
                        sheetHeight={segHeight}
                        position={[sheet.x, segCenterY, zPosition]}
                        rotation={[0, Math.PI, 0]}
                        isTrapezoid={isSideWallTrapezoid}
                        profileType={sideWallProfileType}
                        waveAxis={wallWaveAxis}
                        sandwichThickness={sandwichThicknessM}
                        baseMaterial={segMat}
                        selected={selected}
                        onPointerDown={placementMode
                          ? (e) => handleSideWallClick('side_right', bayIndex, e)
                          : (e) => handleSheetClick('side_right', bayIndex, sheetIdx, segHeight, sheet.width, seg.color, isSideWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100), sheetModuleWidthMm, e)
                        }
                      />
                    );
                  })}
                  {/* Gap lines between sheets in this segment (only when gap > 0) */}
                  {sheetGapWidth > 0 && sheetPositions.slice(0, -1).map((sheet, gapIdx) => (
                    <mesh
                      key={`side-right-${bayIndex}-seg-${segIdx}-gap-${gapIdx}`}
                      position={[sheet.x + sheet.width / 2 + sheetGapWidth / 2, segCenterY, zPosition]}
                      material={sheetGapMaterial}
                    >
                      <boxGeometry args={[sheetGapWidth, segHeight, 0.015]} />
                    </mesh>
                  ))}
                </React.Fragment>
              );
            })}
          </React.Fragment>
        );
      })}



      {/* End wall panels - front (X = -(endColumnOuterOffset + endWallThicknessOffset)) */}
      {(() => {
        const xPos = -(endColumnOuterOffset + endWallThicknessOffset);
        const endWallProfileType: 'T18' | 'T35' = 'T18';
        const panelHeightM = cladding.panelWidth / 1000;
        const numLayers = Math.floor(wallHeight / panelHeightM);
        const elements: React.ReactNode[] = [];

        // End wall sheet module width is computed at component level (endWallSheetModuleWidth)

        // Rectangular panels between columns - with sheet subdivision
        for (let i = 0; i < endColZPositionsFront.length - 1; i++) {
          let zLeft = endColZPositionsFront[i];
          let zRight = endColZPositionsFront[i + 1];

          // Fix 2: Widen corner panels to cover side wall thickness
          if (i === 0) {
            zLeft = -(columnOuterFlangeOffset + 2 * sideWallThicknessOffset);
          }
          if (i === endColZPositionsFront.length - 2) {
            zRight = span + columnOuterFlangeOffset + 2 * sideWallThicknessOffset;
          }

          const panelWidth = (zRight - zLeft) - 0.020; // 20mm dilation
          const panelCenterZ = (zLeft + zRight) / 2;

          if (isHorizontalLayout) {
            // Horizontal layout: sheets are horizontal strips (full panelWidth, divided along Y)
            const endSheetHeights = computeSheetSizes(wallHeight, endWallSheetModuleWidth);
            const endSheetYPositions: { y: number; height: number }[] = [];
            let cy = 0;
            for (let si = 0; si < endSheetHeights.length; si++) {
              endSheetYPositions.push({ y: cy + endSheetHeights[si] / 2, height: endSheetHeights[si] });
              cy += endSheetHeights[si] + (si < endSheetHeights.length - 1 ? sheetGapWidth : 0);
            }

            if (endStripes.length === 0) {
              endSheetYPositions.forEach((sheet, sheetIdx) => {
                const selected = isSheetSelected('end_front', i, sheetIdx);
                elements.push(
                  <SheetMesh
                    key={`end-front-panel-${i}-sheet-${sheetIdx}`}
                    sheetWidth={panelWidth}
                    sheetHeight={sheet.height}
                    position={[xPos, sheet.y, panelCenterZ]}
                    rotation={[0, Math.PI / 2, 0]}
                    isTrapezoid={isEndWallTrapezoid}
                    profileType={endWallProfileType}
                    waveAxis={wallWaveAxis}
                    sandwichThickness={sandwichThicknessM}
                    baseMaterial={endWallMat}
                    selected={selected}
                    onPointerDown={placementMode
                      ? (e) => handleWallClick('end_front', span, e)
                      : (e) => handleSheetClick('end_front', i, sheetIdx, sheet.height, panelWidth, cladding.endWallColor, isEndWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100), endWallSheetModuleWidth * 1000, e)
                    }
                  />
                );
              });
              // Gap lines between horizontal sheets
              endSheetYPositions.slice(0, -1).forEach((sheet, gapIdx) => {
                elements.push(
                  <mesh
                    key={`end-front-panel-${i}-gap-${gapIdx}`}
                    position={[xPos, sheet.y + sheet.height / 2 + sheetGapWidth / 2, panelCenterZ]}
                    rotation={[0, Math.PI / 2, 0]}
                    material={sheetGapMaterial}
                  >
                    <boxGeometry args={[panelWidth, sheetGapWidth, 0.015]} />
                  </mesh>
                );
              });
            } else {
              // With color stripes: determine color per horizontal sheet
              endSheetYPositions.forEach((sheet, sheetIdx) => {
                const sheetCenterY = sheet.y;
                const layerAtCenter = Math.floor(sheetCenterY / panelHeightM) + 1;
                const stripe = endStripes.find(s => layerAtCenter >= s.layerStart && layerAtCenter <= s.layerEnd);
                const sheetColor = stripe ? stripe.color : cladding.endWallColor;
                const segMat = sheetColor === cladding.endWallColor ? endWallMat : makeCladdingMaterial(sheetColor);
                const selected = isSheetSelected('end_front', i, sheetIdx);
                elements.push(
                  <SheetMesh
                    key={`end-front-panel-${i}-sheet-${sheetIdx}`}
                    sheetWidth={panelWidth}
                    sheetHeight={sheet.height}
                    position={[xPos, sheet.y, panelCenterZ]}
                    rotation={[0, Math.PI / 2, 0]}
                    isTrapezoid={isEndWallTrapezoid}
                    profileType={endWallProfileType}
                    waveAxis={wallWaveAxis}
                    sandwichThickness={sandwichThicknessM}
                    baseMaterial={segMat}
                    selected={selected}
                    onPointerDown={placementMode
                      ? (e) => handleWallClick('end_front', span, e)
                      : (e) => handleSheetClick('end_front', i, sheetIdx, sheet.height, panelWidth, sheetColor, isEndWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100), endWallSheetModuleWidth * 1000, e)
                    }
                  />
                );
              });
              // Gap lines between horizontal sheets
              endSheetYPositions.slice(0, -1).forEach((sheet, gapIdx) => {
                elements.push(
                  <mesh
                    key={`end-front-panel-${i}-gap-${gapIdx}`}
                    position={[xPos, sheet.y + sheet.height / 2 + sheetGapWidth / 2, panelCenterZ]}
                    rotation={[0, Math.PI / 2, 0]}
                    material={sheetGapMaterial}
                  >
                    <boxGeometry args={[panelWidth, sheetGapWidth, 0.015]} />
                  </mesh>
                );
              });
            }
          } else {
            // Vertical layout: sheets are vertical strips (divided along X/Z, full height)
            // Compute sheet widths for this end wall panel
            const endSheetWidths = computeSheetSizes(panelWidth, endWallSheetModuleWidth);
            const endPanelLeftEdge = panelCenterZ - panelWidth / 2;
            const endSheetPositions: { z: number; width: number }[] = [];
            let cz = endPanelLeftEdge;
            for (let si = 0; si < endSheetWidths.length; si++) {
              endSheetPositions.push({ z: cz + endSheetWidths[si] / 2, width: endSheetWidths[si] });
              cz += endSheetWidths[si] + (si < endSheetWidths.length - 1 ? sheetGapWidth : 0);
            }

            if (endStripes.length === 0) {
              // Render individual sheets for this panel section
              endSheetPositions.forEach((sheet, sheetIdx) => {
                const selected = isSheetSelected('end_front', i, sheetIdx);
                elements.push(
                  <SheetMesh
                    key={`end-front-panel-${i}-sheet-${sheetIdx}`}
                    sheetWidth={sheet.width}
                    sheetHeight={wallHeight}
                    position={[xPos, wallHeight / 2, sheet.z]}
                    rotation={[0, Math.PI / 2, 0]}
                    isTrapezoid={isEndWallTrapezoid}
                    profileType={endWallProfileType}
                    waveAxis={wallWaveAxis}
                    sandwichThickness={sandwichThicknessM}
                    baseMaterial={endWallMat}
                    selected={selected}
                    onPointerDown={placementMode
                      ? (e) => handleWallClick('end_front', span, e)
                      : (e) => handleSheetClick('end_front', i, sheetIdx, wallHeight, sheet.width, cladding.endWallColor, isEndWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100), endWallSheetModuleWidth * 1000, e)
                    }
                  />
                );
              });
              // Gap lines between sheets
              endSheetPositions.slice(0, -1).forEach((sheet, gapIdx) => {
                elements.push(
                  <mesh
                    key={`end-front-panel-${i}-gap-${gapIdx}`}
                    position={[xPos, wallHeight / 2, sheet.z + sheet.width / 2 + sheetGapWidth / 2]}
                    rotation={[0, Math.PI / 2, 0]}
                    material={sheetGapMaterial}
                  >
                    <boxGeometry args={[sheetGapWidth, wallHeight, 0.015]} />
                  </mesh>
                );
              });
            } else {
              // Color stripe segments per panel
              const layerColors: string[] = [];
              for (let layer = 1; layer <= numLayers; layer++) {
                const stripe = endStripes.find(s => layer >= s.layerStart && layer <= s.layerEnd);
                layerColors.push(stripe ? stripe.color : cladding.endWallColor);
              }

              const segments: ColorSegment[] = [];
              if (numLayers > 0) {
                let currentColor = layerColors[0];
                let segStartLayer = 1;
                for (let li = 1; li < layerColors.length; li++) {
                  if (layerColors[li] !== currentColor) {
                    segments.push({ startLayer: segStartLayer, endLayer: li, color: currentColor });
                    currentColor = layerColors[li];
                    segStartLayer = li + 1;
                  }
                }
                segments.push({ startLayer: segStartLayer, endLayer: numLayers, color: currentColor });
              }

              const coveredHeight = numLayers * panelHeightM;
              const remainder = wallHeight - coveredHeight;

              segments.forEach((seg, segIdx) => {
                let segHeight = (seg.endLayer - seg.startLayer + 1) * panelHeightM;
                const segBottomY = (seg.startLayer - 1) * panelHeightM;
                if (segIdx === segments.length - 1 && remainder > 0.0001) {
                  segHeight += remainder;
                }
                const segCenterY = segBottomY + segHeight / 2;
                const segMat = seg.color === cladding.endWallColor ? endWallMat : makeCladdingMaterial(seg.color);

                // Render individual sheets for this segment
                endSheetPositions.forEach((sheet, sheetIdx) => {
                  const selected = isSheetSelected('end_front', i, sheetIdx);
                  elements.push(
                    <SheetMesh
                      key={`end-front-panel-${i}-seg-${segIdx}-sheet-${sheetIdx}`}
                      sheetWidth={sheet.width}
                      sheetHeight={segHeight}
                      position={[xPos, segCenterY, sheet.z]}
                      rotation={[0, Math.PI / 2, 0]}
                      isTrapezoid={isEndWallTrapezoid}
                      profileType={endWallProfileType}
                      waveAxis={wallWaveAxis}
                      sandwichThickness={sandwichThicknessM}
                      baseMaterial={segMat}
                      selected={selected}
                      onPointerDown={placementMode
                        ? (e) => handleWallClick('end_front', span, e)
                        : (e) => handleSheetClick('end_front', i, sheetIdx, segHeight, sheet.width, seg.color, isEndWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100), endWallSheetModuleWidth * 1000, e)
                      }
                    />
                  );
                });
                // Gap lines between sheets in this segment
                endSheetPositions.slice(0, -1).forEach((sheet, gapIdx) => {
                  elements.push(
                    <mesh
                      key={`end-front-panel-${i}-seg-${segIdx}-gap-${gapIdx}`}
                      position={[xPos, segCenterY, sheet.z + sheet.width / 2 + sheetGapWidth / 2]}
                      rotation={[0, Math.PI / 2, 0]}
                      material={sheetGapMaterial}
                    >
                      <boxGeometry args={[sheetGapWidth, segHeight, 0.015]} />
                    </mesh>
                  );
                });
              });
            }
          }
        }

        // One straight cut line: from Y=0 at Z=0/span to Y=ridgeHeight-wallHeight-0.015 at Z=span/2
        // Height at any Z position along this line:
        const roofLineHeightFront = (span / 2) * Math.tan(roofAngleRad) - 0.015; // max height at ridge
        const hAtZFront = (z: number) => {
          const distFromEdge = Math.min(z, span - z); // distance from nearest eave edge
          return Math.max(0, (distFromEdge / (span / 2)) * roofLineHeightFront);
        };

        // Gable panels above wallHeight - per section between columns
        for (let i = 0; i < endColZPositionsFront.length - 1; i++) {
          let zLeft = endColZPositionsFront[i];
          let zRight = endColZPositionsFront[i + 1];

          // Calculate heights at original column positions (before corner widening)
          // to avoid steps between adjacent panels at shared boundaries
          const hLeft = hAtZFront(Math.max(0, Math.min(span, zLeft)));
          const hRight = hAtZFront(Math.max(0, Math.min(span, zRight)));

          // Widen corner panels to cover side wall thickness
          if (i === 0) {
            zLeft = -(columnOuterFlangeOffset + 2 * sideWallThicknessOffset);
          }
          if (i === endColZPositionsFront.length - 2) {
            zRight = span + columnOuterFlangeOffset + 2 * sideWallThicknessOffset;
          }

          const panelWidth = (zRight - zLeft) - 0.020; // 20mm dilation
          const panelCenterZ = (zLeft + zRight) / 2;
          const avgH = (hLeft + hRight) / 2;

          if (avgH < 0.01) continue; // skip negligible panels

          const maxH = Math.max(hLeft, hRight);
          const moduleW = endWallSheetModuleWidth;
          let numLayers = Math.ceil(maxH / moduleW);
          // If remainder is less than 100mm, merge it into the last full sheet
          if (numLayers > 1 && (maxH - (numLayers - 1) * moduleW) < 0.1) {
            numLayers = numLayers - 1;
          }

          for (let layer = 0; layer < numLayers; layer++) {
            const layerBottomY = layer * moduleW;
            const layerTopY = Math.min((layer + 1) * moduleW, maxH);
            const layerHeight = layerTopY - layerBottomY;

            // Compute hLeft and hRight for this layer
            const layerHLeft = Math.min(layerHeight, Math.max(0, hLeft - layerBottomY));
            const layerHRight = Math.min(layerHeight, Math.max(0, hRight - layerBottomY));

            if (layerHLeft < 0.001 && layerHRight < 0.001) continue;

            const layerGeo = isEndWallTrapezoid
              ? createTrapezoidMeshGeometry(panelWidth, layerHRight, layerHLeft, 'T18', 'y')
              : createTrapezoidMeshGeometry(panelWidth, layerHRight, layerHLeft, null, 'y');

            const isSelected = selectedSheet?.wall === 'end_front_gable' && selectedSheet?.bayIndex === i && selectedSheet?.sheetIndex === layer;

            elements.push(
              <mesh
                key={`end-front-gable-panel-${i}-layer-${layer}`}
                position={[xPos, wallHeight + layerBottomY, panelCenterZ]}
                rotation={[0, Math.PI / 2, 0]}
                geometry={layerGeo}
                material={isSelected ? highlightedEndWallMat : endWallMat}
                onPointerDown={placementMode
                  ? (e) => handleWallClick('end_front', span, e)
                  : (e) => {
                      if (!onSelectSheet) return;
                      e.stopPropagation();
                      onSelectSheet({
                        wall: 'end_front_gable',
                        bayIndex: i,
                        sheetIndex: layer,
                        width: Math.round(panelWidth * 1000),
                        length: Math.round(layerHeight * 1000),
                        color: cladding.endWallColor,
                        thickness: isEndWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100),
                        module: Math.round(endWallSheetModuleWidth * 1000),
                      });
                    }
                }
              />
            );

            // Gap between layers handled by mesh spacing (no explicit gap geometry)
          }
        }

        {/* Gable front joint lines above wallHeight */}
        endColZPositionsFront.slice(1, -1).forEach((colZ, idx) => {
          const distFromCenter = Math.abs(colZ - span / 2);
          const lineHeight = (gableTriangleHeight - 0.10) * (1 - distFromCenter / (span / 2));
          if (lineHeight < 0.05) return;
          elements.push(
            <mesh key={`gable-front-joint-${idx}`} position={[-(endColumnOuterOffset + endWallThicknessOffset) - 0.001, wallHeight + lineHeight / 2, colZ]}>
              <boxGeometry args={[0.005, lineHeight, 0.02]} />
              <meshStandardMaterial color="#404040" />
            </mesh>
          );
        });

        return elements;
      })()}

      {/* End wall panels - back (X = hallLength + endColumnOuterOffset + endWallThicknessOffset) */}
      {(() => {
        const xPos = hallLength + endColumnOuterOffset + endWallThicknessOffset;
        const endWallProfileType: 'T18' | 'T35' = 'T18';
        const panelHeightM = cladding.panelWidth / 1000;
        const numLayers = Math.floor(wallHeight / panelHeightM);
        const elements: React.ReactNode[] = [];

        // End wall sheet module width is computed at component level (endWallSheetModuleWidth)

        // Rectangular panels between columns - with sheet subdivision
        for (let i = 0; i < endColZPositionsBack.length - 1; i++) {
          let zLeft = endColZPositionsBack[i];
          let zRight = endColZPositionsBack[i + 1];

          // Fix 2: Widen corner panels to cover side wall thickness
          if (i === 0) {
            zLeft = -(columnOuterFlangeOffset + 2 * sideWallThicknessOffset);
          }
          if (i === endColZPositionsBack.length - 2) {
            zRight = span + columnOuterFlangeOffset + 2 * sideWallThicknessOffset;
          }

          const panelWidth = (zRight - zLeft) - 0.020; // 20mm dilation
          const panelCenterZ = (zLeft + zRight) / 2;

          if (isHorizontalLayout) {
            // Horizontal layout: sheets are horizontal strips (full panelWidth, divided along Y)
            const endSheetHeights = computeSheetSizes(wallHeight, endWallSheetModuleWidth);
            const endSheetYPositions: { y: number; height: number }[] = [];
            let cy = 0;
            for (let si = 0; si < endSheetHeights.length; si++) {
              endSheetYPositions.push({ y: cy + endSheetHeights[si] / 2, height: endSheetHeights[si] });
              cy += endSheetHeights[si] + (si < endSheetHeights.length - 1 ? sheetGapWidth : 0);
            }

            if (endStripes.length === 0) {
              endSheetYPositions.forEach((sheet, sheetIdx) => {
                const selected = isSheetSelected('end_back', i, sheetIdx);
                elements.push(
                  <SheetMesh
                    key={`end-back-panel-${i}-sheet-${sheetIdx}`}
                    sheetWidth={panelWidth}
                    sheetHeight={sheet.height}
                    position={[xPos, sheet.y, panelCenterZ]}
                    rotation={[0, -Math.PI / 2, 0]}
                    isTrapezoid={isEndWallTrapezoid}
                    profileType={endWallProfileType}
                    waveAxis={wallWaveAxis}
                    sandwichThickness={sandwichThicknessM}
                    baseMaterial={endWallMat}
                    selected={selected}
                    onPointerDown={placementMode
                      ? (e) => handleWallClick('end_back', span, e)
                      : (e) => handleSheetClick('end_back', i, sheetIdx, sheet.height, panelWidth, cladding.endWallColor, isEndWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100), endWallSheetModuleWidth * 1000, e)
                    }
                  />
                );
              });
              // Gap lines between horizontal sheets
              endSheetYPositions.slice(0, -1).forEach((sheet, gapIdx) => {
                elements.push(
                  <mesh
                    key={`end-back-panel-${i}-gap-${gapIdx}`}
                    position={[xPos, sheet.y + sheet.height / 2 + sheetGapWidth / 2, panelCenterZ]}
                    rotation={[0, -Math.PI / 2, 0]}
                    material={sheetGapMaterial}
                  >
                    <boxGeometry args={[panelWidth, sheetGapWidth, 0.015]} />
                  </mesh>
                );
              });
            } else {
              // With color stripes: determine color per horizontal sheet
              endSheetYPositions.forEach((sheet, sheetIdx) => {
                const sheetCenterY = sheet.y;
                const layerAtCenter = Math.floor(sheetCenterY / panelHeightM) + 1;
                const stripe = endStripes.find(s => layerAtCenter >= s.layerStart && layerAtCenter <= s.layerEnd);
                const sheetColor = stripe ? stripe.color : cladding.endWallColor;
                const segMat = sheetColor === cladding.endWallColor ? endWallMat : makeCladdingMaterial(sheetColor);
                const selected = isSheetSelected('end_back', i, sheetIdx);
                elements.push(
                  <SheetMesh
                    key={`end-back-panel-${i}-sheet-${sheetIdx}`}
                    sheetWidth={panelWidth}
                    sheetHeight={sheet.height}
                    position={[xPos, sheet.y, panelCenterZ]}
                    rotation={[0, -Math.PI / 2, 0]}
                    isTrapezoid={isEndWallTrapezoid}
                    profileType={endWallProfileType}
                    waveAxis={wallWaveAxis}
                    sandwichThickness={sandwichThicknessM}
                    baseMaterial={segMat}
                    selected={selected}
                    onPointerDown={placementMode
                      ? (e) => handleWallClick('end_back', span, e)
                      : (e) => handleSheetClick('end_back', i, sheetIdx, sheet.height, panelWidth, sheetColor, isEndWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100), endWallSheetModuleWidth * 1000, e)
                    }
                  />
                );
              });
              // Gap lines between horizontal sheets
              endSheetYPositions.slice(0, -1).forEach((sheet, gapIdx) => {
                elements.push(
                  <mesh
                    key={`end-back-panel-${i}-gap-${gapIdx}`}
                    position={[xPos, sheet.y + sheet.height / 2 + sheetGapWidth / 2, panelCenterZ]}
                    rotation={[0, -Math.PI / 2, 0]}
                    material={sheetGapMaterial}
                  >
                    <boxGeometry args={[panelWidth, sheetGapWidth, 0.015]} />
                  </mesh>
                );
              });
            }
          } else {
            // Vertical layout: sheets are vertical strips (divided along X/Z, full height)
            // Compute sheet widths for this end wall panel
            const endSheetWidths = computeSheetSizes(panelWidth, endWallSheetModuleWidth);
            const endPanelLeftEdge = panelCenterZ - panelWidth / 2;
            const endSheetPositions: { z: number; width: number }[] = [];
            let cz = endPanelLeftEdge;
            for (let si = 0; si < endSheetWidths.length; si++) {
              endSheetPositions.push({ z: cz + endSheetWidths[si] / 2, width: endSheetWidths[si] });
              cz += endSheetWidths[si] + (si < endSheetWidths.length - 1 ? sheetGapWidth : 0);
            }

            if (endStripes.length === 0) {
              // Render individual sheets for this panel section
              endSheetPositions.forEach((sheet, sheetIdx) => {
                const selected = isSheetSelected('end_back', i, sheetIdx);
                elements.push(
                  <SheetMesh
                    key={`end-back-panel-${i}-sheet-${sheetIdx}`}
                    sheetWidth={sheet.width}
                    sheetHeight={wallHeight}
                    position={[xPos, wallHeight / 2, sheet.z]}
                    rotation={[0, -Math.PI / 2, 0]}
                    isTrapezoid={isEndWallTrapezoid}
                    profileType={endWallProfileType}
                    waveAxis={wallWaveAxis}
                    sandwichThickness={sandwichThicknessM}
                    baseMaterial={endWallMat}
                    selected={selected}
                    onPointerDown={placementMode
                      ? (e) => handleWallClick('end_back', span, e)
                      : (e) => handleSheetClick('end_back', i, sheetIdx, wallHeight, sheet.width, cladding.endWallColor, isEndWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100), endWallSheetModuleWidth * 1000, e)
                    }
                  />
                );
              });
              // Gap lines between sheets
              endSheetPositions.slice(0, -1).forEach((sheet, gapIdx) => {
                elements.push(
                  <mesh
                    key={`end-back-panel-${i}-gap-${gapIdx}`}
                    position={[xPos, wallHeight / 2, sheet.z + sheet.width / 2 + sheetGapWidth / 2]}
                    rotation={[0, -Math.PI / 2, 0]}
                    material={sheetGapMaterial}
                  >
                    <boxGeometry args={[sheetGapWidth, wallHeight, 0.015]} />
                  </mesh>
                );
              });
            } else {
              // Color stripe segments per panel
              const layerColors: string[] = [];
              for (let layer = 1; layer <= numLayers; layer++) {
                const stripe = endStripes.find(s => layer >= s.layerStart && layer <= s.layerEnd);
                layerColors.push(stripe ? stripe.color : cladding.endWallColor);
              }

              const segments: ColorSegment[] = [];
              if (numLayers > 0) {
                let currentColor = layerColors[0];
                let segStartLayer = 1;
                for (let li = 1; li < layerColors.length; li++) {
                  if (layerColors[li] !== currentColor) {
                    segments.push({ startLayer: segStartLayer, endLayer: li, color: currentColor });
                    currentColor = layerColors[li];
                    segStartLayer = li + 1;
                  }
                }
                segments.push({ startLayer: segStartLayer, endLayer: numLayers, color: currentColor });
              }

              const coveredHeight = numLayers * panelHeightM;
              const remainder = wallHeight - coveredHeight;

              segments.forEach((seg, segIdx) => {
                let segHeight = (seg.endLayer - seg.startLayer + 1) * panelHeightM;
                const segBottomY = (seg.startLayer - 1) * panelHeightM;
                if (segIdx === segments.length - 1 && remainder > 0.0001) {
                  segHeight += remainder;
                }
                const segCenterY = segBottomY + segHeight / 2;
                const segMat = seg.color === cladding.endWallColor ? endWallMat : makeCladdingMaterial(seg.color);

                // Render individual sheets for this segment
                endSheetPositions.forEach((sheet, sheetIdx) => {
                  const selected = isSheetSelected('end_back', i, sheetIdx);
                  elements.push(
                    <SheetMesh
                      key={`end-back-panel-${i}-seg-${segIdx}-sheet-${sheetIdx}`}
                      sheetWidth={sheet.width}
                      sheetHeight={segHeight}
                      position={[xPos, segCenterY, sheet.z]}
                      rotation={[0, -Math.PI / 2, 0]}
                      isTrapezoid={isEndWallTrapezoid}
                      profileType={endWallProfileType}
                      waveAxis={wallWaveAxis}
                      sandwichThickness={sandwichThicknessM}
                      baseMaterial={segMat}
                      selected={selected}
                      onPointerDown={placementMode
                        ? (e) => handleWallClick('end_back', span, e)
                        : (e) => handleSheetClick('end_back', i, sheetIdx, segHeight, sheet.width, seg.color, isEndWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100), endWallSheetModuleWidth * 1000, e)
                      }
                    />
                  );
                });
                // Gap lines between sheets in this segment
                endSheetPositions.slice(0, -1).forEach((sheet, gapIdx) => {
                  elements.push(
                    <mesh
                      key={`end-back-panel-${i}-seg-${segIdx}-gap-${gapIdx}`}
                      position={[xPos, segCenterY, sheet.z + sheet.width / 2 + sheetGapWidth / 2]}
                      rotation={[0, -Math.PI / 2, 0]}
                      material={sheetGapMaterial}
                    >
                      <boxGeometry args={[sheetGapWidth, segHeight, 0.015]} />
                    </mesh>
                  );
                });
              });
            }
          }
        }

        // One straight cut line: from Y=0 at Z=0/span to Y=ridgeHeight-wallHeight-0.015 at Z=span/2
        // Height at any Z position along this line:
        const roofLineHeightBack = (span / 2) * Math.tan(roofAngleRad) - 0.015; // max height at ridge
        const hAtZBack = (z: number) => {
          const distFromEdge = Math.min(z, span - z); // distance from nearest eave edge
          return Math.max(0, (distFromEdge / (span / 2)) * roofLineHeightBack);
        };

        // Gable panels above wallHeight - per section between columns
        for (let i = 0; i < endColZPositionsBack.length - 1; i++) {
          let zLeft = endColZPositionsBack[i];
          let zRight = endColZPositionsBack[i + 1];

          // Calculate heights at original column positions (before corner widening)
          // to avoid steps between adjacent panels at shared boundaries
          const hLeft = hAtZBack(Math.max(0, Math.min(span, zLeft)));
          const hRight = hAtZBack(Math.max(0, Math.min(span, zRight)));

          // Widen corner panels to cover side wall thickness
          if (i === 0) {
            zLeft = -(columnOuterFlangeOffset + 2 * sideWallThicknessOffset);
          }
          if (i === endColZPositionsBack.length - 2) {
            zRight = span + columnOuterFlangeOffset + 2 * sideWallThicknessOffset;
          }

          const panelWidth = (zRight - zLeft) - 0.020; // 20mm dilation
          const panelCenterZ = (zLeft + zRight) / 2;
          const avgH = (hLeft + hRight) / 2;

          if (avgH < 0.01) continue; // skip negligible panels

          const maxH = Math.max(hLeft, hRight);
          const moduleW = endWallSheetModuleWidth;
          let numLayers = Math.ceil(maxH / moduleW);
          // If remainder is less than 100mm, merge it into the last full sheet
          if (numLayers > 1 && (maxH - (numLayers - 1) * moduleW) < 0.1) {
            numLayers = numLayers - 1;
          }

          for (let layer = 0; layer < numLayers; layer++) {
            const layerBottomY = layer * moduleW;
            const layerTopY = Math.min((layer + 1) * moduleW, maxH);
            const layerHeight = layerTopY - layerBottomY;

            // Compute hLeft and hRight for this layer
            const layerHLeft = Math.min(layerHeight, Math.max(0, hLeft - layerBottomY));
            const layerHRight = Math.min(layerHeight, Math.max(0, hRight - layerBottomY));

            if (layerHLeft < 0.001 && layerHRight < 0.001) continue;

            const layerGeo = isEndWallTrapezoid
              ? createTrapezoidMeshGeometry(panelWidth, layerHLeft, layerHRight, 'T18', 'y')
              : createTrapezoidMeshGeometry(panelWidth, layerHLeft, layerHRight, null, 'y');

            const isSelected = selectedSheet?.wall === 'end_back_gable' && selectedSheet?.bayIndex === i && selectedSheet?.sheetIndex === layer;

            elements.push(
              <mesh
                key={`end-back-gable-panel-${i}-layer-${layer}`}
                position={[xPos, wallHeight + layerBottomY, panelCenterZ]}
                rotation={[0, -Math.PI / 2, 0]}
                geometry={layerGeo}
                material={isSelected ? highlightedEndWallMat : endWallMat}
                onPointerDown={placementMode
                  ? (e) => handleWallClick('end_back', span, e)
                  : (e) => {
                      if (!onSelectSheet) return;
                      e.stopPropagation();
                      onSelectSheet({
                        wall: 'end_back_gable',
                        bayIndex: i,
                        sheetIndex: layer,
                        width: Math.round(panelWidth * 1000),
                        length: Math.round(layerHeight * 1000),
                        color: cladding.endWallColor,
                        thickness: isEndWallTrapezoid ? undefined : (cladding.sandwichThickness ?? 100),
                        module: Math.round(endWallSheetModuleWidth * 1000),
                      });
                    }
                }
              />
            );

            // Gap between layers handled by mesh spacing (no explicit gap geometry)
          }
        }

        {/* Gable back joint lines above wallHeight */}
        endColZPositionsBack.slice(1, -1).forEach((colZ, idx) => {
          const distFromCenter = Math.abs(colZ - span / 2);
          const lineHeight = (gableTriangleHeight - 0.10) * (1 - distFromCenter / (span / 2));
          if (lineHeight < 0.05) return;
          elements.push(
            <mesh key={`gable-back-joint-${idx}`} position={[hallLength + endColumnOuterOffset + endWallThicknessOffset + 0.001, wallHeight + lineHeight / 2, colZ]}>
              <boxGeometry args={[0.005, lineHeight, 0.02]} />
              <meshStandardMaterial color="#404040" />
            </mesh>
          );
        });

        return elements;
      })()}



      {/* Roof - left and right slopes rendered as individual sheets */}
      {(() => {
        // Roof center Y: bottom edge of roof at eave must align with wallHeight
        const roofCenterY = wallHeight + (roofSlopeLengthWithOverhang / 2) * Math.sin(roofAngleRad);
        // Z positions: center of each slope
        const leftRoofCenterZ = (span / 2) - (roofSlopeLengthWithOverhang / 2) * Math.cos(roofAngleRad);
        const rightRoofCenterZ = (span / 2) + (roofSlopeLengthWithOverhang / 2) * Math.cos(roofAngleRad);

        // Thickness offset for sandwich roof panels (shift in local Z so bottom edge is visible from eave)
        const roofThicknessM = cladding.roofType === 'sandwich_roof' ? (cladding.roofSandwichThickness ?? 100) / 1000 : 0;
        const isSandwichRoof = roofThicknessM > 0;

        return (
          <>
            {/* Left slope sheets */}
            <group position={[hallLength / 2, roofCenterY, leftRoofCenterZ]} rotation={[Math.PI / 2 - roofAngleRad, 0, 0]}>
              {Array.from({ length: numRoofSheets }).map((_, s) => {
                const sheetW = Math.min(roofModuleWidth, roofWidth - s * roofModuleWidth) - 0.002;
                const sheetX = -roofWidth / 2 + s * roofModuleWidth + (sheetW + 0.002) / 2;
                const isSelected = selectedSheet?.wall === 'roof_left' && selectedSheet?.sheetIndex === s;
                return (
                  <React.Fragment key={`roof-left-${s}`}>
                    <mesh
                      position={[sheetX, 0, 0]}
                      material={isSelected ? highlightedRoofMat : roofMat}
                      onPointerDown={(e) => {
                        if (placementMode) return;
                        e.stopPropagation();
                        onSelectSheet?.({
                          wall: 'roof_left',
                          bayIndex: 0,
                          sheetIndex: s,
                          width: Math.round(sheetW * 1000),
                          length: Math.round(roofSlopeLengthWithOverhang * 1000),
                          color: cladding.roofColor,
                          module: Math.round(roofModuleWidth * 1000),
                          thickness: cladding.roofType === 'sandwich_roof' ? (cladding.roofSandwichThickness ?? 100) : undefined,
                        });
                      }}
                    >
                      {isSandwichRoof
                        ? <planeGeometry args={[sheetW, roofSlopeLengthWithOverhang]} />
                        : <primitive object={createTrapezoidalGeometry(sheetW, roofSlopeLengthWithOverhang, roofProfileType, 'x')} attach="geometry" />
                      }
                    </mesh>
                    {isSandwichRoof && (
                      <>
                        {/* Bottom plane */}
                        <mesh position={[sheetX, 0, -roofThicknessM]} material={isSelected ? highlightedRoofMat : roofMat}>
                          <planeGeometry args={[sheetW, roofSlopeLengthWithOverhang]} />
                        </mesh>
                        {/* Left edge */}
                        <mesh position={[sheetX - sheetW / 2, 0, -roofThicknessM / 2]} rotation={[0, Math.PI / 2, 0]} material={isSelected ? highlightedRoofMat : roofMat}>
                          <planeGeometry args={[roofThicknessM, roofSlopeLengthWithOverhang]} />
                        </mesh>
                        {/* Right edge */}
                        <mesh position={[sheetX + sheetW / 2, 0, -roofThicknessM / 2]} rotation={[0, Math.PI / 2, 0]} material={isSelected ? highlightedRoofMat : roofMat}>
                          <planeGeometry args={[roofThicknessM, roofSlopeLengthWithOverhang]} />
                        </mesh>
                        {/* Front edge (eave) */}
                        <mesh position={[sheetX, -roofSlopeLengthWithOverhang / 2, -roofThicknessM / 2]} rotation={[Math.PI / 2, 0, 0]} material={isSelected ? highlightedRoofMat : roofMat}>
                          <planeGeometry args={[sheetW, roofThicknessM]} />
                        </mesh>
                        {/* Back edge (ridge) */}
                        <mesh position={[sheetX, roofSlopeLengthWithOverhang / 2, -roofThicknessM / 2]} rotation={[Math.PI / 2, 0, 0]} material={isSelected ? highlightedRoofMat : roofMat}>
                          <planeGeometry args={[sheetW, roofThicknessM]} />
                        </mesh>
                      </>
                    )}
                  </React.Fragment>
                );
              })}
            </group>

            {/* Right slope sheets */}
            <group position={[hallLength / 2, roofCenterY, rightRoofCenterZ]} rotation={[-(Math.PI / 2 - roofAngleRad), 0, 0]}>
              {Array.from({ length: numRoofSheets }).map((_, s) => {
                const sheetW = Math.min(roofModuleWidth, roofWidth - s * roofModuleWidth) - 0.002;
                const sheetX = -roofWidth / 2 + s * roofModuleWidth + (sheetW + 0.002) / 2;
                const isSelected = selectedSheet?.wall === 'roof_right' && selectedSheet?.sheetIndex === s;
                return (
                  <React.Fragment key={`roof-right-${s}`}>
                    <mesh
                      position={[sheetX, 0, 0]}
                      material={isSelected ? highlightedRoofMat : roofMat}
                      onPointerDown={(e) => {
                        if (placementMode) return;
                        e.stopPropagation();
                        onSelectSheet?.({
                          wall: 'roof_right',
                          bayIndex: 0,
                          sheetIndex: s,
                          width: Math.round(sheetW * 1000),
                          length: Math.round(roofSlopeLengthWithOverhang * 1000),
                          color: cladding.roofColor,
                          module: Math.round(roofModuleWidth * 1000),
                          thickness: cladding.roofType === 'sandwich_roof' ? (cladding.roofSandwichThickness ?? 100) : undefined,
                        });
                      }}
                    >
                      {isSandwichRoof
                        ? <planeGeometry args={[sheetW, roofSlopeLengthWithOverhang]} />
                        : <primitive object={createTrapezoidalGeometry(sheetW, roofSlopeLengthWithOverhang, roofProfileType, 'x')} attach="geometry" />
                      }
                    </mesh>
                    {isSandwichRoof && (
                      <>
                        {/* Bottom plane */}
                        <mesh position={[sheetX, 0, -roofThicknessM]} material={isSelected ? highlightedRoofMat : roofMat}>
                          <planeGeometry args={[sheetW, roofSlopeLengthWithOverhang]} />
                        </mesh>
                        {/* Left edge */}
                        <mesh position={[sheetX - sheetW / 2, 0, -roofThicknessM / 2]} rotation={[0, Math.PI / 2, 0]} material={isSelected ? highlightedRoofMat : roofMat}>
                          <planeGeometry args={[roofThicknessM, roofSlopeLengthWithOverhang]} />
                        </mesh>
                        {/* Right edge */}
                        <mesh position={[sheetX + sheetW / 2, 0, -roofThicknessM / 2]} rotation={[0, Math.PI / 2, 0]} material={isSelected ? highlightedRoofMat : roofMat}>
                          <planeGeometry args={[roofThicknessM, roofSlopeLengthWithOverhang]} />
                        </mesh>
                        {/* Front edge (eave) */}
                        <mesh position={[sheetX, -roofSlopeLengthWithOverhang / 2, -roofThicknessM / 2]} rotation={[Math.PI / 2, 0, 0]} material={isSelected ? highlightedRoofMat : roofMat}>
                          <planeGeometry args={[sheetW, roofThicknessM]} />
                        </mesh>
                        {/* Back edge (ridge) */}
                        <mesh position={[sheetX, roofSlopeLengthWithOverhang / 2, -roofThicknessM / 2]} rotation={[Math.PI / 2, 0, 0]} material={isSelected ? highlightedRoofMat : roofMat}>
                          <planeGeometry args={[sheetW, roofThicknessM]} />
                        </mesh>
                      </>
                    )}
                  </React.Fragment>
                );
              })}
            </group>
          </>
        );
      })()}

      {/* Microlining overlay on sandwich side walls (V-groove texture) */}
      {!isSideWallTrapezoid && Array.from({ length: numberOfBays }).map((_, bayIndex) => {
        const bayStart = bayIndex * columnSpacing;
        const bayEnd = (bayIndex + 1) * columnSpacing;
        let panelWidth = columnSpacing - 0.020;
        let panelCenterX = (bayStart + bayEnd) / 2;

        if (bayIndex === 0) {
          const leftEdge = -(endColumnOuterOffset + endWallThicknessOffset) + (isEndWallTrapezoid ? endWallThicknessOffset : sandwichThicknessM / 2) + 0.010;
          const rightEdge = columnSpacing - 0.010;
          panelWidth = rightEdge - leftEdge;
          panelCenterX = (leftEdge + rightEdge) / 2;
        } else if (bayIndex === numberOfBays - 1) {
          const leftEdge = (numberOfBays - 1) * columnSpacing + 0.010;
          const rightEdge = hallLength + (endColumnOuterOffset + endWallThicknessOffset) - (isEndWallTrapezoid ? endWallThicknessOffset : sandwichThicknessM / 2) - 0.010;
          panelWidth = rightEdge - leftEdge;
          panelCenterX = (leftEdge + rightEdge) / 2;
        }

        const zLeft = -(columnOuterFlangeOffset + sideWallThicknessOffset) - 0.001;
        const zRight = span + columnOuterFlangeOffset + sideWallThicknessOffset + 0.001;

        return (
          <React.Fragment key={`microline-side-${bayIndex}`}>
            {/* Left wall microlining */}
            <mesh
              position={[panelCenterX, sideWallHeight / 2, zLeft]}
              material={microlineMaterialSide}
            >
              <primitive object={createMicrolinedGeometry(panelWidth, sideWallHeight)} attach="geometry" />
            </mesh>
            {/* Right wall microlining */}
            <mesh
              position={[panelCenterX, sideWallHeight / 2, zRight]}
              rotation={[0, Math.PI, 0]}
              material={microlineMaterialSide}
            >
              <primitive object={createMicrolinedGeometry(panelWidth, sideWallHeight)} attach="geometry" />
            </mesh>
          </React.Fragment>
        );
      })}

      {/* Joint lines (dark dilation strips) at column positions on side walls */}
      {columnXPositions.map((xPos, idx) => {
        const zLeft = -(columnOuterFlangeOffset + sideWallThicknessOffset);
        const zRight = span + columnOuterFlangeOffset + sideWallThicknessOffset;
        return (
          <React.Fragment key={`joint-${idx}`}>
            {/* Left wall joint */}
            <mesh
              position={[xPos, sideWallHeight / 2, zLeft]}
              material={jointLineMaterial}
            >
              <boxGeometry args={[0.012, sideWallHeight, 0.020]} />
            </mesh>
            {/* Right wall joint */}
            <mesh
              position={[xPos, sideWallHeight / 2, zRight]}
              material={jointLineMaterial}
            >
              <boxGeometry args={[0.012, sideWallHeight, 0.020]} />
            </mesh>
          </React.Fragment>
        );
      })}

      {/* Corner joint lines */}
      {([
        [-(endColumnOuterOffset + endWallThicknessOffset), -(columnOuterFlangeOffset + sideWallThicknessOffset)],
        [-(endColumnOuterOffset + endWallThicknessOffset), span + columnOuterFlangeOffset + sideWallThicknessOffset],
        [hallLength + endColumnOuterOffset + endWallThicknessOffset, -(columnOuterFlangeOffset + sideWallThicknessOffset)],
        [hallLength + endColumnOuterOffset + endWallThicknessOffset, span + columnOuterFlangeOffset + sideWallThicknessOffset],
      ] as [number, number][]).map(([cx, cz], i) => (
        <mesh key={`corner-joint-${i}`} position={[cx, wallHeight / 2, cz]}>
          <boxGeometry args={[0.01, wallHeight, 0.01]} />
          <meshStandardMaterial color="#303030" />
        </mesh>
      ))}


    </group>
  );
});


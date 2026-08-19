import type { HallParameters, CladdingParameters, CalculationResults, Opening } from '../types';

export interface SheetBillItem {
  type: string; // i18n key for the panel type
  thickness: number | null; // mm, only for sandwich panels
  length: number; // mm
  count: number;
}

export interface SheetBillResult {
  items: SheetBillItem[];
  totalWallSurfaceGross: number; // m2
  totalRoofSurfaceGross: number; // m2
}

/**
 * Compute individual sheet sizes for a given dimension.
 * Replicates Cladding.tsx logic: fills with full-module sheets + 2mm gaps,
 * then adds a remainder sheet if >= 50mm, otherwise merges into last sheet.
 */
function computeSheetSizes(availableDimension: number, moduleWidth: number): number[] {
  const sheetGapWidth = 0.002;
  const numFull = Math.floor((availableDimension + sheetGapWidth) / (moduleWidth + sheetGapWidth));

  if (numFull <= 0) {
    return [availableDimension];
  }

  const usedByFull = numFull * moduleWidth + (numFull - 1) * sheetGapWidth;
  const remainderWidth = availableDimension - usedByFull - sheetGapWidth;

  const sheets: number[] = [];
  for (let i = 0; i < numFull; i++) {
    sheets.push(moduleWidth);
  }

  if (remainderWidth >= 0.05) {
    sheets.push(remainderWidth);
  } else if (remainderWidth > 0.001 && sheets.length > 0) {
    sheets[sheets.length - 1] += remainderWidth + sheetGapWidth;
  }

  return sheets;
}

/**
 * Compute gate-aware end wall column Z positions.
 * Replicates Cladding.tsx logic: incorporates gate jamb positions and adds filler columns.
 */
function computeEndColPositionsForWall(
  span: number,
  gates: Opening[],
  uniformPositions: number[],
  isFront: boolean,
): number[] {
  if (gates.length === 0) return uniformPositions;

  const positions = new Set<number>([0, span]);

  // Add gate jamb positions
  for (const gate of gates) {
    const centerZ = isFront ? (span - gate.positionX) : gate.positionX;
    const leftJamb = centerZ - gate.width / 2;
    const rightJamb = centerZ + gate.width / 2;
    if (leftJamb > 0.01 && leftJamb < span - 0.01) positions.add(leftJamb);
    if (rightJamb > 0.01 && rightJamb < span - 0.01) positions.add(rightJamb);
  }

  // Add filler columns between boundaries (same logic as Cladding.tsx EndColumns)
  const sorted = [...positions].sort((a, b) => a - b);
  const fillerPositions: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const leftZ = sorted[i];
    const rightZ = sorted[i + 1];
    const gap = rightZ - leftZ;
    // Check if this gap IS the gate span (skip filler inside gate)
    const isGateSpan = gates.some((gate) => {
      const centerZ = isFront ? (span - gate.positionX) : gate.positionX;
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
}

/**
 * Check if a section between zLeft and zRight is fully occluded by a gate opening
 * on the end wall. A section is considered occluded when it falls entirely within
 * the gate's horizontal span AND the gate's height covers the full wall height.
 */
function isSectionOccludedByGate(
  zLeft: number,
  zRight: number,
  wallHeight: number,
  wallOpenings: Opening[],
  span: number,
  isFront: boolean,
): boolean {
  for (const opening of wallOpenings) {
    const centerZ = isFront ? (span - opening.positionX) : opening.positionX;
    const gateLeft = centerZ - opening.width / 2;
    const gateRight = centerZ + opening.width / 2;
    // Section must be fully within gate horizontal span
    if (zLeft >= gateLeft - 0.01 && zRight <= gateRight + 0.01) {
      // Opening must cover full wall height (sill at 0 and top reaches wall height)
      if (opening.sillHeight <= 0.01 && opening.height >= wallHeight - 0.05) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if a bay on a side wall is fully occluded by an opening.
 * An opening fully occludes a bay when the opening's height equals the wall height
 * (sill at 0, top at wallHeight) and its width covers the entire bay.
 */
function isBayFullyOccluded(
  bayStartX: number,
  bayEndX: number,
  wallHeight: number,
  wallOpenings: Opening[],
): boolean {
  for (const opening of wallOpenings) {
    // Opening position is center X; check if it covers the bay
    const openingLeft = opening.positionX - opening.width / 2;
    const openingRight = opening.positionX + opening.width / 2;
    // Opening covers the bay horizontally
    if (openingLeft <= bayStartX + 0.01 && openingRight >= bayEndX - 0.01) {
      // Opening covers full height
      if (opening.sillHeight <= 0.01 && opening.height >= wallHeight - 0.05) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Compute the bill of materials for all cladding sheets/panels on the hall.
 * Groups identical panels (same type + thickness + module + length) and returns counts.
 * All surfaces are GROSS (full panel area before any trimming).
 * Panels fully occluded by openings (gates spanning full wall height) are subtracted.
 */
export function computeSheetBill(
  params: HallParameters,
  cladding: CladdingParameters,
  results: CalculationResults,
  openings?: Opening[],
): SheetBillResult {
  const { span, length: hallLength, wallHeight, roofAngle } = params;
  const columnSpacing = results.columnSpacing;
  const numberOfFrames = results.numberOfFrames;
  const endColumnOuterOffset = results.endColumnProfile.b / 2 / 1000;
  const columnOuterFlangeOffset = results.sideColumnProfile.b / 2 / 1000;

  const numberOfBays = numberOfFrames - 1;
  const roofAngleRad = (roofAngle * Math.PI) / 180;
  const roofSlopeLength = (span / 2) / Math.cos(roofAngleRad);
  const eaveOverhangM = (cladding.eaveOverhang ?? 300) / 1000;

  const isSideWallTrapezoid = cladding.sideWallType === 'trapezoid';
  const isEndWallTrapezoid = cladding.endWallType === 'trapezoid';

  const sideWallThicknessOffset = isSideWallTrapezoid ? 0.018 : (cladding.sandwichThickness ?? 100) / 1000 / 2;
  const endWallThicknessOffset = isEndWallTrapezoid ? 0.018 : (cladding.sandwichThickness ?? 100) / 1000 / 2;

  const sandwichThicknessM = (cladding.sandwichThickness ?? 100) / 1000;

  const sideWallHeight = wallHeight - 0.05;

  // Side wall module width (meters)
  const sideWallModuleWidth = isSideWallTrapezoid ? 1.064 : cladding.panelWidth / 1000;

  // End wall module width (meters)
  const endWallModuleWidth = isEndWallTrapezoid ? 1.064 : cladding.panelWidth / 1000;

  // Roof parameters
  const roofWidth = hallLength + 2 * (endColumnOuterOffset + 2 * endWallThicknessOffset);
  const roofSlopeLengthWithOverhang = roofSlopeLength + eaveOverhangM;
  const roofModuleWidth = cladding.roofType === 'T35' ? 1.050
    : cladding.roofType === 'T18' ? 1.064
    : 1.050; // sandwich_roof
  const numRoofSheets = Math.ceil(roofWidth / roofModuleWidth);

  // Determine type i18n keys
  const sideWallTypeKey = isSideWallTrapezoid ? 'sheetBill.types.trapezoidT18' : 'sheetBill.types.sandwichWall';
  const endWallTypeKey = isEndWallTrapezoid ? 'sheetBill.types.trapezoidT18' : 'sheetBill.types.sandwichWall';
  const roofTypeKey = cladding.roofType === 'T35' ? 'sheetBill.types.trapezoidT35'
    : cladding.roofType === 'T18' ? 'sheetBill.types.trapezoidT18'
    : 'sheetBill.types.sandwichRoof';

  const sideWallThickness = isSideWallTrapezoid ? null : (cladding.sandwichThickness ?? 100);
  const endWallThickness = isEndWallTrapezoid ? null : (cladding.sandwichThickness ?? 100);
  const roofThickness = cladding.roofType === 'sandwich_roof' ? (cladding.roofSandwichThickness ?? 100) : null;

  // Filter openings by wall
  const sideLeftOpenings = (openings ?? []).filter(o => o.wall === 'side_left');
  const sideRightOpenings = (openings ?? []).filter(o => o.wall === 'side_right');
  const endFrontGates = (openings ?? []).filter(
    o => o.wall === 'end_front' && (o.type === 'sectional_gate' || o.type === 'sliding_gate')
  );
  const endBackGates = (openings ?? []).filter(
    o => o.wall === 'end_back' && (o.type === 'sectional_gate' || o.type === 'sliding_gate')
  );
  const endFrontAllOpenings = (openings ?? []).filter(o => o.wall === 'end_front');
  const endBackAllOpenings = (openings ?? []).filter(o => o.wall === 'end_back');

  // Accumulator: key -> count
  const itemMap = new Map<string, SheetBillItem>();
  let totalWallSurfaceGross = 0;
  let totalRoofSurfaceGross = 0;

  function addItem(typeKey: string, thickness: number | null, lengthMm: number, count: number) {
    const key = `${typeKey}|${thickness ?? 'null'}|${lengthMm}`;
    const existing = itemMap.get(key);
    if (existing) {
      existing.count += count;
    } else {
      itemMap.set(key, { type: typeKey, thickness, length: lengthMm, count });
    }
  }

  const isHorizontalLayout = cladding.panelOrientation === 'horizontal';

  // ============== SIDE WALLS ==============
  // 2 walls (wallIdx 0 = side_left, wallIdx 1 = side_right), each with numberOfBays bays
  for (let wallIdx = 0; wallIdx < 2; wallIdx++) {
    const wallOpenings = wallIdx === 0 ? sideLeftOpenings : sideRightOpenings;

    for (let bayIndex = 0; bayIndex < numberOfBays; bayIndex++) {
      let panelWidth = columnSpacing - 0.020;
      let bayStartX = bayIndex * columnSpacing;
      let bayEndX = (bayIndex + 1) * columnSpacing;

      if (bayIndex === 0) {
        const leftEdge = -(endColumnOuterOffset + endWallThicknessOffset)
          + (isEndWallTrapezoid ? endWallThicknessOffset : sandwichThicknessM / 2) + 0.010;
        const rightEdge = columnSpacing - 0.010;
        panelWidth = rightEdge - leftEdge;
        bayStartX = leftEdge;
        bayEndX = rightEdge;
      } else if (bayIndex === numberOfBays - 1) {
        const leftEdge = (numberOfBays - 1) * columnSpacing + 0.010;
        const rightEdge = hallLength + (endColumnOuterOffset + endWallThicknessOffset)
          - (isEndWallTrapezoid ? endWallThicknessOffset : sandwichThicknessM / 2) - 0.010;
        panelWidth = rightEdge - leftEdge;
        bayStartX = leftEdge;
        bayEndX = rightEdge;
      }

      // Skip bay if fully occluded by an opening that covers full wall height
      if (isBayFullyOccluded(bayStartX, bayEndX, wallHeight, wallOpenings)) {
        continue;
      }

      if (isHorizontalLayout) {
        // Horizontal: sheets laid horizontally, divided along Y (height)
        const sheetHeights = computeSheetSizes(sideWallHeight, sideWallModuleWidth);

        for (const sheetH of sheetHeights) {
          // For GROSS surface: if it's a trimmed sheet (last one), count full module width
          const grossHeight = sheetH < sideWallModuleWidth - 0.001 ? sideWallModuleWidth : sheetH;

          addItem(sideWallTypeKey, sideWallThickness, Math.round(panelWidth * 1000), 1);
          totalWallSurfaceGross += grossHeight * panelWidth;
        }
      } else {
        // Vertical: sheets laid vertically, divided along X (width)
        const sheetWidths = computeSheetSizes(panelWidth, sideWallModuleWidth);

        for (const sheetW of sheetWidths) {
          // For GROSS surface: if it's a trimmed sheet, count full module width
          const grossWidth = sheetW < sideWallModuleWidth - 0.001 ? sideWallModuleWidth : sheetW;

          addItem(sideWallTypeKey, sideWallThickness, Math.round(sideWallHeight * 1000), 1);
          totalWallSurfaceGross += grossWidth * sideWallHeight;
        }
      }
    }
  }

  // ============== END WALLS ==============
  // Compute uniform end column Z positions (fallback when no gates)
  const targetSpacing = 3.0;
  const n = Math.max(1, Math.round(span / targetSpacing) - 1);
  const endColZPositionsUniform: number[] = [0];
  for (let i = 1; i <= n; i++) endColZPositionsUniform.push((i / (n + 1)) * span);
  endColZPositionsUniform.push(span);
  endColZPositionsUniform.sort((a, b) => a - b);

  // Compute gate-aware positions for front and back walls
  const endColZPositionsFront = computeEndColPositionsForWall(span, endFrontGates, endColZPositionsUniform, true);
  const endColZPositionsBack = computeEndColPositionsForWall(span, endBackGates, endColZPositionsUniform, false);

  // 2 end walls (wallIdx 0 = front, wallIdx 1 = back)
  for (let wallIdx = 0; wallIdx < 2; wallIdx++) {
    const isFront = wallIdx === 0;
    const endColZPositions = isFront ? endColZPositionsFront : endColZPositionsBack;
    const wallGates = isFront ? endFrontGates : endBackGates;
    const wallAllOpenings = isFront ? endFrontAllOpenings : endBackAllOpenings;

    // Rectangular area below wallHeight
    for (let i = 0; i < endColZPositions.length - 1; i++) {
      let zLeft = endColZPositions[i];
      let zRight = endColZPositions[i + 1];

      // Widen corner panels to cover side wall thickness
      if (i === 0) {
        zLeft = -(columnOuterFlangeOffset + 2 * sideWallThicknessOffset);
      }
      if (i === endColZPositions.length - 2) {
        zRight = span + columnOuterFlangeOffset + 2 * sideWallThicknessOffset;
      }

      const panelWidth = (zRight - zLeft) - 0.020; // 20mm dilation

      // Skip section if fully occluded by a full-height opening
      if (isSectionOccludedByGate(zLeft, zRight, wallHeight, wallAllOpenings, span, isFront)) {
        continue;
      }

      if (isHorizontalLayout) {
        // Horizontal: sheets divided along Y (height) with endWallModuleWidth
        const sheetHeights = computeSheetSizes(wallHeight, endWallModuleWidth);

        for (const sheetH of sheetHeights) {
          const grossHeight = sheetH < endWallModuleWidth - 0.001 ? endWallModuleWidth : sheetH;

          addItem(endWallTypeKey, endWallThickness, Math.round(panelWidth * 1000), 1);
          totalWallSurfaceGross += grossHeight * panelWidth;
        }
      } else {
        // Vertical: sheets divided along X (width) with endWallModuleWidth
        const sheetWidths = computeSheetSizes(panelWidth, endWallModuleWidth);

        for (const sheetW of sheetWidths) {
          const grossWidth = sheetW < endWallModuleWidth - 0.001 ? endWallModuleWidth : sheetW;

          addItem(endWallTypeKey, endWallThickness, Math.round(wallHeight * 1000), 1);
          totalWallSurfaceGross += grossWidth * wallHeight;
        }
      }
    }

    // Gable triangle above wallHeight
    const gableTriangleHeight = (span / 2) * Math.tan(roofAngleRad);
    const roofLineHeight = gableTriangleHeight - 0.03;

    // Height at any Z position: triangular profile
    const hAtZ = (z: number) => {
      const distFromEdge = Math.min(z, span - z);
      return Math.max(0, (distFromEdge / (span / 2)) * roofLineHeight);
    };

    for (let i = 0; i < endColZPositions.length - 1; i++) {
      let zLeft = endColZPositions[i];
      let zRight = endColZPositions[i + 1];

      if (i === 0) {
        zLeft = -(columnOuterFlangeOffset + 2 * sideWallThicknessOffset);
      }
      if (i === endColZPositions.length - 2) {
        zRight = span + columnOuterFlangeOffset + 2 * sideWallThicknessOffset;
      }

      // Skip gable section above a gate that covers full wall height
      // (gate spans are not clad in the gable either, as there is no structure behind)
      if (isSectionOccludedByGate(zLeft, zRight, wallHeight, wallGates, span, isFront)) {
        continue;
      }

      const panelWidth = (zRight - zLeft) - 0.020;
      const panelCenterZ = (zLeft + zRight) / 2;
      const panelLeftEdgeZ = panelCenterZ - panelWidth / 2;
      const panelRightEdgeZ = panelCenterZ + panelWidth / 2;

      const hLeft = hAtZ(Math.max(0, Math.min(span, panelRightEdgeZ)));
      const hRight = hAtZ(Math.max(0, Math.min(span, panelLeftEdgeZ)));
      const maxH = Math.max(hLeft, hRight);

      if (maxH < 0.01) continue;

      const moduleW = endWallModuleWidth;
      let numLayers = Math.ceil(maxH / moduleW);
      if (numLayers > 1 && (maxH - (numLayers - 1) * moduleW) < 0.1) {
        numLayers = numLayers - 1;
      }

      for (let layer = 0; layer < numLayers; layer++) {
        const layerBottomY = layer * moduleW;
        const layerHLeft = Math.min(moduleW, Math.max(0, hLeft - layerBottomY));
        const layerHRight = Math.min(moduleW, Math.max(0, hRight - layerBottomY));

        if (layerHLeft < 0.001 && layerHRight < 0.001) continue;

        // For BILL: gable panels are treated as FULL rectangular panels (moduleW x panelWidth).
        // They are the same as wall panels - just trimmed on site.
        addItem(endWallTypeKey, endWallThickness, Math.round(panelWidth * 1000), 1);
        totalWallSurfaceGross += moduleW * panelWidth;
      }
    }
  }

  // ============== ROOF ==============
  // 2 slopes, each with numRoofSheets sheets
  const roofLengthMm = Math.round(roofSlopeLengthWithOverhang * 1000);

  // Each slope has numRoofSheets sheets of roofModuleWidth x roofSlopeLengthWithOverhang
  // Edge sheets may be trimmed but we count full module width for gross
  addItem(roofTypeKey, roofThickness, roofLengthMm, numRoofSheets * 2);

  // GROSS surface: numRoofSheets * roofModuleWidth * roofSlopeLengthWithOverhang * 2 slopes
  totalRoofSurfaceGross += numRoofSheets * roofModuleWidth * roofSlopeLengthWithOverhang * 2;

  // Convert map to array
  const items = Array.from(itemMap.values());

  return {
    items,
    totalWallSurfaceGross: Math.round(totalWallSurfaceGross * 100) / 100,
    totalRoofSurfaceGross: Math.round(totalRoofSurfaceGross * 100) / 100,
  };
}

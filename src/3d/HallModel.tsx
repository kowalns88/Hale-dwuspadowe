import React from 'react';
import { SideColumns } from './elements/SideColumns';
import { EndColumns } from './elements/EndColumns';
import { Rafter } from './elements/Rafter';
import { Truss } from './elements/Truss';
import { Purlins } from './elements/Purlins';
import { PurlinBracing } from './elements/PurlinBracing';
import { CrossBracing } from './elements/CrossBracing';
import { BasePlates } from './elements/BasePlates';
import { EndPlates } from './elements/EndPlates';
import { RidgePlates } from './elements/RidgePlates';
import { EaveBeams } from './elements/EaveBeams';
import { WallGirts } from './elements/WallGirts';
import { GableGirts } from './elements/GableGirts';
import { IntermediateColumns } from './elements/IntermediateColumns';
import { TrussColumnHead } from './elements/TrussColumnHead';
import { ColumnCaps } from './elements/ColumnCaps';
import { Cladding } from './elements/Cladding';
import { Openings } from './elements/Openings';
import { GateFrame } from './elements/GateFrame';
import { Skylight } from './elements/Skylight';
import { BuildingEdgeLines } from './elements/BuildingEdgeLines';
import { getEffectiveRafterTop } from '../utils/geometry';
import type { HallParameters, CalculationResults, CladdingParameters, Opening, OpeningType, SkylightParameters, SelectedSheet } from '../types';

interface HallModelProps {
  params: HallParameters;
  results: CalculationResults;
  cladding?: CladdingParameters;
  showCladding?: boolean;
  openings?: Opening[];
  placementMode?: boolean;
  onPlaceOpening?: (opening: Opening) => void;
  selectedOpeningType?: OpeningType;
  openingWidth?: number;
  openingHeight?: number;
  sillHeight?: number;
  skylight?: SkylightParameters;
  selectedSheet?: SelectedSheet | null;
  onSelectSheet?: (sheet: SelectedSheet | null) => void;
}

/**
 * Main assembly component that renders the complete 3D structural model.
 * Receives hall parameters and calculation results, composes all structural elements.
 * Origin is at bottom-left corner of building (X=0, Y=0, Z=0).
 * X = along building length, Y = up, Z = across building width (span)
 */
export const HallModel = React.memo(function HallModel({ params, results, cladding, showCladding, openings, placementMode, onPlaceOpening, selectedOpeningType, openingWidth, openingHeight, sillHeight, skylight, selectedSheet, onSelectSheet }: HallModelProps) {
  const { span, length: hallLength, wallHeight, roofAngle } = params;
  const purlinMounting = params.purlinMounting ?? 'on-top';
  const {
    sideColumnProfile,
    endColumnProfile,
    rafterProfile,
    trussChordProfile,
    purlinProfile,
    bracingDiameter,
    columnSpacing,
    purlinSpacing,
    trussHeight,
    numberOfFrames,
    connectionPlates,
    eaveBeamProfile,
    wallGirtProfile,
    gableGirtProfile,
    intermediateColumnProfile,
    intermediateColumnActive,
  } = results;

  // Compute effective rafter top (column height) based on purlin mounting mode
  const purlinHeightM = purlinProfile.h / 1000;
  const effectiveColumnHeight = getEffectiveRafterTop(wallHeight, purlinMounting, purlinHeightM);

  // Purlin base Y: center of purlin at eave level
  // wallHeight is defined as distance to top of purlins, so center = wallHeight - h/2
  const purlinBaseY = wallHeight - purlinHeightM / 2;

  // Offset the model so it's roughly centered for better camera viewing
  const offsetX = -hallLength / 2;
  const offsetZ = -span / 2;

  // Column flange offset: half the column profile height (h/2) in meters
  // After rotation [-PI/2, 0, 0], column h runs along Z axis, so the inner flange is at h/2
  const columnFlangeOffset = sideColumnProfile.h / 2 / 1000 + 0.015; // half-flange + 15mm end plate gap

  // Head length for truss column starters (1000mm)
  const headLength = 1.0;

  // Rafter top offset: half the rafter/truss chord height in meters
  const rafterTopOffset = ((rafterProfile?.h ?? trussChordProfile?.h ?? 200) / 2) / 1000;

  // Rafter center Y: top of rafter aligns with effectiveColumnHeight, center is offset down
  const rafterCenterY = effectiveColumnHeight - rafterTopOffset;

  // Ridge height based on effective column height
  const effectiveRidgeHeight = effectiveColumnHeight + (span / 2) * Math.tan((roofAngle * Math.PI) / 180);

  // Column outer flange offset for cladding positioning
  const columnOuterFlangeOffset = sideColumnProfile.h / 2 / 1000;

  // End column outer offset (RHS profile, h along X after placement)
  const endColumnOuterOffset = (endColumnProfile.h / 2) / 1000;

  // Compute wall thickness offset for openings positioning
  const isSideWallTrapezoid = cladding?.sideWallType === 'trapezoid';
  const sideWallThicknessOffset = isSideWallTrapezoid
    ? 0.018 // T18 profile height default for trapezoid walls
    : ((cladding?.sandwichThickness ?? 100) / 1000) / 2;
  const wallZOffset = columnOuterFlangeOffset + sideWallThicknessOffset;

  return (
    <group position={[offsetX, 0, offsetZ]}>
      {/* Side columns along both long walls */}
      <SideColumns
        profile={sideColumnProfile}
        wallHeight={effectiveColumnHeight}
        span={span}
        columnSpacing={columnSpacing}
        numberOfFrames={numberOfFrames}
        roofAngle={roofAngle}
        columnFlangeOffset={columnFlangeOffset}
      />

      {/* Cap plates at the top of side columns */}
      <ColumnCaps
        sideColumnProfile={sideColumnProfile}
        wallHeight={effectiveColumnHeight}
        span={span}
        roofAngle={roofAngle}
        columnSpacing={columnSpacing}
        numberOfFrames={numberOfFrames}
        columnFlangeOffset={columnFlangeOffset}
      />

      {/* End columns on gable ends */}
      <EndColumns
        profile={endColumnProfile}
        wallHeight={effectiveColumnHeight}
        span={span}
        length={hallLength}
        ridgeHeight={effectiveRidgeHeight}
        openings={openings}
      />

      {/* Rafters or Trusses depending on span */}
      {rafterProfile && (
        <Rafter
          profile={rafterProfile}
          wallHeight={rafterCenterY}
          span={span}
          roofAngle={roofAngle}
          columnSpacing={columnSpacing}
          numberOfFrames={numberOfFrames}
          columnFlangeOffset={columnFlangeOffset}
        />
      )}

      {trussChordProfile && trussHeight != null && (
        <Truss
          chordProfile={trussChordProfile}
          wallHeight={rafterCenterY}
          span={span}
          roofAngle={roofAngle}
          trussHeight={trussHeight}
          columnSpacing={columnSpacing}
          numberOfFrames={numberOfFrames}
          columnFlangeOffset={columnFlangeOffset}
          headLength={headLength}
          purlinSpacing={purlinSpacing}
        />
      )}

      {/* Purlins on both roof slopes */}
      <Purlins
        profile={purlinProfile}
        purlinBaseY={purlinBaseY}
        span={span}
        roofAngle={roofAngle}
        purlinSpacing={purlinSpacing}
        columnSpacing={columnSpacing}
        numberOfFrames={numberOfFrames}
        hallLength={hallLength}
      />

      {/* Purlin bracing ties */}
      <PurlinBracing
        wallHeight={effectiveColumnHeight}
        purlinBaseY={purlinBaseY}
        span={span}
        roofAngle={roofAngle}
        purlinSpacing={purlinSpacing}
        columnSpacing={columnSpacing}
        numberOfFrames={numberOfFrames}
      />

      {/* Cross bracing on walls and roof */}
      <CrossBracing
        wallHeight={effectiveColumnHeight}
        span={span}
        roofAngle={roofAngle}
        ridgeHeight={effectiveRidgeHeight}
        columnSpacing={columnSpacing}
        numberOfFrames={numberOfFrames}
        hallLength={hallLength}
        bracingDiameter={bracingDiameter}
      />

      {/* Connection plates */}
      <BasePlates
        sideColumnProfile={sideColumnProfile}
        endColumnProfile={endColumnProfile}
        wallHeight={effectiveColumnHeight}
        span={span}
        length={hallLength}
        columnSpacing={columnSpacing}
        numberOfFrames={numberOfFrames}
        ridgeHeight={effectiveRidgeHeight}
        connectionPlates={connectionPlates}
      />
      <EndPlates
        wallHeight={effectiveColumnHeight}
        span={span}
        columnSpacing={columnSpacing}
        numberOfFrames={numberOfFrames}
        connectionPlates={connectionPlates}
        rafterType={rafterProfile ? 'ipe' : 'truss'}
      />
      <RidgePlates
        span={span}
        columnSpacing={columnSpacing}
        numberOfFrames={numberOfFrames}
        ridgeHeight={effectiveRidgeHeight}
        connectionPlates={connectionPlates}
      />

      {/* Truss column heads (only when truss is active) */}
      {trussChordProfile && trussHeight != null && (
        <TrussColumnHead
          chordProfile={trussChordProfile}
          wallHeight={rafterCenterY}
          span={span}
          roofAngle={roofAngle}
          trussHeight={trussHeight}
          columnSpacing={columnSpacing}
          numberOfFrames={numberOfFrames}
          connectionPlates={connectionPlates}
          columnFlangeOffset={columnFlangeOffset}
        />
      )}

      {/* Eave beams */}
      {eaveBeamProfile && (
        <EaveBeams
          profile={eaveBeamProfile}
          wallHeight={effectiveColumnHeight}
          span={span}
          hallLength={hallLength}
        />
      )}

      {/* Wall girts on side walls */}
      {wallGirtProfile && (
        <WallGirts
          profile={wallGirtProfile}
          wallHeight={effectiveColumnHeight}
          span={span}
          hallLength={hallLength}
          openings={openings}
          columnSpacing={columnSpacing}
          numberOfFrames={numberOfFrames}
        />
      )}

      {/* Gable girts on end walls */}
      {gableGirtProfile && (
        <GableGirts
          profile={gableGirtProfile}
          wallHeight={effectiveColumnHeight}
          span={span}
          hallLength={hallLength}
          openings={openings}
        />
      )}

      {/* Intermediate columns on side walls */}
      {intermediateColumnProfile && (
        <IntermediateColumns
          profile={intermediateColumnProfile}
          wallHeight={effectiveColumnHeight}
          span={span}
          columnSpacing={columnSpacing}
          numberOfFrames={numberOfFrames}
          active={intermediateColumnActive || cladding?.sideWallType === 'trapezoid'}
        />
      )}

      {/* Cladding panels (walls + roof) */}
      {cladding && (
        <Cladding
          params={params}
          cladding={cladding}
          showCladding={showCladding ?? true}
          columnOuterFlangeOffset={columnOuterFlangeOffset}
          endColumnOuterOffset={endColumnOuterOffset}
          columnSpacing={columnSpacing}
          numberOfFrames={numberOfFrames}
          placementMode={placementMode}
          openings={openings}
          onPlaceOpening={onPlaceOpening}
          selectedOpeningType={selectedOpeningType}
          openingWidth={openingWidth}
          openingHeight={openingHeight}
          sillHeight={sillHeight}
          selectedSheet={selectedSheet}
          onSelectSheet={onSelectSheet}
        />
      )}

      {/* Building edge lines for architectural silhouette */}
      <BuildingEdgeLines
        span={span}
        hallLength={hallLength}
        wallHeight={effectiveColumnHeight}
        roofAngle={roofAngle}
        ridgeHeight={effectiveRidgeHeight}
        columnOuterFlangeOffset={columnOuterFlangeOffset}
        endColumnOuterOffset={endColumnOuterOffset}
      />

      {/* Openings (gates, doors, windows) */}
      {openings && openings.length > 0 && (
        <Openings params={params} openings={openings} wallZOffset={wallZOffset} />
      )}

      {/* Gate structural frames (columns + lintel) */}
      {openings && openings.length > 0 && (
        <GateFrame openings={openings} params={params} wallHeight={effectiveColumnHeight} ridgeHeight={effectiveRidgeHeight} endColumnProfile={endColumnProfile} />
      )}

      {/* Ridge skylight */}
      {skylight && skylight.enabled && (
        <Skylight
          skylight={skylight}
          hallLength={hallLength}
          ridgeHeight={effectiveRidgeHeight}
          span={span}
        />
      )}
    </group>
  );
});

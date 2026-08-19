import { useState, useCallback, useMemo } from 'react';
import { FormPanel, DEFAULT_PARAMS } from './FormPanel';
import { Scene } from '../3d/Scene';
import { SheetInfoPanel } from './SheetInfoPanel';
import { useHallCalculations } from '../hooks/useHallCalculations';
import type { HallParameters, ProfileOverrides, RafterType, CladdingParameters, Opening, OpeningType, SkylightParameters, SelectedSheet } from '../types';
import type { PricingData } from '../data/pricing';
import { defaultPricing } from '../data/pricing';
import { calculatePricing } from '../utils/pricing';

export const DEFAULT_CLADDING: CladdingParameters = {
  sideWallType: 'sandwich',
  endWallType: 'sandwich',
  roofType: 'T35',
  sideWallColor: 'RAL 9002',
  endWallColor: 'RAL 9002',
  roofColor: 'RAL 7035',
  flashingColor: 'RAL 7016',
  panelOrientation: 'horizontal',
  panelWidth: 1000,
  colorStripes: [],
  eaveOverhang: 500,
  roofSandwichThickness: 100,
};

export function Layout() {
  const [params, setParams] = useState<HallParameters>(DEFAULT_PARAMS);
  const [profileOverrides, setProfileOverrides] = useState<ProfileOverrides>({});
  const [rafterType, setRafterType] = useState<RafterType>('auto');
  const [customTrussHeight, setCustomTrussHeight] = useState<number | null>(null);
  const [cladding, setCladding] = useState<CladdingParameters>(DEFAULT_CLADDING);
  const [showCladding, setShowCladding] = useState(true);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [placementMode, setPlacementMode] = useState(false);
  const [selectedOpeningType, setSelectedOpeningType] = useState<OpeningType>('sliding_gate');
  const [openingWidth, setOpeningWidth] = useState(4);
  const [openingHeight, setOpeningHeight] = useState(4);
  const [sillHeight, setSillHeight] = useState(0.9);
  const [skylight, setSkylight] = useState<SkylightParameters>({ enabled: false, length: 6, width: 1.5 });
  const [pricing, setPricing] = useState<PricingData>(defaultPricing);
  const [selectedSheet, setSelectedSheet] = useState<SelectedSheet | null>(null);

  const addOpening = useCallback((opening: Opening) => {
    setOpenings((prev) => [...prev, opening]);
  }, []);

  const removeOpening = useCallback((id: string) => {
    setOpenings((prev) => prev.filter((o) => o.id !== id));
  }, []);

  const results = useHallCalculations(params, profileOverrides, rafterType, customTrussHeight);

  const pricingResult = useMemo(() => calculatePricing({
    params,
    results,
    cladding,
    openings,
    skylight,
    pricing,
  }), [params, results, cladding, openings, skylight, pricing]);

  return (
    <main className="flex flex-col md:flex-row flex-1 overflow-hidden">
      {/* Left panel - Form ~35% */}
      <aside className="w-full md:w-[35%] h-[40vh] md:h-auto bg-surface-primary border-b md:border-b-0 md:border-r border-border overflow-hidden">
        <FormPanel
          params={params}
          onParamsChange={setParams}
          results={results}
          profileOverrides={profileOverrides}
          onProfileOverridesChange={setProfileOverrides}
          rafterType={rafterType}
          onRafterTypeChange={setRafterType}
          customTrussHeight={customTrussHeight}
          onCustomTrussHeightChange={setCustomTrussHeight}
          cladding={cladding}
          onCladdingChange={setCladding}
          showCladding={showCladding}
          onShowCladdingChange={setShowCladding}
          openings={openings}
          onRemoveOpening={removeOpening}
          placementMode={placementMode}
          onPlacementModeChange={setPlacementMode}
          selectedOpeningType={selectedOpeningType}
          onSelectedOpeningTypeChange={setSelectedOpeningType}
          openingWidth={openingWidth}
          onOpeningWidthChange={setOpeningWidth}
          openingHeight={openingHeight}
          onOpeningHeightChange={setOpeningHeight}
          sillHeight={sillHeight}
          onSillHeightChange={setSillHeight}
          skylight={skylight}
          onSkylightChange={setSkylight}
          hallLength={params.length}
          pricing={pricing}
          onPricingChange={setPricing}
          pricingResult={pricingResult}
        />
      </aside>
      {/* Right panel - 3D Canvas ~65% */}
      <section className="w-full md:w-[65%] flex-1 bg-surface-secondary relative">
        <Scene
          params={params}
          results={results}
          cladding={cladding}
          showCladding={showCladding}
          openings={openings}
          placementMode={placementMode}
          onPlaceOpening={addOpening}
          selectedOpeningType={selectedOpeningType}
          openingWidth={openingWidth}
          openingHeight={openingHeight}
          sillHeight={sillHeight}
          skylight={skylight}
          selectedSheet={selectedSheet}
          onSelectSheet={setSelectedSheet}
        />
        <SheetInfoPanel selectedSheet={selectedSheet} onClose={() => setSelectedSheet(null)} />
      </section>
    </main>
  );
}

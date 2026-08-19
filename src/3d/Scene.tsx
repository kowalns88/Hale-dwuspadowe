import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer, N8AO, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { HallModel } from './HallModel'
import type { HallParameters, CalculationResults, CladdingParameters, Opening, OpeningType, SkylightParameters, SelectedSheet } from '../types'

interface SceneProps {
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

function SceneContent(props: SceneProps) {
  const { params, results, selectedSheet: _selectedSheet, onSelectSheet: _onSelectSheet, ...rest } = props;

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[40, 60, 30]}
        intensity={2.0}
        castShadow
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-far={200}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-bias={-0.0002}
        color="#ffffff"
      />
      {/* Warm fill light from opposite side */}
      <directionalLight position={[-30, 40, -20]} intensity={0.8} color="#fff0e0" />
      {/* Rim light from behind to highlight edges */}
      <directionalLight position={[0, 20, -50]} intensity={1.2} color="#e0e8ff" />
      <hemisphereLight args={['#d0d8e8', '#8a8a8a', 0.5]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[200, 200, 64, 64]} />
        <meshStandardMaterial color="#a8b8a0" roughness={0.95} metalness={0} />
      </mesh>

      <HallModel params={params} results={results} selectedSheet={_selectedSheet} onSelectSheet={_onSelectSheet} {...rest} />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={2}
        maxDistance={200}
        maxPolarAngle={Math.PI}
        zoomToCursor
      />

      <EffectComposer multisampling={8}>
        <N8AO aoRadius={0.3} intensity={1.5} distanceFalloff={0.5} />
        <ToneMapping mode={ToneMappingMode.AGX} />
        <Vignette offset={0.3} darkness={0.4} />
      </EffectComposer>
    </>
  )
}

export function Scene(props: SceneProps) {
  return (
    <Canvas
      shadows
      camera={{ position: [30, 12, 30], fov: 40 }}
      gl={{ powerPreference: 'high-performance', antialias: true }}
      dpr={[1, 2]}
      className="w-full h-full"
      onPointerMissed={() => props.onSelectSheet?.(null)}
    >
      <color attach="background" args={['#dce8f0']} />
      <Suspense fallback={null}>
        <SceneContent {...props} />
      </Suspense>
    </Canvas>
  )
}

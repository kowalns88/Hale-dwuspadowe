import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei'
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
      <Environment preset="city" />

      <ambientLight intensity={0.4} />
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
      <directionalLight position={[-20, 30, -20]} intensity={0.5} color="#e8e8ff" />
      <hemisphereLight args={['#c0d0e0', '#506040', 0.4]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#a8b8a0" roughness={0.95} metalness={0} />
      </mesh>

      <ContactShadows
        position={[0, -0.01, 0]}
        opacity={0.6}
        blur={2.5}
        far={50}
        resolution={1024}
      />

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
        <N8AO aoRadius={0.5} intensity={3.0} distanceFalloff={0.5} />
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

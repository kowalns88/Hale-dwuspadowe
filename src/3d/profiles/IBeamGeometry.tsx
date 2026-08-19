import { useMemo } from 'react';
import * as THREE from 'three';

interface IBeamGeometryProps {
  h: number;      // total height in meters
  b: number;      // flange width in meters
  tw: number;     // web thickness in meters
  tf: number;     // flange thickness in meters
  length: number; // extrusion length in meters
}

interface IBeamGeometryAngledProps extends IBeamGeometryProps {
  cutAngle: number; // angle in radians for angled cuts at both ends
}

/**
 * Creates an I-beam (IPE) cross-section shape and extrudes it along the Z axis.
 * The cross-section is in the XY plane, centered at origin.
 */
export function useIBeamGeometry({ h, b, tw, tf, length }: IBeamGeometryProps): THREE.ExtrudeGeometry {
  return useMemo(() => {
    const halfH = h / 2;
    const halfB = b / 2;
    const halfTw = tw / 2;

    const shape = new THREE.Shape();

    // Start at bottom-left of bottom flange
    shape.moveTo(-halfB, -halfH);
    shape.lineTo(halfB, -halfH);
    shape.lineTo(halfB, -halfH + tf);
    shape.lineTo(halfTw, -halfH + tf);
    shape.lineTo(halfTw, halfH - tf);
    shape.lineTo(halfB, halfH - tf);
    shape.lineTo(halfB, halfH);
    shape.lineTo(-halfB, halfH);
    shape.lineTo(-halfB, halfH - tf);
    shape.lineTo(-halfTw, halfH - tf);
    shape.lineTo(-halfTw, -halfH + tf);
    shape.lineTo(-halfB, -halfH + tf);
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: length,
      bevelEnabled: false,
    });

    geometry.computeVertexNormals();
    return geometry;
  }, [h, b, tw, tf, length]);
}

/**
 * Creates an I-beam (IPE) cross-section extruded along Z, with angled cuts at both ends.
 * At Z~0 (column end): vertices shifted by +Y * tan(cutAngle) so the face becomes vertical after rotation.
 * At Z~length (ridge end): vertices shifted by -Y * tan(cutAngle) for a clean V-joint.
 */
export function useIBeamGeometryAngled({ h, b, tw, tf, length, cutAngle }: IBeamGeometryAngledProps): THREE.ExtrudeGeometry {
  return useMemo(() => {
    const halfH = h / 2;
    const halfB = b / 2;
    const halfTw = tw / 2;

    const shape = new THREE.Shape();

    // Start at bottom-left of bottom flange
    shape.moveTo(-halfB, -halfH);
    shape.lineTo(halfB, -halfH);
    shape.lineTo(halfB, -halfH + tf);
    shape.lineTo(halfTw, -halfH + tf);
    shape.lineTo(halfTw, halfH - tf);
    shape.lineTo(halfB, halfH - tf);
    shape.lineTo(halfB, halfH);
    shape.lineTo(-halfB, halfH);
    shape.lineTo(-halfB, halfH - tf);
    shape.lineTo(-halfTw, halfH - tf);
    shape.lineTo(-halfTw, -halfH + tf);
    shape.lineTo(-halfB, -halfH + tf);
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: length,
      bevelEnabled: false,
    });

    // Apply angled cuts by modifying vertex positions
    const posAttr = geometry.attributes.position;
    const tanAngle = Math.tan(cutAngle);

    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);

      if (z < 0.001) {
        // Column end: shift Z by +Y * tan(cutAngle)
        posAttr.setZ(i, z + y * tanAngle);
      } else if (z > length - 0.001) {
        // Ridge end: shift Z by -Y * tan(cutAngle)
        posAttr.setZ(i, z - y * tanAngle);
      }
    }

    posAttr.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }, [h, b, tw, tf, length, cutAngle]);
}

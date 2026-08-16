import {
  Color,
  DoubleSide,
  MeshBasicMaterial,
  ShaderMaterial,
  Texture,
  Vector2,
} from "three";
import { curlFragmentShader, curlVertexShader } from "./curlGeometry";

export interface CurlMaterial extends ShaderMaterial {
  uniforms: {
    uFrontMap: { value: Texture };
    uBackMap: { value: Texture };
    uProgress: { value: number };
    uPageWidth: { value: number };
    uPageHeight: { value: number };
    uSideSign: { value: number };
    uAxis: { value: Vector2 };
    uNormal: { value: Vector2 };
    uActualRadius: { value: number };
    uArcLength: { value: number };
    uGrabMaterialY: { value: number };
    uOppositeSpan: { value: number };
    uCornerSagDepth: { value: number };
    uMirrored: { value: number };
    uShadowOpacity: { value: number };
  };
}

export function createCurlMaterial(
  front: Texture,
  back: Texture,
  pageHeight: number,
): CurlMaterial {
  return new ShaderMaterial({
    side: DoubleSide,
    depthWrite: true,
    depthTest: true,
    // Keep a very low moving sheet reliably above the receiving page.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    transparent: false,
    toneMapped: true,
    uniforms: {
      uFrontMap: { value: front },
      uBackMap: { value: back },
      uProgress: { value: 0 },
      uPageWidth: { value: 1 },
      uPageHeight: { value: pageHeight },
      uSideSign: { value: 1 },
      uAxis: { value: new Vector2(1, 0) },
      uNormal: { value: new Vector2(1, 0) },
      uActualRadius: { value: 0 },
      uArcLength: { value: 0 },
      uGrabMaterialY: { value: 0 },
      uOppositeSpan: { value: pageHeight / 2 },
      uCornerSagDepth: { value: 0 },
      uMirrored: { value: 0 },
      uShadowOpacity: { value: 0.42 },
    },
    vertexShader: curlVertexShader,
    fragmentShader: curlFragmentShader,
  }) as CurlMaterial;
}

export interface FakeShadowMaterial extends ShaderMaterial {
  uniforms: {
    uProgress: { value: number };
    uSideSign: { value: number };
    uHingeX: { value: number };
    uAxis: { value: Vector2 };
    uNormal: { value: Vector2 };
    uArcLength: { value: number };
    uOpacity: { value: number };
  };
}

/**
 * A soft fold-aligned overlay approximates the contact shadow without a shadow
 * camera, depth texture, caster mesh, or second scene render.
 */
export function createFakeShadowMaterial(opacity: number): FakeShadowMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    uniforms: {
      uProgress: { value: 0 },
      uSideSign: { value: 1 },
      uHingeX: { value: 0 },
      uAxis: { value: new Vector2(1, 0) },
      uNormal: { value: new Vector2(1, 0) },
      uArcLength: { value: 0 },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec2 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xy;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uProgress;
      uniform float uSideSign;
      uniform float uHingeX;
      uniform vec2 uAxis;
      uniform vec2 uNormal;
      uniform float uArcLength;
      uniform float uOpacity;
      varying vec2 vWorldPosition;

      void main() {
        float progress = clamp(uProgress, 0.0, 1.0);
        float envelope = pow(sin(3.14159265359 * progress), 2.0);
        float materialX = (vWorldPosition.x - uHingeX) * uSideSign;
        vec2 materialPosition = vec2(materialX, vWorldPosition.y);
        float foldDistance = dot(materialPosition - uAxis, uNormal);
        float center = uArcLength * 0.45;
        float width = max(0.022, uArcLength * 0.8 + 0.018);
        float band = 1.0 - smoothstep(0.0, 1.0, abs(foldDistance - center) / width);
        float spreadMask = 1.0 - smoothstep(1.0, 1.08, abs(materialX));
        float alpha = uOpacity * 0.62 * band * envelope * spreadMask;
        gl_FragColor = vec4(0.025, 0.045, 0.075, alpha);
      }
    `,
  }) as FakeShadowMaterial;
}

export function pageMaterial(texture: Texture): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map: texture,
    color: new Color("#ffffff"),
    toneMapped: false,
  });
}

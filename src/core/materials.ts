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
    uMirrored: { value: number };
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
      uMirrored: { value: 0 },
    },
    vertexShader: curlVertexShader,
    fragmentShader: curlFragmentShader,
  }) as CurlMaterial;
}

export interface ContactShadowMaterial extends ShaderMaterial {
  uniforms: {
    uProgress: { value: number };
    uOpacity: { value: number };
    uFromHinge: { value: number };
  };
}

export function createContactShadowMaterial(): ContactShadowMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    uniforms: {
      uProgress: { value: 0 },
      uOpacity: { value: 0.16 },
      uFromHinge: { value: 1 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uProgress;
      uniform float uOpacity;
      uniform float uFromHinge;
      varying vec2 vUv;
      void main() {
        float p = clamp(uProgress, 0.0, 1.0);
        float envelope = 4.0 * p * (1.0 - p);
        float hingeDistance = uFromHinge > 0.0 ? vUv.x : 1.0 - vUv.x;
        float movingBand = abs(hingeDistance - clamp(p, 0.06, 0.94));
        float alpha = uOpacity * envelope * exp(-22.0 * movingBand * movingBand) * (1.0 - smoothstep(0.75, 1.0, hingeDistance));
        gl_FragColor = vec4(0.035, 0.047, 0.065, alpha);
      }
    `,
  }) as ContactShadowMaterial;
}

export function pageMaterial(texture: Texture): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map: texture,
    color: new Color("#ffffff"),
    toneMapped: false,
  });
}

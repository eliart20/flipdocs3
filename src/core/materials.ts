import {
  Color,
  DoubleSide,
  MeshDepthMaterial,
  MeshBasicMaterial,
  RGBADepthPacking,
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

export interface CurlDepthMaterial extends MeshDepthMaterial {
  curlUniforms: {
    uProgress: { value: number };
    uSideSign: { value: number };
    uAxis: { value: Vector2 };
    uNormal: { value: Vector2 };
    uActualRadius: { value: number };
    uArcLength: { value: number };
  };
}

/**
 * Shadow maps render a mesh through a separate depth material. The visible
 * sheet bends in a vertex shader, so its depth pass must repeat the exact same
 * mapping or the cast shadow would remain a flat rectangle.
 */
export function createCurlDepthMaterial(): CurlDepthMaterial {
  const material = new MeshDepthMaterial({ depthPacking: RGBADepthPacking }) as CurlDepthMaterial;
  material.side = DoubleSide;
  material.curlUniforms = {
    uProgress: { value: 0 },
    uSideSign: { value: 1 },
    uAxis: { value: new Vector2(1, 0) },
    uNormal: { value: new Vector2(1, 0) },
    uActualRadius: { value: 0 },
    uArcLength: { value: 0 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, material.curlUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
        uniform float uProgress;
        uniform float uSideSign;
        uniform vec2 uAxis;
        uniform vec2 uNormal;
        uniform float uActualRadius;
        uniform float uArcLength;

        vec3 curlDepthPosition(float materialX, float materialY) {
          if (uProgress <= 0.0000001) {
            return vec3(uSideSign * materialX, materialY, 0.0);
          }
          if (uProgress >= 0.9999999) {
            return vec3(-uSideSign * materialX, materialY, 0.0);
          }
          vec2 tangent = vec2(-uNormal.y, uNormal.x);
          vec2 relative = vec2(materialX, materialY) - uAxis;
          float normalDistance = dot(relative, uNormal);
          float tangentDistance = dot(relative, tangent);
          float mappedNormal = normalDistance;
          float mappedZ = 0.0;
          if (normalDistance > 0.0 && normalDistance < uArcLength && uActualRadius > 0.00000001) {
            float foldAngle = normalDistance / uActualRadius;
            mappedNormal = uActualRadius * sin(foldAngle);
            mappedZ = uActualRadius * (1.0 - cos(foldAngle));
          } else if (normalDistance >= uArcLength) {
            mappedNormal = -(normalDistance - uArcLength);
            mappedZ = 2.0 * uActualRadius;
          }
          vec2 mapped = uAxis + uNormal * mappedNormal + tangent * tangentDistance;
          return vec3(uSideSign * mapped.x, mapped.y, max(0.0, mappedZ));
        }
      `)
      .replace(
        "#include <begin_vertex>",
        "vec3 transformed = curlDepthPosition(position.x, position.y);",
      );
  };
  material.customProgramCacheKey = () => "flipdocs-curl-depth-v1";
  return material;
}

export function pageMaterial(texture: Texture): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map: texture,
    color: new Color("#ffffff"),
    toneMapped: false,
  });
}

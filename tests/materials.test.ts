import { DoubleSide, Texture } from "three";
import { describe, expect, it } from "vitest";
import { createCurlMaterial, createFakeShadowMaterial } from "../src/core/materials";

describe("analytic curl shadows", () => {
  it("uses the visible curl shader for Z sag and outer-sheet shading", () => {
    const texture = new Texture();
    const material = createCurlMaterial(texture, texture, 4 / 3);

    expect(material.side).toBe(DoubleSide);
    expect(material.uniforms.uCornerSagDepth.value).toBe(0);
    expect(material.uniforms.uShadowOpacity.value).toBeGreaterThan(0);
    expect(material.vertexShader).toContain("mappedZ - sagDrop");
    expect(material.fragmentShader).toContain("fakeOuterShadow");
    material.dispose();
    texture.dispose();
  });

  it("draws a lightweight fold-aligned contact band without a shadow map", () => {
    const material = createFakeShadowMaterial(0.42);

    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.uniforms.uOpacity.value).toBe(0.42);
    expect(material.fragmentShader).toContain("foldDistance");
    expect(material.fragmentShader).toContain("smoothstep");
    expect(material.fragmentShader).not.toContain("shadowMap");
    material.dispose();
  });
});

import { DoubleSide, RGBADepthPacking } from "three";
import { describe, expect, it } from "vitest";
import { createCurlDepthMaterial } from "../src/core/materials";

describe("real curl shadow depth pass", () => {
  it("injects the production curl deformation into the RGBA shadow depth shader", () => {
    const material = createCurlDepthMaterial();
    const shader = {
      uniforms: {},
      vertexShader: "#include <common>\nvoid main() {\n#include <begin_vertex>\n}",
      fragmentShader: "",
    };

    material.onBeforeCompile(shader as never, {} as never);

    expect(material.depthPacking).toBe(RGBADepthPacking);
    expect(material.side).toBe(DoubleSide);
    expect(shader.vertexShader).toContain("curlDepthPosition");
    expect(shader.vertexShader).toContain("vec3 transformed = curlDepthPosition(position.x, position.y);");
    expect(shader.vertexShader).not.toContain("#include <begin_vertex>");
    expect(shader.uniforms).toMatchObject(material.curlUniforms);
    expect(material.customProgramCacheKey()).toBe("flipdocs-curl-depth-v1");

    material.dispose();
  });
});

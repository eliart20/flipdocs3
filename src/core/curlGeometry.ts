import type { PageSide } from "../types";

export interface CurlPose {
  progress: number;
  radius: number;
  /** 0 keeps both outer corners level; 1 lets the corner opposite the grab droop. */
  cornerSag?: number;
  /** Minimum fold height. It fades to zero only at the two flat endpoints. */
  minimumLift?: number;
  side: PageSide;
  /** Material grab point, normalized from hinge (0) to loose edge (1). */
  grabX: number;
  /** Material grab point, normalized bottom (0) to top (1). */
  grabY: number;
  /** Requested pointer destination, normalized bottom (0) to top (1). */
  targetY: number;
  /** 1 while attached; fades to zero while settling flat. */
  verticalInfluence: number;
}

export interface Point2 {
  x: number;
  y: number;
}

export interface Point3 extends Point2 {
  z: number;
}

export interface CurlState {
  progress: number;
  axis: Point2;
  normal: Point2;
  tangent: Point2;
  radius: number;
  arcLength: number;
  pageWidth: number;
  oppositeSpan: number;
  /** Maximum Z-depth drop at the diagonally opposite outer corner. */
  cornerSagDepth: number;
  origin: Point2;
  requestedTarget: Point2;
  constrainedTarget: Point2;
  constraintRatio: number;
}

// A tight fold can be only a few percent of the page width. Keep enough
// triangles across an arbitrary diagonal axis that its cylinder does not
// collapse into a single chord on mobile GPUs.
export const DEFAULT_SEGMENTS_X = 160;
export const DEFAULT_SEGMENTS_Y = 112;
const CORNER_SAG_DEPTH_SCALE = 0.03;

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function stateForVerticalDelta(
  _pageWidth: number,
  pageHeight: number,
  progress: number,
  origin: Point2,
  deltaY: number,
  requiredRadius: number,
): { feasible: boolean; target: Point2; normal: Point2; distance: number; reach: number } {
  const target = {
    x: origin.x * (1 - 2 * progress),
    y: origin.y + deltaY,
  };
  const dragX = origin.x - target.x;
  const dragY = origin.y - target.y;
  const distance = Math.hypot(dragX, dragY);
  if (distance < 1e-8) {
    return {
      feasible: Math.PI * requiredRadius <= 2 * origin.x,
      target,
      normal: { x: 1, y: 0 },
      distance: 0,
      reach: origin.x,
    };
  }
  const normal = { x: dragX / distance, y: dragY / distance };
  const bottom = { x: 0, y: -pageHeight / 2 };
  const top = { x: 0, y: pageHeight / 2 };
  const reachAt = (point: Point2) =>
    (origin.x - point.x) * normal.x + (origin.y - point.y) * normal.y;
  const reach = Math.min(reachAt(bottom), reachAt(top));
  return {
    feasible: distance + Math.PI * requiredRadius <= 2 * reach + 1e-7,
    target,
    normal,
    distance,
    reach,
  };
}

/**
 * Solve a developable half-cylinder around a possibly diagonal fold axis.
 * The axis is constrained so the complete x=0 hinge lies on the unchanged
 * side of the fold. No post-deformation spine blend is needed: every hinge
 * vertex is pinned by the mapping itself, and the grab point maps exactly to
 * the constrained pointer target in screen-plane X/Y.
 */
export function solveCurlState(
  pageWidth: number,
  pageHeight: number,
  pose: CurlPose,
): CurlState {
  const progress = clamp01(pose.progress);
  const origin = {
    x: Math.max(pageWidth * 0.02, clamp01(pose.grabX) * pageWidth),
    y: (clamp01(pose.grabY) - 0.5) * pageHeight,
  };
  const requestedDeltaY = (clamp01(pose.targetY) - clamp01(pose.grabY))
    * pageHeight
    * clamp01(pose.verticalInfluence);
  const requestedTarget = {
    x: origin.x * (1 - 2 * progress),
    y: origin.y + requestedDeltaY,
  };

  const envelope = Math.sin(Math.PI * progress);
  const desiredRadius = Math.max(0.002, pose.radius) * pageWidth * envelope;
  // Reserve a small rounded band. Extreme vertical pulls are constrained just
  // enough to stop that band collapsing coplanar into the receiving page.
  const requiredRadius = Math.min(
    desiredRadius,
    Math.max(0, pose.minimumLift ?? 0) * pageWidth * envelope * 0.5,
  );

  let ratio = 1;
  let candidate = stateForVerticalDelta(
    pageWidth,
    pageHeight,
    progress,
    origin,
    requestedDeltaY,
    requiredRadius,
  );
  if (!candidate.feasible) {
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const middle = (low + high) / 2;
      const sample = stateForVerticalDelta(
        pageWidth,
        pageHeight,
        progress,
        origin,
        requestedDeltaY * middle,
        requiredRadius,
      );
      if (sample.feasible) low = middle;
      else high = middle;
    }
    ratio = low;
    candidate = stateForVerticalDelta(
      pageWidth,
      pageHeight,
      progress,
      origin,
      requestedDeltaY * ratio,
      requiredRadius,
    );
  }

  const dragLimit = candidate.distance / Math.PI * 0.94;
  const hingeLimit = Math.max(0, (2 * candidate.reach - candidate.distance) / Math.PI);
  const radius = Math.max(0, Math.min(desiredRadius, dragLimit, hingeLimit));
  const arcLength = Math.PI * radius;
  const distanceToAxis = (candidate.distance + arcLength) / 2;
  const axis = {
    x: origin.x - candidate.normal.x * distanceToAxis,
    y: origin.y - candidate.normal.y * distanceToAxis,
  };
  const tangent = { x: -candidate.normal.y, y: candidate.normal.x };
  return {
    progress,
    axis,
    normal: candidate.normal,
    tangent,
    radius,
    arcLength,
    pageWidth,
    oppositeSpan: Math.max(
      pageHeight * 0.08,
      origin.y >= 0 ? origin.y + pageHeight / 2 : pageHeight / 2 - origin.y,
    ),
    cornerSagDepth: clamp01(pose.cornerSag ?? 0)
      * pageWidth
      * CORNER_SAG_DEPTH_SCALE
      * envelope,
    origin,
    requestedTarget,
    constrainedTarget: candidate.target,
    constraintRatio: ratio,
  };
}

export function deformPointWithState(
  materialX: number,
  materialY: number,
  side: PageSide,
  state: CurlState,
): Point3 {
  if (state.progress <= 1e-7) {
    return { x: side === "right" ? materialX : -materialX, y: materialY, z: 0 };
  }
  if (state.progress >= 1 - 1e-7) {
    return { x: side === "right" ? -materialX : materialX, y: materialY, z: 0 };
  }

  const oppositeSign = state.origin.y >= 0 ? -1 : 1;
  const rawOppositeDistance = ((materialY - state.origin.y) * oppositeSign)
    / state.oppositeSpan;
  const oppositeDistance = clamp01(rawOppositeDistance);
  const outerWeight = clamp01(materialX / state.pageWidth);
  const oppositeWeight = oppositeDistance * oppositeDistance * (3 - 2 * oppositeDistance);
  const sagDrop = rawOppositeDistance > 0
    ? state.cornerSagDepth * oppositeWeight * outerWeight
    : 0;
  const relativeX = materialX - state.axis.x;
  const relativeY = materialY - state.axis.y;
  const normalDistance = relativeX * state.normal.x + relativeY * state.normal.y;
  const tangentDistance = relativeX * state.tangent.x + relativeY * state.tangent.y;
  let mappedNormal = normalDistance;
  let z = 0;
  if (normalDistance > 0 && normalDistance < state.arcLength && state.radius > 1e-8) {
    const angle = normalDistance / state.radius;
    mappedNormal = state.radius * Math.sin(angle);
    z = state.radius * (1 - Math.cos(angle));
  } else if (normalDistance >= state.arcLength) {
    mappedNormal = -(normalDistance - state.arcLength);
    z = 2 * state.radius;
  }
  const x = state.axis.x + state.normal.x * mappedNormal
    + state.tangent.x * tangentDistance;
  const y = state.axis.y + state.normal.y * mappedNormal
    + state.tangent.y * tangentDistance;
  return { x: side === "right" ? x : -x, y, z: Math.max(0, z - sagDrop) };
}

export function deformPoint(
  materialX: number,
  materialY: number,
  pageWidth: number,
  pageHeight: number,
  pose: CurlPose,
): Point3 {
  return deformPointWithState(
    materialX,
    materialY,
    pose.side,
    solveCurlState(pageWidth, pageHeight, pose),
  );
}

export function mappedGrabPoint(pageWidth: number, pageHeight: number, pose: CurlPose): Point3 {
  const state = solveCurlState(pageWidth, pageHeight, pose);
  return deformPointWithState(state.origin.x, state.origin.y, pose.side, state);
}

export function solveProgressForPointer(
  materialX: number,
  _pageWidth: number,
  signedTargetAtSourceFocus: number,
  _radius?: number,
  signedFocusTravel = 0,
): number {
  const origin = Math.max(0.0001, materialX);
  // Solve the loose-edge motion and simultaneous mobile camera translation in
  // one equation. This keeps the grabbed point attached without fixed-point
  // iterations or a thresholded mid-drag camera jump.
  const denominator = 2 * origin + signedFocusTravel;
  if (Math.abs(denominator) < 1e-7) return 0;
  return clamp01((origin - signedTargetAtSourceFocus) / denominator);
}

export function sampleGeometry(
  pageWidth: number,
  pageHeight: number,
  pose: CurlPose,
  segmentsX = DEFAULT_SEGMENTS_X,
  segmentsY = DEFAULT_SEGMENTS_Y,
): Point3[][] {
  const state = solveCurlState(pageWidth, pageHeight, pose);
  return Array.from({ length: segmentsY + 1 }, (_, row) => {
    const y = -pageHeight / 2 + (row / segmentsY) * pageHeight;
    return Array.from({ length: segmentsX + 1 }, (_, column) => {
      const x = (column / segmentsX) * pageWidth;
      return deformPointWithState(x, y, pose.side, state);
    });
  });
}

export function edgeLengthRatios(
  grid: Point3[][],
  pageWidth: number,
  pageHeight: number,
): number[] {
  const rows = grid.length - 1;
  const columns = (grid[0]?.length ?? 1) - 1;
  const expectedX = pageWidth / columns;
  const expectedY = pageHeight / rows;
  const ratios: number[] = [];
  const distance = (a: Point3, b: Point3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const point = grid[row]?.[column];
      if (!point) continue;
      const right = grid[row]?.[column + 1];
      const above = grid[row + 1]?.[column];
      if (right) ratios.push(distance(point, right) / expectedX);
      if (above) ratios.push(distance(point, above) / expectedY);
    }
  }
  return ratios;
}

export const curlVertexShader = /* glsl */ `
  uniform float uProgress;
  uniform float uPageWidth;
  uniform float uPageHeight;
  uniform float uSideSign;
  uniform vec2 uAxis;
  uniform vec2 uNormal;
  uniform float uActualRadius;
  uniform float uArcLength;
  uniform float uGrabMaterialY;
  uniform float uOppositeSpan;
  uniform float uCornerSagDepth;
  varying vec2 vPageUv;
  varying vec3 vCurlNormal;
  varying float vFoldAngle;

  vec3 curlPosition(float materialX, float materialY, out float foldAngle) {
    if (uProgress <= 0.0000001) {
      foldAngle = 0.0;
      return vec3(uSideSign * materialX, materialY, 0.0);
    }
    if (uProgress >= 0.9999999) {
      foldAngle = 3.14159265359;
      return vec3(-uSideSign * materialX, materialY, 0.0);
    }
    float oppositeSign = uGrabMaterialY >= 0.0 ? -1.0 : 1.0;
    float rawOppositeDistance = ((materialY - uGrabMaterialY) * oppositeSign)
      / max(0.000001, uOppositeSpan);
    float oppositeDistance = clamp(rawOppositeDistance, 0.0, 1.0);
    float outerWeight = clamp(materialX / uPageWidth, 0.0, 1.0);
    float activeOpposite = step(0.0000001, rawOppositeDistance);
    float oppositeWeight = oppositeDistance * oppositeDistance * (3.0 - 2.0 * oppositeDistance);
    float sagDrop = uCornerSagDepth * oppositeWeight * outerWeight * activeOpposite;
    vec2 tangent = vec2(-uNormal.y, uNormal.x);
    vec2 relative = vec2(materialX, materialY) - uAxis;
    float normalDistance = dot(relative, uNormal);
    float tangentDistance = dot(relative, tangent);
    float mappedNormal = normalDistance;
    float mappedZ = 0.0;
    if (normalDistance > 0.0 && normalDistance < uArcLength && uActualRadius > 0.00000001) {
      foldAngle = normalDistance / uActualRadius;
      mappedNormal = uActualRadius * sin(foldAngle);
      mappedZ = uActualRadius * (1.0 - cos(foldAngle));
    } else if (normalDistance >= uArcLength) {
      foldAngle = 3.14159265359;
      mappedNormal = -(normalDistance - uArcLength);
      mappedZ = 2.0 * uActualRadius;
    } else {
      foldAngle = 0.0;
    }
    vec2 mapped = uAxis + uNormal * mappedNormal + tangent * tangentDistance;
    return vec3(uSideSign * mapped.x, mapped.y, max(0.0, mappedZ - sagDrop));
  }

  void main() {
    vPageUv = uv;
    float angle;
    vec3 deformed = curlPosition(position.x, position.y, angle);
    vFoldAngle = angle;
    float ignored;
    float deltaX = uPageWidth / 2048.0;
    float deltaY = uPageHeight / 2048.0;
    vec3 beforeX = curlPosition(max(0.0, position.x - deltaX), position.y, ignored);
    vec3 afterX = curlPosition(min(uPageWidth, position.x + deltaX), position.y, ignored);
    vec3 beforeY = curlPosition(position.x, max(-uPageHeight * 0.5, position.y - deltaY), ignored);
    vec3 afterY = curlPosition(position.x, min(uPageHeight * 0.5, position.y + deltaY), ignored);
    vCurlNormal = normalize(normalMatrix * normalize(cross(afterX - beforeX, afterY - beforeY)));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(deformed, 1.0);
  }
`;

export const curlFragmentShader = /* glsl */ `
  uniform sampler2D uFrontMap;
  uniform sampler2D uBackMap;
  uniform float uProgress;
  uniform float uMirrored;
  uniform float uShadowOpacity;
  varying vec2 vPageUv;
  varying vec3 vCurlNormal;
  varying float vFoldAngle;

  void main() {
    vec2 mirroredUv = vec2(1.0 - vPageUv.x, vPageUv.y);
    vec2 frontUv = uMirrored > 0.5 ? mirroredUv : vPageUv;
    vec2 backUv = uMirrored > 0.5 ? vPageUv : mirroredUv;
    bool semanticFront = uMirrored > 0.5 ? !gl_FrontFacing : gl_FrontFacing;
    vec4 paper = semanticFront ? texture2D(uFrontMap, frontUv) : texture2D(uBackMap, backUv);
    vec3 normal = normalize(gl_FrontFacing ? vCurlNormal : -vCurlNormal);
    float envelope = 4.0 * clamp(uProgress, 0.0, 1.0) * (1.0 - clamp(uProgress, 0.0, 1.0));
    float fold = pow(abs(sin(vFoldAngle)), 1.4);
    float facing = 0.93 + 0.07 * abs(normal.z);
    float shade = mix(1.0, facing * (1.0 - 0.08 * fold), envelope);
    float outerCurl = smoothstep(0.48, 1.0, vPageUv.x);
    float fakeOuterShadow = outerCurl * fold * envelope * uShadowOpacity;
    shade *= 1.0 - 0.24 * fakeOuterShadow;
    gl_FragColor = vec4(paper.rgb * shade, paper.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

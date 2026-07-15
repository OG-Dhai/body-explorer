import { describe, it, expect } from 'vitest';
import { EMAFilter, computeDistance, computeDynamicThreshold, clamp, lerp, smoothValue } from './spatialMath.js';

describe('spatialMath', () => {
  it('EMAFilter smooths values correctly', () => {
    const filter = new EMAFilter(0.5);
    expect(filter.update(10)).toBe(10);
    expect(filter.update(20)).toBe(15);
    filter.reset();
    expect(filter.update(30)).toBe(30);
  });

  it('computeDistance calculates 3D Euclidean distance', () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 3, y: 4, z: 0 };
    expect(computeDistance(a, b)).toBe(5);
  });

  it('computeDynamicThreshold calculates shoulder width based threshold', () => {
    const landmarks = [];
    landmarks[11] = { x: -0.2, y: 0, z: 0 }; // left shoulder
    landmarks[12] = { x: 0.2, y: 0, z: 0 };  // right shoulder
    // Distance = 0.4. 80% = 0.32
    expect(computeDynamicThreshold(landmarks)).toBeCloseTo(0.32);
    
    // Test occlusion
    expect(computeDynamicThreshold([])).toBe(0.30); // fallback
  });

  it('clamp restricts values', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('lerp interpolates values', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it('smoothValue smooths based on factor', () => {
    expect(smoothValue(0, 10, 0.5)).toBe(5);
  });
});

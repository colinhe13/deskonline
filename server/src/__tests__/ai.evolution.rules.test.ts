import { describe, it, expect } from "vitest";
import {
  EVOLVE_MIN_SAMPLES,
  nextBluffHintRate,
} from "../ai/evolution/rules.js";

describe("nextBluffHintRate", () => {
  it("does not move before the minimum sample count", () => {
    expect(
      nextBluffHintRate(0.1, 0.1, {
        attempts: EVOLVE_MIN_SAMPLES - 1,
        successes: 0,
      }),
    ).toBe(0.1);
    expect(nextBluffHintRate(0.1, 0.1, { attempts: 0, successes: 0 })).toBe(
      0.1,
    );
  });

  it("raises by 10% when bluffs keep landing (rate >= 0.6)", () => {
    const next = nextBluffHintRate(0.1, 0.15, { attempts: 10, successes: 6 });
    expect(next).toBeCloseTo(0.11, 10);
  });

  it("lowers by 10% when bluffs keep getting caught (rate <= 0.3)", () => {
    const next = nextBluffHintRate(0.2, 0.3, { attempts: 10, successes: 3 });
    expect(next).toBeCloseTo(0.18, 10);
  });

  it("holds steady in the middle band", () => {
    const next = nextBluffHintRate(0.2, 0.3, { attempts: 10, successes: 5 });
    // Still clamped into the seed band when current sits outside it.
    expect(next).toBeCloseTo(0.2, 10);
    expect(
      nextBluffHintRate(0.25, 0.3, { attempts: 10, successes: 5 }),
    ).toBeCloseTo(0.25, 10);
  });

  it("clamps upward moves at seed × 1.5", () => {
    // Seed 0.1 → band [0.05, 0.15]; 0.145 × 1.1 = 0.1595 must clamp to 0.15.
    const next = nextBluffHintRate(0.145, 0.1, { attempts: 10, successes: 9 });
    expect(next).toBeCloseTo(0.15, 10);
  });

  it("clamps downward moves at seed × 0.5", () => {
    // Seed 0.4 → band [0.2, 0.5]; 0.205 × 0.9 = 0.1845 must clamp to 0.2.
    const next = nextBluffHintRate(0.205, 0.4, { attempts: 10, successes: 0 });
    expect(next).toBeCloseTo(0.2, 10);
  });

  it("respects the absolute band [0.01, 0.5] for extreme seeds", () => {
    // Tiny seed 0.01: band lower bound max(0.005, 0.01) = 0.01.
    const down = nextBluffHintRate(0.011, 0.01, {
      attempts: 10,
      successes: 0,
    });
    expect(down).toBeCloseTo(0.01, 10);
    // Huge seed 0.8: band upper bound min(1.2, 0.5) = 0.5.
    const up = nextBluffHintRate(0.49, 0.8, { attempts: 10, successes: 10 });
    expect(up).toBeCloseTo(0.5, 10);
  });

  it("keeps nit-rock and maniac personalities inside their own bands", () => {
    for (let i = 0; i < 30; i++) {
      const nit = nextBluffHintRate(0.02, 0.02, {
        attempts: 100,
        successes: 100,
      });
      expect(nit).toBeGreaterThanOrEqual(0.01);
      expect(nit).toBeLessThanOrEqual(0.03);
    }
  });

  it("never diverges across repeated evolution rounds (adversarial loop)", () => {
    // Simulate an adversarial long run: always-success samples pushing up.
    let value = 0.4;
    for (let i = 0; i < 100; i++) {
      value = nextBluffHintRate(value, 0.4, { attempts: 50, successes: 50 });
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0.2);
      expect(value).toBeLessThanOrEqual(0.5);
    }
    expect(value).toBeCloseTo(0.5, 10);
    // Then always-caught samples pushing down.
    for (let i = 0; i < 100; i++) {
      value = nextBluffHintRate(value, 0.4, { attempts: 50, successes: 0 });
      expect(value).toBeGreaterThanOrEqual(0.2);
      expect(value).toBeLessThanOrEqual(0.5);
    }
    expect(value).toBeCloseTo(0.2, 10);
  });

  it("survives degenerate inputs without NaN or throw", () => {
    expect(
      Number.isFinite(
        nextBluffHintRate(NaN, 0.3, { attempts: 9, successes: 9 }),
      ),
    ).toBe(true);
    expect(
      Number.isFinite(nextBluffHintRate(0.3, 0, { attempts: 9, successes: 9 })),
    ).toBe(true);
    expect(
      Number.isFinite(
        nextBluffHintRate(0.3, -1, { attempts: 9, successes: 9 }),
      ),
    ).toBe(true);
    expect(
      nextBluffHintRate(0.3, 0.3, { attempts: 10, successes: 10 }),
    ).toBeLessThanOrEqual(0.5);
  });
});

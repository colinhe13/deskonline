// Bounded persona evolution rules — pure functions, fully unit-testable.
//
// Signal: the AI's own cross-match cumulative bluff outcomes (not opponent
// impressions). Step ±10%, anchored to the seed within ±50% and the absolute
// band [0.01, 0.50], so evolution stays bounded, predictable and cannot
// wash out persona differentiation (a nit-rock stays a nit-rock).

export const EVOLVE_MIN_SAMPLES = 5;
export const EVOLVE_UP_THRESHOLD = 0.6;
export const EVOLVE_DOWN_THRESHOLD = 0.3;

const UP_FACTOR = 1.1;
const DOWN_FACTOR = 0.9;
const ABS_MIN = 0.01;
const ABS_MAX = 0.5;

export interface BluffSample {
  attempts: number;
  successes: number;
}

function clampToSeedBand(value: number, seed: number): number {
  const lo = Math.max(seed * 0.5, ABS_MIN);
  const hi = Math.min(seed * 1.5, ABS_MAX);
  return Math.min(Math.max(value, lo), hi);
}

export function nextBluffHintRate(
  current: number,
  seed: number,
  sample: BluffSample,
): number {
  if (!Number.isFinite(current) || !Number.isFinite(seed) || seed <= 0) {
    return Math.min(
      Math.max(Number.isFinite(current) ? current : ABS_MIN, ABS_MIN),
      ABS_MAX,
    );
  }
  if (sample.attempts < EVOLVE_MIN_SAMPLES) return current;
  const rate = sample.successes / sample.attempts;
  let next = current;
  if (rate >= EVOLVE_UP_THRESHOLD) next = current * UP_FACTOR;
  else if (rate <= EVOLVE_DOWN_THRESHOLD) next = current * DOWN_FACTOR;
  return clampToSeedBand(next, seed);
}

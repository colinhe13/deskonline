import { ref, watch, type Ref } from "vue";

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 数值滚动动画：监听 source，rAF 缓动插值输出显示值；减弱动效时直接跳变。 */
export function useCountUp(source: Ref<number>, duration = 300): Ref<number> {
  const display = ref(source.value);
  let raf = 0;

  watch(source, (target) => {
    cancelAnimationFrame(raf);
    if (REDUCED_MOTION) {
      display.value = target;
      return;
    }
    const from = display.value;
    if (from === target) return;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      display.value = Math.round(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });

  return display;
}

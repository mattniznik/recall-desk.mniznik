// Sizes of the marks in the dot field (How.tsx, Field), from the grid step ("pitch").
//
// A lit mark stands out by colour and a modest size step, and always fits inside its own
// cell. Before 2026-11-14 a lit dot was 2.1 grid dots (1.26 steps wide) and a recall square
// about one step, so lit marks overlapped and clumped
// (test/web-field.test.ts).

export type MarkSizes = {
  dot: number; // radius of a plain grid dot
  lit: number; // radius of a lit complaint dot
  pulse: number; // largest radius while a dot is lighting up
  square: number; // side of a lit recall square
};

export function markSizes(pitch: number): MarkSizes {
  const dot = Math.max(1.6, pitch * 0.3);
  return {
    dot,
    lit: Math.min(dot * 1.35, pitch * 0.42),
    pulse: Math.min(dot * 1.5, pitch * 0.45),
    square: Math.min(dot * 2.4, pitch * 0.8),
  };
}

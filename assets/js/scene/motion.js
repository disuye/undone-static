export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// Point-to-point industrial motion: ease between poses, hold, repeat.
export const createSequencer = (poses, { move = 2.6, hold = 1.4, offset = 0 } = {}) => {
  const segment = move + hold;
  const span = segment * poses.length;

  return (time, out) => {
    const t = ((time + offset) % span + span) % span;
    const i = Math.floor(t / segment);
    const from = poses[i];
    const to = poses[(i + 1) % poses.length];
    const k = smootherstep(clamp01((t - i * segment) / move));
    for (let j = 0; j < from.length; j += 1) out[j] = from[j] + (to[j] - from[j]) * k;
    return out;
  };
};

// Ease toward a target each frame, independent of frame rate.
export const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

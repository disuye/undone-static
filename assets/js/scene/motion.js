export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// Trapezoidal velocity profile: hard accelerate, constant-speed cruise, hard brake.
export const trapezoid = (t, ramp = 0.2) => {
  const v = 1 / (1 - ramp);
  if (t < ramp) return (v * t * t) / (2 * ramp);
  if (t > 1 - ramp) return 1 - (v * (1 - t) ** 2) / (2 * ramp);
  return v * (t - ramp / 2);
};

// Servo settle after a hard stop: a small decaying overshoot past the target.
const settle = (t) => 0.03 * Math.exp(-12 * t) * Math.sin(36 * t);

/**
 * Point-to-point industrial motion over keys [{ pose, hold }, …], looping. Move time is set by
 * whichever joint has furthest to travel at its rated speed, so all axes start and stop together.
 */
export const createSequencer = (keys, { speeds, minMove = 0.35, offset = 0 }) => {
  let start = 0;
  const segments = keys.map(({ pose: to, hold }, i) => {
    const from = keys[(i - 1 + keys.length) % keys.length].pose;
    const move = Math.max(minMove, ...to.map((a, j) => Math.abs(a - from[j]) / speeds[j]));
    const segment = { from, to, start, move };
    start += move + hold;
    return segment;
  });
  const span = start;

  return (time, out) => {
    const t = ((time + offset) % span + span) % span;
    const { from, to, start: s, move } = segments.findLast((seg) => seg.start <= t);
    const local = t - s;
    const k = local < move ? trapezoid(local / move) : 1 + settle(local - move);
    for (let j = 0; j < from.length; j += 1) out[j] = from[j] + (to[j] - from[j]) * k;
    return out;
  };
};

// Ease toward a target each frame, independent of frame rate.
export const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

const INTERVAL_MS = 1800;

const random = (min, max) => min + Math.random() * (max - min);

const { style } = document.body;
document.documentElement.style.setProperty('--bg-t', INTERVAL_MS);

const randomiseBackground = () => {
  style.setProperty('--bg-zoom', random(2, 6).toFixed(2));
  style.setProperty('--bg-x', `${random(0, 100).toFixed(1)}%`);
  style.setProperty('--bg-y', `${random(0, 100).toFixed(1)}%`);
  style.setProperty('--bg-b', `${random(50, 0).toFixed(1)}px`);
};

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lowSpec = navigator.hardwareConcurrency <= 2 || navigator.deviceMemory <= 2;

randomiseBackground();

if (!reducedMotion && !lowSpec) {
  setInterval(randomiseBackground, INTERVAL_MS);
}

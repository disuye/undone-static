// A/B switch for the 3D background: Babylon.js by default, ?engine=three for the original Three.js scene.
// Every other URL option (?debug&hud&bench&still&t&cam…) works the same on both.
// Revert: point index.html's module script back at assets/js/scene/index.js.
const engine = new URLSearchParams(location.search).get('engine');
import(engine === 'three' ? '../js/scene/index.js' : './bb-scene/bb-index.js');

The Babylon.js version of the scene is in [assets/babylon/](assets/babylon/) and is now what index.html loads by default; add `?engine=three` to get the original. In headless Chrome the two render within about 2–3/255 average brightness of each other in the same frame; I couldn't check Safari. I haven't committed anything.

**Running the A/B**
- The only edit to [index.html](index.html) is that its module script now points at [bb-switch.js](assets/babylon/bb-switch.js). To revert, point it back at `assets/js/scene/index.js`.
- All the debug flags work the same on both, so `?debug&hud&bench`, `&still&t=…`, `&cam=…` and `&glitch=…` give like-for-like runs. The HUD says which engine is running.
- [scene.css](assets/css/scene.css) is shared unchanged, so there's no bb-*.css file.
- The Three.js files are untouched. The Babylon folder doesn't import anything from them, so either engine can be deleted on its own.

**Port and bundle**
- **Same scene:** room, arms, hose physics, clutter, equipment, dust, orb cycle, camera rig, 30 fps cadence, quality tiers, slow-machine fallback and the 3D switch. Textures, layout and glitch timing use the same random seeds, so they come out identical.
- **Geometry:** I ported Three's shape generators, so both engines draw the same vertices.
- **Post-processing:** bloom, depth of field, glitch and grade are shader-for-shader ports.
- **Bundle:** built the same way as the Three one, by [bb-build.sh](assets/babylon/bb-vendor/bb-build.sh) using Babylon 9.33.2. It's 2.27 MB (524 KB gzipped) against Three's 0.89 MB (266 KB). The area-light lookup table Babylon normally fetches from its CDN is now served locally, so there are no third-party requests.

**How closely they match (headless Chrome, 1280×720)**

| | Three | Babylon |
|---|---|---|
| Low tier, average frame difference | — | 1.7/255 |
| High tier, average frame difference | — | 3.2/255 |
| Frame time, high tier | 7.0 ms | 7.6 ms |
| Frame time, low tier | 2.9 ms | 4.5 ms |
| Draw calls, low tier | 530 | 724 |
| First frame | ~540 ms (holds up page load) | ~1.7 s (page load finishes at ~65 ms) |

- Each light type on its own matches within about 1/255. The glitch bursts land on the same frames.
- The hole check shows no missing surfaces. The 3D switch and the fallback to the low tier both work.
- Babylon renders shadow maps without culling objects outside the light's view, which accounts for most of its extra draw calls.

**Unavoidable differences**
- **Ambient occlusion:** Babylon has nothing equivalent to Three's GTAO. Its SSAO2 stands in, with strength set by comparing frames (0.25) rather than copied, because it darkens open floor much more at the same settings.
- **Orb point-light shadows:** Babylon can't do PCF filtering on cube shadow maps, so they use Poisson sampling instead.
- **Glossy reflections:** Babylon's read very slightly warmer, about 2 levels in the blue channel.
- **Safari:** Babylon wouldn't finish loading in the offscreen WebKit snapshot tool, because that view slows timers to a crawl and Babylon's shader compile waits on them; Three got through because it sets up synchronously. Please open it in Safari yourself.

**Babylon defaults I had to work around**
- **Patched lighting formulas:** [bb-parity.js](assets/babylon/bb-scene/bb-parity.js) swaps Three's formulas into five of Babylon's shader snippets: spotlight edge falloff, fog distance and amount, area-light reflection strength, and a slight blur on sharp reflections to match Three's.
  - These are tied to Babylon 9.33.2. If an upgrade changes the snippets, the console warns and Babylon's own formula is used instead.
- **Fog colour:** Babylon treats `scene.fogColor` as sRGB and converts it, which made the haze about 8× darker.
- **Reflection capture:** a render-target environment gets re-rendered every frame unless frozen, which was costing about 2,500 draw calls. The cube capture also came out mirrored front-to-back in this right-handed setup.
- **Other gotchas:** Babylon defines its own `FOG` in custom shaders, which was fogging the light wall. The texture option I used for mipmaps was silently ignored. Mesh winding is reversed in right-handed mode. The default limit is 4 lights per material, and this scene has 8.

**Babylon improvements I didn't add — say which you want**
- Automatic instancing of repeated meshes, and caching shadows for objects that never move (perf).
- Screen-space reflections, which would put the orb and lights on the floor.
- Contact-hardening soft shadows (PCSS) on the main spotlight.
- MSAA anti-aliasing (Three currently has none).
- Sharper reflections, by dropping the blur-matching patch.

The bench numbers are from headless Chrome on this Mac, so rerun `?debug&hud&bench` and `?engine=three&debug&hud&bench` on your own hardware for real figures.

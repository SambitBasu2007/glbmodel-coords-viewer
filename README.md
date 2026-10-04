# Coord Viewer

A local developer tool for reading **exact world coordinates** from any 3D model, so the same
numbers work when you drop the model into your own Three.js project (game, scene, ...).

Plain Vite + TypeScript (strict) + three.js. No UI framework, no other runtime dependencies,
no network access, no backend — everything runs offline.

## Run

```bash
npm install
npm run dev      # open the printed localhost URL
npm run build    # tsc && vite build
```

## Using it

1. Drop `.glb` files into `assets/` (a small sample room ships there) and reload.
   Every `.glb` in `/assets` is auto-discovered via `import.meta.glob`.
2. **Read coordinates** from the side panel: live camera position, orbit target, clicked
   point (3 decimals) and model bounds. Click the model to place a yellow marker.
3. **Copy as Vector3** puts `new THREE.Vector3(x, y, z)` on the clipboard.
4. **Scale slider** previews the model at 0.1×–10×. The model itself is *never* moved,
   rotated or recentered — only the slider changes `model.scale`, pivoting on the origin
   exactly like `model.scale.setScalar(...)` would in your own project.
5. **Axis gizmo** (top-right) clicks to a camera view from ±X/±Y/±Z, like Blender.
6. **Go to coordinates**: type x/y/z, then "Mark point" (drops the marker) or
   "Look from here" (camera exactly at that spot, facing −Z).
7. **Frame model** repositions only the camera and orbit target.

## Coordinate conventions

- Three.js conventions throughout: **Y is up**, right-handed. Axes are never silently converted.
- Blender-equivalent readout is `(x, -z, y)`, **valid for default glTF export (+Y Up)**.
- Grids, axis lines, number labels and the marker use `depthTest: false` with high
  `renderOrder`, so they are always visible *through* any model, from any angle.
- For coordinates to match in your project, use the same scale shown in the panel
  (`model.scale.setScalar(1.000)`).

## Project structure

```
index.html        layout + CSS (two-column: viewport + 290px panel, top controls, gizmo)
src/main.ts       app code in labelled sections: scene, overlays, model, picking, gizmo, loop
assets/           models (auto-discovered .glb); ships with a 4x3x5 sample room
tsconfig.json     strict TypeScript, types: ["vite/client"]
```

## Verification performed

- `npm install`, `npx tsc --noEmit` (0 errors), `npm run build` all pass.
- Browser-tested: sample model loads at its original coordinates
  (bounds `min -2, 0, -5` / `max 2, 3, 0`), click-pick, drag-vs-click threshold,
  scale slider (bounds and marker follow, typed points stay world-fixed), reset,
  "Look from here" with NaN input, gizmo axis views incl. mid-animation re-clicks,
  model-switch cleanup (geometries disposed, pick cleared, scale reset),
  load-failure and empty-folder messages.

## Non-goals (not built, on purpose)

Model editing/export, texture tools, orthographic camera, FBX/OBJ support, Draco,
multi-file `.gltf`, physics, and any backend.

## Possible future work

Orthographic toggle for axis views, WASD first-person movement, showing Blender empty
objects (named locators like `SPAWN_POINT`) as labelled markers, `.gltf` and Draco support.

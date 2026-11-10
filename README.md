# Aster PMX2VRM Workshop — Test Preview

Android-first browser prototype for PMX inspection and experimental VRM export using **Three.js + three-vrm**. No Unity or UniVRM runtime is used in this preview.

## Open the preview
https://aster-pmx2vrm-preview.vercel.app/

## Included in this preview
- PMX and ZIP import (one PMX per ZIP)
- Mobile 3D preview with touch orbit, zoom and pan
- Separate texture selection and ZIP texture extraction
- Skeleton inspection and humanoid mapping editor
- Auto T-pose and Reset pose controls
- Model metadata and VRM 0.x thumbnail input
- Material modes: MToon anime shading and Material Unlit
- Klee Kaboom-inspired toon preset, plus Classic Anime and Soft Anime presets
- Browser-side VRM 0.x and VRM 1.0 export modules
- Standalone smoke-test pages for both exporter paths

## Important status
This is an experimental test build, not a verified general-purpose PMX-to-VRM converter. A file being downloaded does not prove it is valid or compatible. Test exported VRMs in a validator and target apps such as VRM Posing Mobile or Virtual Droid before relying on them. The MToon/Unlit extension data is written by the browser exporters, but exact visual matching and target-app rendering still require testing with real models. MMD physics, IK, expressions, SpringBone and colliders are not fully converted.

## Browser requirements
Use a modern browser with WebGL and module support. Three.js, JSZip and three-vrm are loaded from public CDNs, so internet access is required. Model files are processed locally in the browser; do not upload private or sensitive model files to public repositories.

## Scope of this preview
This repository contains only the browser-based Three.js / three-vrm prototype and its tests.

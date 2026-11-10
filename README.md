# Aster PMX2VRM Workshop — Test Preview

Android-first browser prototype for PMX inspection and experimental VRM export using Three.js and three-vrm.

## Open the preview
After the GitHub Pages workflow succeeds, visit:
https://evitalove123.github.io/test-Preview-Pmx2vrm/

## Included in this preview
- PMX and ZIP import (one PMX per ZIP)
- Mobile 3D preview with touch orbit, zoom and pan
- Separate texture selection and ZIP texture extraction
- Skeleton inspection and humanoid mapping editor
- Model metadata and VRM 0.x thumbnail input
- GLB preview download
- Experimental browser-side VRM 0.x and VRM 1.0 export modules
- Standalone smoke-test pages for both exporter paths

## Important status
This is an experimental test build, not a verified general-purpose PMX-to-VRM converter. A file being downloaded does not prove it is valid or compatible. Test exported VRMs in a validator and target apps such as VRM Posing Mobile or Virtual Droid before relying on them. MMD physics, IK, expressions, complete material conversion, SpringBone and colliders are not fully converted.

## Browser requirements
Use a modern browser with WebGL and module support. Three.js, JSZip and three-vrm are loaded from public CDNs, so internet access is required. Model files are processed locally in the browser; do not upload private or sensitive model files to public repositories.

## Scope of this preview
This repository contains only the browser-based Three.js / three-vrm prototype and its tests. The Unity / UniVRM runtime project is intentionally excluded from this test preview.

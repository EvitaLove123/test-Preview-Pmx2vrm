/**
 * Aster PMX2VRM — Three-vrm runtime adapter (migration phase 1).
 *
 * This module is intentionally an IMPORT / INSPECTION adapter.
 * @pixiv/three-vrm is a VRM runtime loader; it is not itself a VRM exporter.
 * VRM serialization will be implemented separately and validated before the
 * old Unity/UniVRM path is retired.
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

export function createVrmLoader() {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  return loader;
}

/**
 * Parse a .vrm / GLB ArrayBuffer and return its VRM instance.
 * Supports both VRM 0.x and VRM 1.0 files understood by three-vrm.
 */
export async function inspectVrm(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 20) {
    throw new TypeError('A valid VRM/GLB ArrayBuffer is required.');
  }

  const loader = createVrmLoader();
  const gltf = await loader.parseAsync(arrayBuffer, '');
  const vrm = gltf.userData?.vrm;

  if (!vrm || !vrm.scene || !vrm.humanoid) {
    throw new Error('The file loaded as glTF, but a valid VRM humanoid was not found.');
  }

  VRMUtils.rotateVRM0(vrm);

  const metaVersion = vrm.meta?.metaVersion;
  if (metaVersion !== '0' && metaVersion !== '1') {
    throw new Error('Unsupported or missing VRM metadata version.');
  }

  return {
    gltf,
    vrm,
    report: {
      format: metaVersion === '0' ? 'VRM 0.x' : 'VRM 1.0',
      name: vrm.meta?.name || '',
      humanoid: Boolean(vrm.humanoid),
      expressions: Boolean(vrm.expressionManager),
      springBone: Boolean(vrm.springBoneManager),
      scene: vrm.scene,
    },
  };
}

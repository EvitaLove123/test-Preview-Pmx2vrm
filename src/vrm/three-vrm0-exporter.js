/**
 * Aster PMX2VRM — legacy VRM 0.x serializer (phase 3 foundation).
 *
 * Writes the monolithic extensions.VRM payload into a GLB produced by
 * Three.js GLTFExporter. This implementation covers metadata, humanoid and first-person references,
 * optional BlendShapeMaster groups and an embedded PNG/JPEG thumbnail.
 * MToon/materialProperties and secondaryAnimation remain future increments.
 */
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { inspectVrm } from './three-vrm-runtime.js';

const REQUIRED_BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
];

const BONE_NAMES = new Set([
  ...REQUIRED_BONES,
  'upperChest', 'leftShoulder', 'rightShoulder',
  'leftToes', 'rightToes', 'leftEye', 'rightEye', 'jaw',
  ...['left', 'right'].flatMap((side) =>
    ['Thumb', 'Index', 'Middle', 'Ring', 'Little'].flatMap((finger) =>
      ['Proximal', 'Intermediate', 'Distal'].map((part) => side + finger + part)
    )
  ),
]);

const LICENSES = new Set([
  'Redistribution_Prohibited', 'CC0', 'CC_BY', 'CC_BY_NC',
  'CC_BY_SA', 'CC_BY_NC_SA', 'CC_BY_ND', 'CC_BY_NC_ND', 'Other',
]);

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(label + ' is required.');
  }
  return value.trim();
}

function makeMeta(input = {}) {
  const licenseName = input.licenseName || 'Redistribution_Prohibited';
  const allowedUserName = input.allowedUserName || 'OnlyAuthor';
  const violentUssageName = input.violentUssageName || 'Disallow';
  const sexualUssageName = input.sexualUssageName || 'Disallow';
  const commercialUssageName = input.commercialUssageName || 'Disallow';

  if (!LICENSES.has(licenseName)) throw new Error('Invalid VRM 0.x licenseName.');
  if (!['OnlyAuthor', 'ExplicitlyLicensedPerson', 'Everyone'].includes(allowedUserName)) {
    throw new Error('Invalid allowedUserName.');
  }
  for (const value of [violentUssageName, sexualUssageName, commercialUssageName]) {
    if (!['Disallow', 'Allow'].includes(value)) throw new Error('VRM 0.x usage permissions must be Allow or Disallow.');
  }
  if (licenseName === 'Other' && !input.otherLicenseUrl) {
    throw new Error('otherLicenseUrl is required when licenseName is Other.');
  }

  const meta = {
    title: requiredText(input.title || input.name, 'Model title'),
    author: requiredText(input.author, 'Model author'),
    allowedUserName,
    violentUssageName,
    sexualUssageName,
    commercialUssageName,
    licenseName,
  };

  for (const key of [
    'version', 'contactInformation', 'reference',
    'otherPermissionUrl', 'otherLicenseUrl',
  ]) {
    if (typeof input[key] === 'string' && input[key].trim()) meta[key] = input[key].trim();
  }
  if (Number.isInteger(input.texture) && input.texture >= 0) meta.texture = input.texture;
  return meta;
}


const BLENDSHAPE_PRESETS = new Set([
  'Unknown', 'Neutral', 'A', 'I', 'U', 'E', 'O', 'Blink',
  'Joy', 'Angry', 'Sorrow', 'Fun', 'LookUp', 'LookDown',
  'LookLeft', 'LookRight', 'Blink_L', 'Blink_R',
]);

function buildBlendShapeMaster(groups, scene, gltfJson) {
  if (groups == null) return undefined;
  if (!Array.isArray(groups)) throw new TypeError('blendShapeGroups must be an array.');

  const sceneMeshCounts = new Map();
  scene.traverse((object) => {
    if (!object.isMesh || !object.name) return;
    sceneMeshCounts.set(object.name, (sceneMeshCounts.get(object.name) || 0) + 1);
  });
  const gltfMeshesByNodeName = new Map();
  gltfJson.nodes.forEach((node) => {
    if (node.mesh === undefined || !node.name) return;
    const list = gltfMeshesByNodeName.get(node.name) || [];
    list.push(node.mesh);
    gltfMeshesByNodeName.set(node.name, list);
  });

  const blendShapeGroups = groups.map((group, groupIndex) => {
    if (!group || typeof group !== 'object') {
      throw new TypeError('BlendShape group #' + groupIndex + ' must be an object.');
    }
    const presetName = String(group.presetName || 'Unknown');
    if (!BLENDSHAPE_PRESETS.has(presetName)) {
      throw new Error('Invalid VRM 0.x BlendShape preset: ' + presetName);
    }
    const binds = (group.binds || []).map((bind, bindIndex) => {
      const meshObject = bind?.mesh;
      if (!meshObject?.isMesh || !meshObject.name) {
        throw new Error('BlendShape bind #' + bindIndex + ' must reference a Three.js Mesh.');
      }
      if (sceneMeshCounts.get(meshObject.name) !== 1) {
        throw new Error('BlendShape mesh name is missing or duplicated: ' + meshObject.name);
      }
      const meshIndices = gltfMeshesByNodeName.get(meshObject.name) || [];
      if (meshIndices.length !== 1) {
        throw new Error('BlendShape mesh was not exported uniquely: ' + meshObject.name);
      }
      const meshIndex = meshIndices[0];
      const gltfMesh = gltfJson.meshes?.[meshIndex];
      const primitives = gltfMesh?.primitives || [];
      if (!primitives.length) throw new Error('Exported BlendShape mesh has no primitives.');
      const targetCounts = primitives.map((primitive) => (primitive.targets || []).length);
      if (targetCounts.some((count) => count !== targetCounts[0])) {
        throw new Error('BlendShape target counts differ across mesh primitives.');
      }
      const targetNames = gltfMesh.extras?.targetNames || [];
      let targetIndex;
      if (Number.isInteger(bind.target)) {
        targetIndex = bind.target;
      } else if (typeof bind.target === 'string' && bind.target.trim()) {
        targetIndex = targetNames.indexOf(bind.target.trim());
      } else {
        throw new Error('BlendShape bind must specify target name or index.');
      }
      if (targetIndex < 0 || targetIndex >= targetCounts[0]) {
        throw new Error('BlendShape target not found on mesh ' + meshObject.name + ': ' + bind.target);
      }
      const weight = bind.weight === undefined ? 1 : Number(bind.weight);
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
        throw new Error('BlendShape bind weight must be between 0 and 1.');
      }
      return { mesh: meshIndex, index: targetIndex, weight };
    });
    const result = {
      name: String(group.name || group.presetName || 'Unknown'),
      presetName,
      binds,
      materialValues: Array.isArray(group.materialValues) ? group.materialValues : [],
      isBinary: group.isBinary === true,
    };
    return result;
  });
  return { blendShapeGroups };
}

function readGlb(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 20 ||
      view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2) {
    throw new Error('GLTFExporter did not produce a valid GLB 2.0 file.');
  }
  if (view.getUint32(8, true) !== view.byteLength) {
    throw new Error('GLB length header is inconsistent.');
  }

  let offset = 12;
  let json = null;
  const chunks = [];
  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (end > view.byteLength) throw new Error('GLB chunk exceeds file bounds.');
    const bytes = new Uint8Array(arrayBuffer, start, length);
    if (type === 0x4e4f534a) {
      if (json) throw new Error('GLB contains multiple JSON chunks.');
      json = JSON.parse(new TextDecoder().decode(bytes).trim());
    } else {
      chunks.push({ type, bytes: new Uint8Array(bytes) });
    }
    offset = end;
  }
  if (!json || !Array.isArray(json.nodes)) throw new Error('GLB JSON or nodes are missing.');
  return { json, chunks };
}

function writeGlb(json, chunks) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const paddedJson = new Uint8Array(jsonLength);
  paddedJson.fill(0x20);
  paddedJson.set(jsonBytes);

  const totalLength = 12 + 8 + paddedJson.length +
    chunks.reduce((sum, chunk) => sum + 8 + chunk.bytes.length, 0);
  const output = new ArrayBuffer(totalLength);
  const view = new DataView(output);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);

  let offset = 12;
  view.setUint32(offset, paddedJson.length, true);
  view.setUint32(offset + 4, 0x4e4f534a, true);
  new Uint8Array(output, offset + 8, paddedJson.length).set(paddedJson);
  offset += 8 + paddedJson.length;

  for (const chunk of chunks) {
    if (chunk.bytes.length % 4 !== 0) throw new Error('GLB chunk is not 4-byte aligned.');
    view.setUint32(offset, chunk.bytes.length, true);
    view.setUint32(offset + 4, chunk.type, true);
    new Uint8Array(output, offset + 8, chunk.bytes.length).set(chunk.bytes);
    offset += 8 + chunk.bytes.length;
  }
  return output;
}


async function embedThumbnail(json, chunks, thumbnail) {
  if (thumbnail == null) return null;
  let blob;
  if (thumbnail instanceof Blob) {
    blob = thumbnail;
  } else if (thumbnail?.data instanceof ArrayBuffer && typeof thumbnail.mimeType === 'string') {
    blob = new Blob([thumbnail.data], { type: thumbnail.mimeType });
  } else {
    throw new TypeError('thumbnail must be a PNG/JPEG Blob or {data:ArrayBuffer,mimeType}.');
  }
  const mimeType = blob.type.toLowerCase();
  if (!['image/png', 'image/jpeg'].includes(mimeType)) {
    throw new Error('VRM 0.x thumbnail must be PNG or JPEG.');
  }
  if (blob.size === 0 || blob.size > 8 * 1024 * 1024) {
    throw new Error('Thumbnail must be between 1 byte and 8 MiB.');
  }

  const binChunk = chunks.find((chunk) => chunk.type === 0x004e4942);
  if (!binChunk) throw new Error('Cannot embed thumbnail: GLB BIN chunk is missing.');
  if (!Array.isArray(json.buffers) || !json.buffers[0]) {
    throw new Error('Cannot embed thumbnail: GLB buffer definition is missing.');
  }

  const imageBytes = new Uint8Array(await blob.arrayBuffer());
  const oldBufferLength = Number(json.buffers[0].byteLength);
  if (!Number.isInteger(oldBufferLength) || oldBufferLength < 0 || oldBufferLength > binChunk.bytes.length) {
    throw new Error('GLB buffer byteLength is invalid.');
  }
  const byteOffset = Math.ceil(oldBufferLength / 4) * 4;
  const unpaddedLength = byteOffset + imageBytes.length;
  const paddedLength = Math.ceil(unpaddedLength / 4) * 4;
  const nextBin = new Uint8Array(paddedLength);
  nextBin.set(binChunk.bytes.subarray(0, oldBufferLength), 0);
  nextBin.set(imageBytes, byteOffset);
  binChunk.bytes = nextBin;

  json.buffers[0].byteLength = unpaddedLength;
  json.bufferViews = json.bufferViews || [];
  json.images = json.images || [];
  json.textures = json.textures || [];
  const bufferViewIndex = json.bufferViews.length;
  const imageIndex = json.images.length;
  const textureIndex = json.textures.length;
  json.bufferViews.push({
    buffer: 0,
    byteOffset,
    byteLength: imageBytes.length,
  });
  json.images.push({ bufferView: bufferViewIndex, mimeType });
  json.textures.push({ source: imageIndex });
  return textureIndex;
}

function mapNodes(scene, gltfJson, mapping) {
  if (!mapping || typeof mapping !== 'object') throw new Error('Humanoid mapping is required.');

  const sceneNames = new Map();
  scene.traverse((object) => {
    if (!object.name) return;
    sceneNames.set(object.name, (sceneNames.get(object.name) || 0) + 1);
  });
  const exportedNames = new Map();
  gltfJson.nodes.forEach((node, index) => {
    if (!node.name) return;
    const values = exportedNames.get(node.name) || [];
    values.push(index);
    exportedNames.set(node.name, values);
  });

  const result = {};
  const byObject = new Map();
  for (const [bone, object] of Object.entries(mapping)) {
    if (!BONE_NAMES.has(bone)) throw new Error('Unknown VRM 0.x humanoid bone: ' + bone);
    if (!object || !object.name) continue;
    if (sceneNames.get(object.name) !== 1) {
      throw new Error('Humanoid node name is missing or duplicated in scene: ' + object.name);
    }
    const indices = exportedNames.get(object.name) || [];
    if (indices.length !== 1) {
      throw new Error('Humanoid node was not exported uniquely: ' + object.name);
    }
    result[bone] = { bone, node: indices[0], useDefaultValues: true };
    byObject.set(object, indices[0]);
  }

  const missing = REQUIRED_BONES.filter((bone) => !result[bone]);
  if (missing.length) throw new Error('Missing required VRM 0.x bones: ' + missing.join(', '));
  return { humanBones: Object.values(result), byObject };
}

/**
 * @param {import('three').Object3D} scene Root containing the complete avatar.
 * @param {object} options
 * @param {Record<string, import('three').Object3D>} options.humanoid VRM bone name -> Three.js Bone.
 * @param {object} options.meta Legacy VRM 0.x metadata.
 * @param {object} [options.firstPerson] Optional first-person settings.
 * @param {Array<object>} [options.blendShapeGroups] Groups with binds { mesh: Three.js Mesh, target: morph name or index, weight }.
 * @param {Blob|{data:ArrayBuffer,mimeType:string}} [options.thumbnail] PNG/JPEG thumbnail to embed in the GLB.
 *  */
export async function exportVrm0(scene, options = {}) {
  if (!scene || typeof scene.traverse !== 'function') {
    throw new TypeError('A Three.js avatar scene is required.');
  }
  const meta = makeMeta(options.meta);
  scene.updateMatrixWorld(true);

  const exporter = new GLTFExporter();
  const baseGlb = await exporter.parseAsync(scene, {
    binary: true,
    onlyVisible: false,
    trs: false,
    includeCustomExtensions: true,
    maxTextureSize: options.maxTextureSize || Infinity,
  });
  if (!(baseGlb instanceof ArrayBuffer)) {
    throw new Error('GLTFExporter did not return binary GLB data.');
  }

  const { json, chunks } = readGlb(baseGlb);
  const thumbnailTextureIndex = await embedThumbnail(json, chunks, options.thumbnail);
  if (thumbnailTextureIndex !== null) meta.texture = thumbnailTextureIndex;
  else if (meta.texture !== undefined && meta.texture >= (json.textures || []).length) {
    throw new Error('VRM 0.x meta.texture references a missing glTF texture.');
  }
  const humanoid = mapNodes(scene, json, options.humanoid);
  const head = options.humanoid.head;
  const headNode = humanoid.byObject.get(head);
  const firstPersonInput = options.firstPerson || {};
  const firstPersonBone = firstPersonInput.firstPersonBone
    ? humanoid.byObject.get(firstPersonInput.firstPersonBone)
    : headNode;
  if (!Number.isInteger(firstPersonBone)) {
    throw new Error('VRM 0.x firstPersonBone must resolve to an exported humanoid node.');
  }

  const firstPerson = {
    firstPersonBone,
    firstPersonBoneOffset: {
      x: Number(firstPersonInput.offset?.x) || 0,
      y: Number(firstPersonInput.offset?.y) || 0,
      z: Number(firstPersonInput.offset?.z) || 0,
    },
    meshAnnotations: [],
    lookAtTypeName: firstPersonInput.lookAtTypeName === 'BlendShape' ? 'BlendShape' : 'Bone',
  };

  const blendShapeMaster = buildBlendShapeMaster(options.blendShapeGroups, scene, json);

  const vrm = {
    specVersion: '0.0',
    exporterVersion: 'Aster PMX2VRM Browser',
    meta,
    humanoid: {
      humanBones: humanoid.humanBones,
      armStretch: 0.05,
      legStretch: 0.05,
      upperArmTwist: 0.5,
      lowerArmTwist: 0.5,
      upperLegTwist: 0.5,
      lowerLegTwist: 0.5,
      feetSpacing: 0,
      hasTranslationDoF: false,
    },
    firstPerson,
  };
  if (blendShapeMaster) vrm.blendShapeMaster = blendShapeMaster;

  json.extensions = json.extensions || {};
  json.extensions.VRM = vrm;
  json.extensionsUsed = Array.isArray(json.extensionsUsed) ? json.extensionsUsed : [];
  if (!json.extensionsUsed.includes('VRM')) json.extensionsUsed.push('VRM');

  const arrayBuffer = writeGlb(json, chunks);
  const checked = await inspectVrm(arrayBuffer);
  if (checked.report.format !== 'VRM 0.x') {
    throw new Error('Three-vrm read-back validation did not identify VRM 0.x.');
  }

  return {
    blob: new Blob([arrayBuffer], { type: 'model/gltf-binary' }),
    arrayBuffer,
    report: {
      ...checked.report,
      nodes: json.nodes.length,
      materials: (json.materials || []).length,
      meshes: (json.meshes || []).length,
      skins: (json.skins || []).length,
      extensions: json.extensionsUsed,
      humanoidBones: humanoid.humanBones.length,
      blendShapeGroups: blendShapeMaster?.blendShapeGroups.length || 0,
      thumbnailTextureIndex,
      note: 'VRM 0.x core: metadata, humanoid and first-person are serialized. MToon material mapping and secondary animation are not yet serialized.',
    },
  };
}

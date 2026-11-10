/**
 * Aster PMX2VRM — minimal VRM 1.0 serializer.
 *
 * Phase 2 scope: writes the required VRMC_vrm core extension (meta + humanoid)
 * into a GLB produced by Three.js GLTFExporter, then reads it back through
 * three-vrm. Expressions, MToon and SpringBone are deliberately later phases.
 */
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { inspectVrm } from './three-vrm-runtime.js';

const REQUIRED_BONES = [
  'hips', 'spine', 'head',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
];

const VALID_AVATAR_PERMISSION = new Set([
  'onlyAuthor', 'onlySeparatelyLicensedPerson', 'everyone',
]);
const VALID_COMMERCIAL_USAGE = new Set([
  'personalNonProfit', 'personalProfit', 'corporation',
]);
const VALID_CREDIT_NOTATION = new Set(['required', 'unnecessary']);
const VALID_MODIFICATION = new Set([
  'prohibited', 'allowModification', 'allowModificationRedistribution',
]);

function assertText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(label + ' is required.');
  }
  return value.trim();
}

function makeMeta(input) {
  const name = assertText(input.name, 'Model name');
  const authors = Array.isArray(input.authors)
    ? input.authors.map((x) => String(x).trim()).filter(Boolean)
    : [String(input.author || '').trim()].filter(Boolean);

  if (!authors.length) throw new Error('At least one author is required.');

  const licenseUrl = assertText(
    input.licenseUrl || 'https://vrm.dev/licenses/1.0/',
    'VRM 1.0 license URL',
  );
  let parsed;
  try { parsed = new URL(licenseUrl); } catch { throw new Error('License URL is invalid.'); }
  if (parsed.protocol !== 'https:') throw new Error('License URL must use HTTPS.');

  const avatarPermission = input.avatarPermission || 'onlyAuthor';
  const commercialUsage = input.commercialUsage || 'personalNonProfit';
  const creditNotation = input.creditNotation || 'required';
  const modification = input.modification || 'prohibited';

  if (!VALID_AVATAR_PERMISSION.has(avatarPermission)) throw new Error('Invalid avatar permission.');
  if (!VALID_COMMERCIAL_USAGE.has(commercialUsage)) throw new Error('Invalid commercial usage setting.');
  if (!VALID_CREDIT_NOTATION.has(creditNotation)) throw new Error('Invalid credit notation setting.');
  if (!VALID_MODIFICATION.has(modification)) throw new Error('Invalid modification setting.');

  const meta = {
    name,
    authors,
    licenseUrl,
    avatarPermission,
    commercialUsage,
    creditNotation,
    modification,
    allowExcessivelyViolentUsage: input.allowExcessivelyViolentUsage === true,
    allowExcessivelySexualUsage: input.allowExcessivelySexualUsage === true,
    allowPoliticalOrReligiousUsage: input.allowPoliticalOrReligiousUsage === true,
    allowAntisocialOrHateUsage: input.allowAntisocialOrHateUsage === true,
    allowRedistribution: input.allowRedistribution === true,
  };

  for (const key of [
    'version', 'copyrightInformation', 'contactInformation',
    'thirdPartyLicenses', 'otherLicenseUrl',
  ]) {
    if (typeof input[key] === 'string' && input[key].trim()) meta[key] = input[key].trim();
  }
  if (Array.isArray(input.references)) {
    const refs = input.references.map((x) => String(x).trim()).filter(Boolean);
    if (refs.length) meta.references = refs;
  }
  if (Number.isInteger(input.thumbnailImage) && input.thumbnailImage >= 0) {
    meta.thumbnailImage = input.thumbnailImage;
  }
  return meta;
}

function readGlb(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error('Three.js did not produce a valid GLB 2.0 file.');
  }
  const declaredLength = view.getUint32(8, true);
  if (declaredLength !== view.byteLength) throw new Error('GLB length header is inconsistent.');

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
      if (json) throw new Error('GLB contains more than one JSON chunk.');
      json = JSON.parse(new TextDecoder().decode(bytes).trim());
    } else {
      chunks.push({ type, bytes: new Uint8Array(bytes) });
    }
    offset = end;
  }
  if (!json || !Array.isArray(json.nodes)) throw new Error('GLB JSON chunk or nodes are missing.');
  return { json, chunks };
}

function writeGlb(json, chunks) {
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(JSON.stringify(json));
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
    view.setUint32(offset, chunk.bytes.length, true);
    view.setUint32(offset + 4, chunk.type, true);
    new Uint8Array(output, offset + 8, chunk.bytes.length).set(chunk.bytes);
    offset += 8 + chunk.bytes.length;
  }
  return output;
}

function resolveHumanoidNodes(scene, gltfJson, mapping) {
  if (!mapping || typeof mapping !== 'object') throw new Error('Humanoid mapping is required.');

  const objectNames = new Map();
  scene.traverse((object) => {
    if (!object.name) return;
    const list = objectNames.get(object.name) || [];
    list.push(object);
    objectNames.set(object.name, list);
  });

  const exportedIndices = new Map();
  gltfJson.nodes.forEach((node, index) => {
    if (!node.name) return;
    const list = exportedIndices.get(node.name) || [];
    list.push(index);
    exportedIndices.set(node.name, list);
  });

  const humanBones = {};
  for (const [boneName, object] of Object.entries(mapping)) {
    if (!object || typeof object.name !== 'string' || !object.name) continue;
    if ((objectNames.get(object.name) || []).length !== 1) {
      throw new Error('Humanoid object name is missing or duplicated: ' + object.name);
    }
    const indices = exportedIndices.get(object.name) || [];
    if (indices.length !== 1) {
      throw new Error('Humanoid node was not exported uniquely: ' + object.name);
    }
    humanBones[boneName] = { node: indices[0] };
  }

  const missing = REQUIRED_BONES.filter((name) => !humanBones[name]);
  if (missing.length) throw new Error('Missing required VRM 1.0 bones: ' + missing.join(', '));
  return { humanBones };
}

/**
 * @param {import('three').Object3D} scene A root Object3D containing the avatar.
 * @param {object} options
 * @param {Record<string, import('three').Object3D>} options.humanoid Maps VRM bone names to actual bone objects.
 * @param {object} options.meta VRM 1.0 metadata; name and at least one author required.
 * @returns {Promise<{blob: Blob, arrayBuffer: ArrayBuffer, report: object}>}
 */
export async function exportVrm10(scene, options = {}) {
  if (!scene || typeof scene.traverse !== 'function') {
    throw new TypeError('A Three.js avatar scene is required.');
  }
  const meta = makeMeta(options.meta || {});
  scene.updateMatrixWorld(true);

  const exporter = new GLTFExporter();
  const baseGlb = await exporter.parseAsync(scene, {
    binary: true,
    onlyVisible: false,
    trs: false,
    includeCustomExtensions: true,
    maxTextureSize: options.maxTextureSize || Infinity,
  });

  if (!(baseGlb instanceof ArrayBuffer)) throw new Error('GLTFExporter did not return binary GLB data.');
  const { json, chunks } = readGlb(baseGlb);
  const humanoid = resolveHumanoidNodes(scene, json, options.humanoid);

  json.extensions = json.extensions || {};
  json.extensions.VRMC_vrm = {
    specVersion: '1.0',
    meta,
    humanoid,
  };
  json.extensionsUsed = Array.isArray(json.extensionsUsed) ? json.extensionsUsed : [];
  if (!json.extensionsUsed.includes('VRMC_vrm')) json.extensionsUsed.push('VRMC_vrm');
  json.extensionsRequired = Array.isArray(json.extensionsRequired) ? json.extensionsRequired : [];
  if (!json.extensionsRequired.includes('VRMC_vrm')) json.extensionsRequired.push('VRMC_vrm');

  const arrayBuffer = writeGlb(json, chunks);
  const checked = await inspectVrm(arrayBuffer);
  if (checked.report.format !== 'VRM 1.0') {
    throw new Error('Three-vrm read-back validation did not identify VRM 1.0.');
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
      note: 'Core VRM 1.0 only: MToon, expressions and SpringBone are not serialized in this phase.',
    },
  };
}

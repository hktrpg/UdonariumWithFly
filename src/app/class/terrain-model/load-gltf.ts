import {
  MeshIR,
  aabbFromPositions,
  assertTriangleBudget,
  computeSmoothNormals,
  expandAabb,
  emptyAabb,
} from './mesh-ir';

/**
 * Load glTF / GLB via dynamic three.js import (import-time only).
 * Merges mesh geometries in world space into MeshIR; samples first baseColor map if present.
 */
export async function parseGltfPackage(files: File[]): Promise<MeshIR> {
  const glb = files.find(f => /\.glb$/i.test(f.name));
  const gltfJson = files.find(f => /\.gltf$/i.test(f.name));
  if (!glb && !gltfJson) throw new Error('MODEL_NO_GLTF');

  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

  const manager = new THREE.LoadingManager();
  const blobUrls: string[] = [];
  const byBase = new Map<string, File>();
  for (const f of files) {
    byBase.set(f.name.replace(/^.*[\\/]/, '').toLowerCase(), f);
    byBase.set(f.name.toLowerCase(), f);
  }
  manager.setURLModifier((url) => {
    const clean = url.split('?')[0].replace(/^(\.\/)/, '');
    const base = clean.replace(/^.*[\\/]/, '').toLowerCase();
    const file = byBase.get(base) || byBase.get(clean.toLowerCase());
    if (!file) return url;
    const u = URL.createObjectURL(file);
    blobUrls.push(u);
    return u;
  });

  const loader = new GLTFLoader(manager);
  let buffer: ArrayBuffer | string;

  try {
    if (glb) {
      buffer = await glb.arrayBuffer();
    } else {
      buffer = await gltfJson!.text();
    }

    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(
        buffer as any,
        '',
        (g) => resolve(g),
        (err) => reject(err || new Error('MODEL_INVALID_GLTF')),
      );
    });

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    let albedoImage: CanvasImageSource | undefined;
    let hadColor = false;
    const warnings: string[] = [];
    const aabb = emptyAabb();

    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((obj: any) => {
      if (!obj.isMesh || !obj.geometry) return;
      const geom = obj.geometry as any;
      const posAttr = geom.attributes?.position;
      if (!posAttr) return;
      const index = geom.index;
      const nAttr = geom.attributes?.normal;
      const uvAttr = geom.attributes?.uv;
      const colAttr = geom.attributes?.color;
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      if (!albedoImage && mat?.map?.image) {
        albedoImage = mat.map.image;
        hadColor = true;
      }
      if (mat?.color && !hadColor) {
        hadColor = true;
      }
      const color = mat?.color;
      const cr = color ? color.r : 0.75;
      const cg = color ? color.g : 0.75;
      const cb = color ? color.b : 0.75;

      const triCount = index ? index.count / 3 : posAttr.count / 3;
      const pushVert = (vi: number) => {
        const v = new THREE.Vector3().fromBufferAttribute(posAttr, vi).applyMatrix4(obj.matrixWorld);
        positions.push(v.x, v.y, v.z);
        expandAabb(aabb, v.x, v.y, v.z);
        if (nAttr) {
          const n = new THREE.Vector3().fromBufferAttribute(nAttr, vi)
            .transformDirection(obj.matrixWorld).normalize();
          normals.push(n.x, n.y, n.z);
        } else {
          normals.push(0, 0, 0);
        }
        if (uvAttr) {
          uvs.push(uvAttr.getX(vi), uvAttr.getY(vi));
        } else {
          uvs.push(0, 0);
        }
        if (colAttr) {
          colors.push(colAttr.getX(vi), colAttr.getY(vi), colAttr.getZ(vi));
          hadColor = true;
        } else {
          colors.push(cr, cg, cb);
        }
      };

      if (index) {
        for (let i = 0; i < index.count; i += 3) {
          pushVert(index.getX(i));
          pushVert(index.getX(i + 1));
          pushVert(index.getX(i + 2));
        }
      } else {
        for (let i = 0; i < posAttr.count; i += 3) {
          pushVert(i);
          pushVert(i + 1);
          pushVert(i + 2);
        }
      }
      void triCount;
    });

    // Dispose three resources.
    gltf.scene.traverse((obj: any) => {
      if (obj.geometry) obj.geometry.dispose?.();
      const mats = obj.material
        ? (Array.isArray(obj.material) ? obj.material : [obj.material])
        : [];
      for (const m of mats) {
        m.map?.dispose?.();
        m.dispose?.();
      }
    });

    const triangleCount = positions.length / 9;
    assertTriangleBudget(triangleCount);
    const pos = Float32Array.from(positions);
    let nrm = Float32Array.from(normals);
    if (!nrm.some(v => v !== 0)) nrm = computeSmoothNormals(pos);

    return {
      positions: pos,
      normals: nrm,
      uvs: Float32Array.from(uvs),
      vertexColors: Float32Array.from(colors),
      albedoImage,
      triangleCount,
      aabb: Number.isFinite(aabb.min[0]) ? aabb : aabbFromPositions(pos),
      sourceFormat: 'gltf',
      hadColor,
      warnings,
    };
  } finally {
    for (const u of blobUrls) URL.revokeObjectURL(u);
  }
}

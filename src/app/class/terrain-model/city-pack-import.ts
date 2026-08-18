import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { ImageTag } from '@udonarium/image-tag';
import { fitGameTableSizeToImage } from '@udonarium/game-table-fit';
import { TableSelecter } from '@udonarium/table-selecter';
import { Terrain } from '@udonarium/terrain';
import { PointerCoordinate } from 'service/pointer-device.service';

import {
  CITY_PACK_MAX_BUILDINGS,
  CITY_PACK_TABLE_MAX_GRIDS,
  buildingsHaveWorldSpread,
  buildingTableCenter,
  cityPackShouldInteract,
  cityPackTableLayout,
  dropHas3dTilesMarker,
  findCityPackBackgroundImage,
  findCityPackMapImage,
  groupCityPackBuildings,
  mergeAabbs,
} from './city-pack';
import { composeCityPackOrthoMap, composeCityPackSkyline, CityPackStamp } from './city-pack-compose';
import { MODEL_IMAGE_TAG } from './mesh-ir';
import {
  BakedModelBoxes,
  bakeModelBoxes,
  placeBakedModelBoxes,
} from './model-terrain-import';
import { isPrimaryModelFile } from './model-package-files';

export type ImportCityPackResult = {
  terrains: Terrain[];
  warnings: string[];
  stacked: boolean;
  trimmed: boolean;
  mapSet: boolean;
  backgroundSet: boolean;
};

function tagBake(imageIdentifier: string): void {
  try {
    let tag = ImageTag.get(imageIdentifier);
    if (!tag) tag = ImageTag.create(imageIdentifier);
    tag.addWords(MODEL_IMAGE_TAG);
  } catch {
    // Non-fatal.
  }
}

function isPhotogrammetrySkip(err: unknown, files: File[]): boolean {
  const code = err instanceof Error ? err.message : String(err || '');
  if (code === 'MODEL_TOO_MANY_TRIANGLES') return true;
  if (code !== 'MODEL_FILE_TOO_LARGE') return false;
  return files.some(f => isPrimaryModelFile(f) && /\.obj$/i.test(f.name || ''));
}

/**
 * Bake an Open3Dhk / multi-building drop into the current table:
 * shared scale, ortho map, optional skyline background, existing Terrain boxes.
 */
export async function importCityPackAsTerrain(
  files: File[],
  position: PointerCoordinate,
): Promise<ImportCityPackResult> {
  const viewTable = TableSelecter.instance.viewTable;
  if (!viewTable) throw new Error('MODEL_NO_TABLE');
  if (!files?.length) throw new Error('MODEL_EMPTY');

  const groups = groupCityPackBuildings(files);
  if (!groups.length) {
    if (dropHas3dTilesMarker(files)) throw new Error('CITY_PACK_3D_TILES');
    throw new Error('CITY_PACK_NO_BUILDING');
  }

  const trimmed = groups.length > CITY_PACK_MAX_BUILDINGS;
  const limited = trimmed ? groups.slice(0, CITY_PACK_MAX_BUILDINGS) : groups;
  const warnings: string[] = [];
  if (trimmed) warnings.push('CITY_PACK_TRIMMED');
  if (dropHas3dTilesMarker(files)) warnings.push('CITY_PACK_SKIPPED_TILES');

  const bakedBuildings: { name: string; baked: BakedModelBoxes }[] = [];
  let photoFails = 0;
  for (const group of limited) {
    try {
      bakedBuildings.push({
        name: group.name,
        baked: await bakeModelBoxes(group.files),
      });
    } catch (err) {
      if (isPhotogrammetrySkip(err, group.files)) {
        photoFails += 1;
        continue;
      }
      throw err;
    }
  }

  if (!bakedBuildings.length) {
    if (photoFails > 0) throw new Error('CITY_PACK_PHOTOGRAMMETRY');
    throw new Error('CITY_PACK_NO_BUILDING');
  }

  const union = mergeAabbs(bakedBuildings.map(b => b.baked.fullAabb));
  const stacked = !buildingsHaveWorldSpread(bakedBuildings.map(b => b.baked.fullAabb));
  if (stacked && bakedBuildings.length > 1) warnings.push('CITY_PACK_STACKED');

  const stamps: CityPackStamp[] = [];
  for (const b of bakedBuildings) {
    for (const box of b.baked.boxes) stamps.push({ aabb: box.aabb, blobs: box.blobs });
  }

  const mapFile = findCityPackMapImage(files);
  let mapSet = false;
  if (mapFile) {
    const image = await ImageStorage.instance.addAsync(mapFile);
    tagBake(image.identifier);
    viewTable.imageIdentifier = image.identifier;
    await fitGameTableSizeToImage(viewTable, image, { max: CITY_PACK_TABLE_MAX_GRIDS });
    mapSet = true;
  } else {
    const blob = await composeCityPackOrthoMap(stamps, union);
    const image = await ImageStorage.instance.addAsync(
      new File([blob], 'city-pack-map.png', { type: 'image/png' }),
    );
    tagBake(image.identifier);
    viewTable.imageIdentifier = image.identifier;
    await fitGameTableSizeToImage(viewTable, image, { max: CITY_PACK_TABLE_MAX_GRIDS });
    mapSet = true;
  }

  const layout = cityPackTableLayout(union, viewTable.width, viewTable.height);
  const terrains: Terrain[] = [];
  let stackedCursor = position.x;

  for (const building of bakedBuildings) {
    const sx = Math.max(1e-9, building.baked.fullAabb.max[0] - building.baked.fullAabb.min[0]);
    const sz = Math.max(1e-9, building.baked.fullAabb.max[2] - building.baked.fullAabb.min[2]);
    const layoutWidth = sx * layout.gridPerWorld;
    const layoutDepth = sz * layout.gridPerWorld;
    let center = buildingTableCenter(building.baked.fullAabb, union, layout);
    if (stacked && bakedBuildings.length > 1) {
      center = {
        x: stackedCursor + (layoutWidth * 50) / 2,
        y: position.y,
      };
      stackedCursor += layoutWidth * 50 + 25;
    }
    const placed = await placeBakedModelBoxes(building.baked, {
      x: center.x,
      y: center.y,
      z: position.z,
    }, {
      name: building.name,
      gridPerWorld: layout.gridPerWorld,
      layoutAabb: building.baked.fullAabb,
      layoutWidth,
      layoutDepth,
      assemble: true,
    });
    for (const terrain of placed) {
      const interact = cityPackShouldInteract(terrain.width, terrain.depth, terrain.height);
      if (terrain.isInteract !== interact) {
        terrain.mutateAppearance(() => { terrain.isInteract = interact; });
      }
    }
    terrains.push(...placed);
  }

  let backgroundSet = false;
  const bgFile = findCityPackBackgroundImage(files);
  if (bgFile) {
    const image = await ImageStorage.instance.addAsync(bgFile);
    tagBake(image.identifier);
    viewTable.backgroundImageIdentifier = image.identifier;
    backgroundSet = true;
  } else {
    const sky = await composeCityPackSkyline(stamps, union);
    if (sky) {
      const image = await ImageStorage.instance.addAsync(
        new File([sky], 'city-pack-background.png', { type: 'image/png' }),
      );
      tagBake(image.identifier);
      viewTable.backgroundImageIdentifier = image.identifier;
      backgroundSet = true;
    }
  }

  return { terrains, warnings, stacked, trimmed, mapSet, backgroundSet };
}

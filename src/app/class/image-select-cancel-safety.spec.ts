import { ImageFile } from './core/file-storage/image-file';
import {
  makeMask,
  makeTerrain,
  makeTextNote,
  resetTabletopStore,
} from '../../testing/tabletop-test.util';

/**
 * FileSelecter cancel resolves `false` (ModalService / FileSelecterComponent.cancel).
 * Empty image selection resolves the string ImageFile.Empty.identifier ('null').
 * Handlers must use truthy checks (`!value`), not `value == null`, or cancel wipes images.
 */
describe('image select cancel safety', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('Empty identifier is a truthy string (allowed clear), cancel false is not', () => {
    expect(ImageFile.Empty.identifier).toBe('null');
    expect(!!ImageFile.Empty.identifier).toBeTrue();
    expect(!!false).toBeFalse();
  });

  it('mask/note/terrain setters ignore non-string cancel values and keep prior image', () => {
    const mask = makeMask('m-img');
    mask.setImage('keep_mask');
    mask.setImage(false as unknown as string);
    const maskEl = mask.imageDataElement?.getFirstElementByName('imageIdentifier');
    expect(maskEl?.value).toBe('keep_mask');

    const note = makeTextNote('n-img');
    note.setFrontImage('keep_front');
    note.setBackImage('keep_back');
    note.setFrontImage(false as unknown as string);
    note.setBackImage(false as unknown as string);
    const frontEl = note.imageDataElement?.getFirstElementByName('front')
      || note.imageDataElement?.getFirstElementByName('imageIdentifier');
    const backEl = note.imageDataElement?.getFirstElementByName('back');
    expect(frontEl?.value).toBe('keep_front');
    expect(backEl?.value).toBe('keep_back');

    const terrain = makeTerrain('t-img');
    terrain.setFaceImage('floor', 'keep_floor');
    terrain.setFaceImage('floor', false as unknown as string);
    const floorEl = terrain.imageDataElement?.getFirstElementByName('floor');
    expect(floorEl?.value).toBe('keep_floor');
  });

  it('Empty selection string null still clears images when intended', () => {
    const mask = makeMask('m-empty');
    mask.setImage('was_set');
    mask.setImage(ImageFile.Empty.identifier);
    const maskEl = mask.imageDataElement?.getFirstElementByName('imageIdentifier');
    expect(maskEl?.value).toBe('null');

    const note = makeTextNote('n-empty');
    note.setFrontImage('was_set');
    note.setFrontImage(ImageFile.Empty.identifier);
    const frontEl = note.imageDataElement?.getFirstElementByName('front')
      || note.imageDataElement?.getFirstElementByName('imageIdentifier');
    expect(frontEl?.value).toBe('null');
  });
});

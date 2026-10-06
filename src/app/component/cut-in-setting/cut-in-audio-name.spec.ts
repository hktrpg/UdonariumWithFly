import { AudioLibrary } from '@udonarium/audio-library';
import { CutIn } from '@udonarium/cut-in';
import { CutInList } from '@udonarium/cut-in-list';
import { AudioFile } from '@udonarium/core/file-storage/audio-file';
import { AudioStorage } from '@udonarium/core/file-storage/audio-storage';
import { CutInSettingComponent } from './cut-in-setting.component';

describe('CutIn audio labels', () => {
  const id = 'a5'.repeat(32);
  let previousLibraryJson: string;

  beforeEach(() => {
    previousLibraryJson = AudioLibrary.instance.dataJson;
    const data = AudioLibrary.instance.data;
    delete data.names[id];
    AudioLibrary.instance.data = data;
  });

  afterEach(() => {
    AudioLibrary.instance.dataJson = previousLibraryJson;
  });

  it('uses a saved CutIn filename when the packed audio has only a hash label', () => {
    const cutIn = { audioIdentifier: id, audioFileName: 'door-open.wav' } as CutIn;
    spyOnProperty(CutInList.instance, 'cutIns', 'get').and.returnValue([cutIn]);
    const component = Object.create(CutInSettingComponent.prototype) as CutInSettingComponent;
    const audio = AudioFile.create({ identifier: id, name: id, type: 'audio/wav', blob: null, url: '' });

    expect(component.audioDisplayName(audio)).toBe('door-open.wav');
  });

  it('keeps a saved filename if the linked audio has not arrived yet', () => {
    const cutIn = { audioIdentifier: id, audioFileName: 'door-open.wav' } as CutIn;
    const component = Object.create(CutInSettingComponent.prototype) as CutInSettingComponent;
    component.selectedCutIn = cutIn;

    component.onAudioFileChange();

    expect(cutIn.audioFileName).toBe('door-open.wav');
  });

  it('flags a missing linked audio even when the saved filename is blank', () => {
    const cutIn = Object.setPrototypeOf({ audioIdentifier: id, audioFileName: '' }, CutIn.prototype) as CutIn;
    spyOn(AudioStorage.instance, 'get').and.returnValue(null);
    const component = Object.create(CutInSettingComponent.prototype) as CutInSettingComponent;
    component.selectedCutIn = cutIn;

    expect(cutIn.isValidAudio).toBeFalse();
    expect(component.missingLinkedAudio).toBeTrue();

    cutIn.audioIdentifier = '';
    expect(cutIn.isValidAudio).toBeTrue();
    expect(component.missingLinkedAudio).toBeFalse();
  });
});

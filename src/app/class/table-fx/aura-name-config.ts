import { SyncObject, SyncVar } from '../core/synchronize-object/decorator';
import { GameObject } from '../core/synchronize-object/game-object';
import { InnerXml } from '../core/synchronize-object/object-serializer';
import { translate } from 'i18n';

export const DEFAULT_AURA_NAMES = ['黑色', '藍色', '綠色', '青色', '紅色', '洋紅', '黃色', '白色'];

@SyncObject('aura-name-config')
export class AuraNameConfig extends GameObject implements InnerXml {
  @SyncVar() namesJson: string = JSON.stringify(DEFAULT_AURA_NAMES);

  private static _instance: AuraNameConfig;

  static get instance(): AuraNameConfig {
    if (!AuraNameConfig._instance) {
      AuraNameConfig._instance = new AuraNameConfig('AuraNameConfig');
      AuraNameConfig._instance.initialize();
    }
    return AuraNameConfig._instance;
  }

  get names(): string[] {
    try {
      const arr = JSON.parse(this.namesJson || '[]');
      if (!Array.isArray(arr) || arr.length !== 8) return DEFAULT_AURA_NAMES.slice();
      return arr.map((n, i) => (typeof n === 'string' && n.trim() ? n : DEFAULT_AURA_NAMES[i]));
    } catch {
      return DEFAULT_AURA_NAMES.slice();
    }
  }

  set names(value: string[]) {
    const next = DEFAULT_AURA_NAMES.map((fallback, i) => {
      const v = value && value[i];
      return typeof v === 'string' && v.trim() ? v.trim() : fallback;
    });
    this.namesJson = JSON.stringify(next);
  }

  nameOf(index: number): string {
    if (index < 0 || index > 7) return translate('fx.none');
    return this.names[index] || DEFAULT_AURA_NAMES[index];
  }

  setName(index: number, name: string) {
    if (index < 0 || index > 7) return;
    const names = this.names;
    names[index] = name?.trim() || DEFAULT_AURA_NAMES[index];
    this.names = names;
  }

  innerXml(): string { return ''; }

  parseInnerXml(element: Element) {
    const context = AuraNameConfig.instance.toContext();
    context.syncData = this.toContext().syncData;
    AuraNameConfig.instance.apply(context);
    AuraNameConfig.instance.update();
    this.destroy();
  }
}

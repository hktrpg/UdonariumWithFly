import { SyncObject } from './core/synchronize-object/decorator';
import { ObjectNode } from './core/synchronize-object/object-node';
import { InnerXml } from './core/synchronize-object/object-serializer';
import { ScenarioText } from './scenario-text';
import { translate } from 'i18n';

@SyncObject('scenario-text-list')
export class ScenarioTextList extends ObjectNode implements InnerXml {
  private static _instance: ScenarioTextList;
  static get instance(): ScenarioTextList {
    if (!ScenarioTextList._instance) {
      ScenarioTextList._instance = new ScenarioTextList('ScenarioTextList');
      ScenarioTextList._instance.initialize();
    }
    return ScenarioTextList._instance;
  }

  get items(): ScenarioText[] { return this.children as ScenarioText[]; }

  addItem(item: ScenarioText): ScenarioText
  addItem(title?: string): ScenarioText
  addItem(...args: any[]): ScenarioText {
    let item: ScenarioText = null;
    if (args[0] instanceof ScenarioText) {
      item = args[0];
    } else {
      item = ScenarioText.create(typeof args[0] === 'string' ? args[0] : translate('scenarioText.defaultTitle'));
    }
    return this.appendChild(item);
  }

  matchSuggestions(query: string, limit = 8): ScenarioText[] {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    const out: ScenarioText[] = [];
    for (const item of this.items) {
      const title = (item.title || '').toLowerCase();
      const body = (item.body || '').toLowerCase();
      if (title.startsWith(q) || title.includes(q) || body.startsWith(q)) {
        out.push(item);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  parseInnerXml(element: Element) {
    for (let child of ScenarioTextList.instance.children) {
      child.destroy();
    }
    let context = ScenarioTextList.instance.toContext();
    context.syncData = this.toContext().syncData;
    ScenarioTextList.instance.apply(context);
    ScenarioTextList.instance.update();
    super.parseInnerXml.apply(ScenarioTextList.instance, [element]);
    this.destroy();
  }
}

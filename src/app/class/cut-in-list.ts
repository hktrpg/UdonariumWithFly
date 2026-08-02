import { SyncObject } from './core/synchronize-object/decorator';
import { ObjectNode } from './core/synchronize-object/object-node';
import { InnerXml } from './core/synchronize-object/object-serializer';
import { StringUtil } from './core/system/util/string-util';
import { CutIn } from './cut-in';

export interface CutInInfo {
  names: string[],
  identifiers: string[],
  matchMostLongText: string
}

@SyncObject('cut-in-list')
export class CutInList extends ObjectNode implements InnerXml {
  private static _instance: CutInList;
  static get instance(): CutInList {
    if (!CutInList._instance) {
        CutInList._instance = new CutInList('CutInList');
        CutInList._instance.initialize();
    }
    return CutInList._instance;
  }
  
  get cutIns(): CutIn[] { return this.children as CutIn[]; }

  addCutIn(cutIn: CutIn)
  addCutIn(name: string, identifier?: string)
  addCutIn(...args: any[]) {
    let cutIn: CutIn = null;
    if (args[0] instanceof CutIn) {
      cutIn = args[0];
    } else {
      let name: string = args[0];
      let identifier: string = args[1];
      cutIn = new CutIn(identifier);
      cutIn.name = name;
      cutIn.initialize();
    }
    return this.appendChild(cutIn);
  }

  parseInnerXml(element: Element) {
    // 不允許從 XML 新建，改為更新既有物件
    for (let child of CutInList.instance.children) {
      child.destroy();
    }
    
    let context = CutInList.instance.toContext();
    context.syncData = this.toContext().syncData;
    CutInList.instance.apply(context);
    CutInList.instance.update();
    
    super.parseInnerXml.apply(CutInList.instance, [element]);
    this.destroy();
  }

  // 從符合條件者中：回傳所有標籤為空者，以及相同標籤各隨機取 1 個
  matchCutInInfo(text: string): CutInInfo {
    //text = StringUtil.toHalfWidth(text).toUpperCase().trimRight();
    let textTagMatch = '';
    let tagMatch = new Map<string, CutIn>();
    const matchCutIn: CutIn[] = [];

    let videoFound = false;
    // 先隨機排序
    for (const cutIn of this.cutIns.map<[number, CutIn]>(cutIn => [Math.random(), cutIn]).sort((a, b) => { return a[0] - b[0]; }).map(pair => pair[1])) {
      if (!cutIn) continue;
      let isMatch = false;
      for (const postfix of cutIn.postfixes) {
        if (StringUtil.toHalfWidth(text.replaceAll('＞', '→')).toUpperCase().trimRight().endsWith(StringUtil.toHalfWidth(postfix.replaceAll('＞', '→')).toUpperCase().trimRight())) {
          isMatch = true;
          if ((postfix.slice(0, 1) == '@' || postfix.slice(0, 1) == '＠') && textTagMatch.length < postfix.length) textTagMatch = postfix;
        }
      }
      if (isMatch) {
        const tag = cutIn.tag;
        if (tag != null && tag.trim().length > 0) {
          tagMatch.set(StringUtil.toHalfWidth(tag).toUpperCase().trim(), cutIn);
        } else {
          matchCutIn.push(cutIn);
        }
      }
    }
    matchCutIn.push(...tagMatch.values());
    // 影片只保留一個，並優先保留有標籤者
    /*
    matchCutIn.reverse();
    let foundVideo = false;
    for (let i = 0; i < matchCutIn.length; i++) {
      if (matchCutIn[i] && !!matchCutIn[i].videoId) {
        if (!foundVideo) {
          foundVideo = true;
        } else {
          matchCutIn.splice(i, 1);
        }
      }
    }
    */
    // 再次洗牌，使出現順序隨機
    const matchCutIns = matchCutIn.map<[number, CutIn]>(cutIn => [Math.random(), cutIn]).sort((a, b) => { return a[0] - b[0]; });
    return {
      names: matchCutIns.map(pair => pair[1].name),
      identifiers: matchCutIns.map(pair => pair[1].identifier),
      matchMostLongText: textTagMatch
    };
  }
}

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';

/** Strip repeat/choice prefixes, then take 「…」 or trailing emote for floating dialogue. */
export function extractChatDialogText(text: string): string | null {
  if (!text) return null;
  const regArray = /^(([sＳｓ][rＲｒ][eＥｅ][pＰｐ][eＥｅ][aＡａ][tＴｔ]|[rＲｒ][eＥｅ][pＰｐ][eＥｅ][aＡａ][tＴｔ]|[sＳｓ][rＲｒ][eＥｅ][pＰｐ]|[rＲｒ][eＥｅ][pＰｐ]|[sＳｓ][xＸｘ]|[xＸｘ])?([\d０-９]+)?[ 　]+)?([\s\S]*)?/igm.exec(text);
  let dialogText = (regArray?.[4] != null) ? regArray[4].trim() : text.trim();
  let choiceMatch: RegExpExecArray | null;
  if (/^([sＳｓ]?[cＣｃ][hＨｈ][oＯｏ][iＩｉ][cＣｃ][eＥｅ][\d０-９]*)[ 　]+([^ 　]*)/ig.test(dialogText)) {
    dialogText = '';
  } else if ((choiceMatch = /^([sＳｓ]?[cＣｃ][hＨｈ][oＯｏ][iＩｉ][cＣｃ][eＥｅ][\d０-９]*[\[［][^\]］]+[\]］])/ig.exec(dialogText))
    || (choiceMatch = /^([sＳｓ]?[cＣｃ][hＨｈ][oＯｏ][iＩｉ][cＣｃ][eＥｅ][\d０-９]*[\(（][^\)）]+[\)）])/ig.exec(dialogText))) {
    dialogText = dialogText.slice(choiceMatch[1].length);
  }

  const dialogRegExp = /「+([\s\S]+?)」/gm;
  const match = dialogRegExp.exec(dialogText);
  if (match) return match[1];

  const emoteTest = dialogText.split(/[\s　]/).slice(-1)[0];
  if (StringUtil.isEmote(emoteTest)) return emoteTest;
  return null;
}

export interface ChatBalloonOptions {
  color?: string;
  faceIconIdentifier?: string;
  /** PeerCursor identifier when whispering — balloon only to sender + target. */
  sendTo?: string;
}

/** Show floating dialogue / stand balloon for a character line (local + peers). */
export function popupCharacterChatBalloon(
  character: GameCharacter,
  text: string,
  options: ChatBalloonOptions = {}
): boolean {
  if (!character || !StringUtil.cr(text).trim()) return false;
  const dialogText = extractChatDialogText(text);
  if (!dialogText) {
    if (character.text || character.chatDialogStamp) {
      character.clearChatDialog();
      EventSystem.call('FAREWELL_CHAT_BALLOON', { characterIdentifier: character.identifier });
    }
    return false;
  }

  const stamp = Date.now();
  const dialogObj = {
    characterIdentifier: character.identifier,
    text: dialogText,
    faceIconIdentifier: options.faceIconIdentifier || null,
    color: options.color || '',
    secret: !!options.sendTo,
    stamp,
  };

  if (dialogObj.secret) {
    const targetPeer = ObjectStore.instance.get<PeerCursor>(options.sendTo);
    if (targetPeer) {
      if (targetPeer.peerId != PeerCursor.myCursor.peerId) {
        EventSystem.call('POPUP_CHAT_BALLOON', dialogObj, targetPeer.peerId);
      }
      EventSystem.call('POPUP_CHAT_BALLOON', dialogObj, PeerCursor.myCursor.peerId);
    }
  } else {
    character.openChatDialog({
      text: dialogObj.text,
      color: dialogObj.color,
      faceIconIdentifier: dialogObj.faceIconIdentifier || '',
      isEmote: StringUtil.isEmote(dialogObj.text),
      stamp,
    });
    EventSystem.call('POPUP_CHAT_BALLOON', dialogObj);
  }
  return true;
}

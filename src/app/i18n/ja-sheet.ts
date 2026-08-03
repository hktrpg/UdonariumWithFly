import { I18nDictionary } from './types';
import { zhTW_sheet } from './zh-TW-sheet';

export const ja_sheet: I18nDictionary = {
  ...zhTW_sheet,
  'sheet.toggleEdit': '編集切替', 'sheet.changeFrontImage': '表面画像を変更', 'sheet.changeBackImage': '裏面画像を変更', 'sheet.changeAllBackImages': 'すべてのカード裏面画像を変更', 'sheet.changeFloorImage': '床画像を変更', 'sheet.changeWallImage': '壁画像を変更', 'sheet.changeDiceImage': 'ダイス目画像を変更', 'sheet.imageReplaceDelete': '画像を置換/削除', 'sheet.imageSet': '画像を設定', 'sheet.faceIconAdd': '顔アイコンを追加', 'sheet.faceIconSet': '顔アイコンを設定', 'sheet.changeImage': '画像を変更', 'sheet.createCopy': '複製を作成', 'sheet.download': 'ダウンロード', 'sheet.location.table': 'テーブル', 'sheet.location.common': '共有保管庫', 'sheet.location.personal': '個人保管庫', 'sheet.location.graveyard': 'ごみ箱', 'sheet.changeShadow': '画像の影を変更', 'sheet.deleteFaceIcon': '顔アイコンを削除', 'sheet.showChatPalette': 'チャットパレットを表示', 'sheet.standSettings': '立ち絵設定', 'sheet.addItem': '項目を追加', 'sheet.data.title': 'タイトル', 'sheet.data.tag': 'タグ', 'sheet.cardBack': 'カード（裏面）', 'sheet.title.terrain': '地形設定 - {{name}}', 'sheet.title.card': 'カード設定 - {{name}}', 'sheet.title.cardStack': '山札設定 - {{name}}', 'sheet.title.tableMask': 'マップマスク設定 - {{name}}', 'sheet.title.textNote': '共有メモ設定 - {{name}}', 'sheet.title.diceSymbol': 'ダイスシンボル設定 - {{name}}', 'sheet.title.character': 'キャラクターシート - {{name}}', 'sheet.title.range': '射程／範囲設定 - {{name}}', 'sheet.logOpened': '{{title}} を開きました', 'sheet.data.type.normal': '通常', 'sheet.data.type.number': '数値', 'sheet.data.type.resource': 'リソース', 'sheet.data.type.ability': '能力値', 'sheet.data.type.check': 'チェック', 'sheet.data.type.note': 'メモ', 'sheet.data.type.url': '参照URL', 'sheet.data.heightImage': '0=画像に合わせる', 'sheet.data.none': 'なし',
  'palette.unnamedTab': '（無題タブ）', 'palette.editing': 'チャットパレット編集中', 'palette.placeholder': 'チャットパレット', 'palette.edit': 'チャットパレットを編集', 'palette.confirm': 'チャットパレットを確定', 'palette.title': '{{name}} のチャットパレット', 'palette.helpTitle': 'チャット記法とチャットパレットの使い方',
  'palette.help': `　パラメータ操作指令とダイスボット指令は全角半角、英字の大文字小文字を区別しません。併用する場合は空白で区切り、パラメータ操作、ダイスボット指令、チャット本文の順に記述します。

　チャット内容はチャットパレットにあらかじめ用意できます。1行に1件を書き、クリックで入力欄へ、ダブルクリックで送信します。

・パラメータ操作指令
　キャラクターで送信する際、先頭に :、パラメータ名、操作（+、-、=）、内容を書けばパラメータを操作できます。: で複数操作を区切れます。操作指令はチャットには表示されません。

・ダイスボット指令
　ダイスボット指令を送信するとダイスロールや表の参照ができます。利用可能な指令は各ゲームシステムの説明を参照してください。

・パラメータ参照
　パラメータ名を { と } で囲むと、その内容に置き換わります。名前の先頭に $ を付けると、操作後の値を参照できます。

・改行・空白
　\\n で改行、\\s で半角空白、\\ｓ で全角空白を入力できます。

・💭
　キャラクターで送信する際、「 と 」で囲んだ内容は💭で表示されます。`,
  'stand.sortNameList': 'チャット入力時に名前を並べ替える', 'stand.heightGlobal': 'Height (0=元画像を維持): ', 'stand.keepOriginalImage': '元画像を維持', 'stand.noOverview': '一覧で立ち絵を使用しない', 'stand.add': '立ち絵設定を追加', 'stand.restore': '削除した立ち絵設定を復元', 'stand.title': '{{name}} の立ち絵設定', 'stand.deleteTitle': '立ち絵設定を削除', 'stand.deleteText': '立ち絵設定を削除しますか？', 'stand.helpTitle': '立ち絵設定の説明', 'stand.changeImage': '画像を変更', 'stand.condition': '条件: ', 'stand.condition.default': 'デフォルト', 'stand.condition.image': '指定画像', 'stand.condition.postfix': 'チャット末尾', 'stand.condition.postfixOrImage': 'チャット末尾 または 指定画像', 'stand.condition.postfixAndImage': 'チャット末尾 かつ 指定画像', 'stand.condition.selectedOnly': '選択時のみ', 'stand.showName': '名前タグ', 'stand.applyImageEffect': '画像効果を反映', 'stand.applyRoll': '回転を反映', 'stand.speakingImage': '口パク同期画像（APNG等）', 'stand.test': 'テスト（自分だけに表示）', 'stand.positionSpecialize': 'Pos 個別指定: ', 'stand.heightIndividual': 'Height (0=未指定): ', 'stand.unspecified': '未指定', 'stand.postfixPlaceholder': '1行に1つ。先頭の @ は一致時に本文から削除されます\r\n@怒り\r\n@必殺技', 'stand.noCharacterImages': 'キャラクター画像・顔アイコンが未設定です', 'stand.testMessage': 'これは自分だけに見えるテストです。立ち絵を調整するときは、個人設定で「立ち絵をフェードアウトして自動退場」をオフにすると微調整しやすくなります。',
  'stand.help': `　キャラクター立ち絵の名前、位置、画像高さと、チャット送信時に表示する条件を設定できます。

　立ち絵設定名はチャットウィンドウとチャットパレットの一覧に表示され、選択できます。位置と高さは個別指定も可能です。個別位置を指定せず、高さが 0 の場合は全体設定を使います。

　「指定画像」はチャット送信時のキャラクター画像または顔アイコンです。チャット末尾が「@farewell」の場合は必ず立ち絵を退場させます。

　優先順位は、高い順に @farewell、チャット画面またはパレットで選択した名前、指定画像かつチャット末尾、指定画像またはチャット末尾、チャット末尾、指定画像です。該当しない場合は「デフォルト」を使い、同順位の候補はランダムに選ばれます。`,
};

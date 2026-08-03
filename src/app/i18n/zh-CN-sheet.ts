import { I18nDictionary } from './types';
import { zhTW_sheet } from './zh-TW-sheet';

export const zhCN_sheet: I18nDictionary = {
  ...zhTW_sheet,
  'sheet.toggleEdit': '切换编辑', 'sheet.changeFrontImage': '更改正面图片', 'sheet.changeBackImage': '更改背面图片', 'sheet.changeAllBackImages': '更改全部卡片的背面图片', 'sheet.changeFloorImage': '更改地板图片', 'sheet.changeWallImage': '更改墙壁图片', 'sheet.changeDiceImage': '更改骰子点数图片', 'sheet.imageReplaceDelete': '替换/删除图片', 'sheet.imageSet': '设置图片', 'sheet.faceIconAdd': '新增头像 icon', 'sheet.faceIconSet': '设置头像 icon', 'sheet.changeImage': '更改图片', 'sheet.createCopy': '建立副本', 'sheet.download': '下载', 'sheet.location.table': '桌面', 'sheet.location.common': '公用仓库', 'sheet.location.personal': '个人仓库', 'sheet.location.graveyard': '回收区', 'sheet.changeShadow': '更改图片阴影', 'sheet.deleteFaceIcon': '删除头像', 'sheet.showChatPalette': '显示聊天面板', 'sheet.standSettings': '立绘设置', 'sheet.addItem': '新增项目', 'sheet.data.title': '标题', 'sheet.data.tag': '标签', 'sheet.cardBack': '卡片（背面）', 'sheet.title.terrain': '地形设置 - {{name}}', 'sheet.title.card': '卡片设置 - {{name}}', 'sheet.title.cardStack': '牌堆设置 - {{name}}', 'sheet.title.tableMask': '地图遮罩设置 - {{name}}', 'sheet.title.textNote': '共用笔记设置 - {{name}}', 'sheet.title.diceSymbol': '骰子符号设置 - {{name}}', 'sheet.title.character': '角色卡 - {{name}}', 'sheet.title.range': '射程／范围设置 - {{name}}', 'sheet.logOpened': '{{title}} 已开启', 'sheet.data.type.normal': '一般', 'sheet.data.type.number': '数值', 'sheet.data.type.resource': '资源', 'sheet.data.type.ability': '能力值', 'sheet.data.type.check': '勾选', 'sheet.data.type.note': '笔记', 'sheet.data.type.url': '参考网址', 'sheet.data.heightImage': '0=依图片', 'sheet.data.none': '无',
  'palette.unnamedTab': '(未命名标签)', 'palette.editing': '正在编辑聊天面板', 'palette.placeholder': '聊天面板', 'palette.edit': '编辑聊天面板', 'palette.confirm': '确认聊天面板', 'palette.title': '{{name}} 的聊天面板', 'palette.helpTitle': '聊天记法与聊天面板的使用方法',
  'palette.help': `　参数操作指令、骰子机器人指令不区分全角与半角；指令与参数名称也不区分英文字母大小写。需要并用时，请用空格分隔，依次写参数操作指令、骰子机器人指令、聊天讯息。

　可将聊天内容预先准备在聊天面板。每行一则内容：单击放入聊天栏，双击发送。

・参数操作指令
　以角色发送聊天时，在开头依序写 :、参数名、操作（增加 +、减少 -、代入 =）与操作内容，即可操作角色参数。可用 : 分隔多个操作；参数操作指令不会显示在聊天中。

・骰子机器人指令
　从聊天发送骰子机器人指令即可掷骰或查表。实际指令请参考各游戏系统的骰子机器人说明。

・参数参照
　以 { 与 } 包住参数名时，选择或发送聊天时会替换为参数内容。参数名前加 $ 可参照套用前述操作后的值。

・换行、空格
　写入 \\n 会在该处换行；写入 \\s 为半角空格，\\ｓ 为全角空格。

・💭
　以角色发送聊天时，「 与 」包住的内容会以💭显示。`,
  'stand.sortNameList': '聊天输入时排序名称', 'stand.heightGlobal': 'Height (0=保持原图片): ', 'stand.keepOriginalImage': '保持原图片', 'stand.noOverview': '总览不使用立绘图片', 'stand.add': '新增立绘设置', 'stand.restore': '还原刚删除的立绘设置', 'stand.title': '{{name}} 的立绘设置', 'stand.deleteTitle': '删除立绘设置', 'stand.deleteText': '要删除立绘设置吗？', 'stand.helpTitle': '立绘设置说明', 'stand.changeImage': '更改图片', 'stand.condition': '条件: ', 'stand.condition.default': '默认', 'stand.condition.image': '指定图片', 'stand.condition.postfix': '聊天末尾', 'stand.condition.postfixOrImage': '聊天末尾 或 指定图片', 'stand.condition.postfixAndImage': '聊天末尾 且 指定图片', 'stand.condition.selectedOnly': '仅在选择时', 'stand.showName': '名称标签', 'stand.applyImageEffect': '反映图片效果', 'stand.applyRoll': '反映旋转', 'stand.speakingImage': '口型同步图片（APNG 等）', 'stand.test': '测试（仅自己可见）', 'stand.positionSpecialize': 'Pos 个别指定: ', 'stand.heightIndividual': 'Height (0=未指定): ', 'stand.unspecified': '未指定', 'stand.postfixPlaceholder': '每行一个，开头加上 @ 时会在符合时从文字中截掉\r\n@愤怒\r\n@必杀技', 'stand.noCharacterImages': '尚未设置角色图片、头像 IC', 'stand.testMessage': '这是测试，只有你看得到。调整立绘设置时，可从菜单的“个人设置”关闭“立绘淡出并自动退场”，会更容易微调。',
  'stand.help': `　可设置角色立绘的名称、位置与图片高度，以及发送聊天时显示立绘的条件。

　立绘设置名称会显示在聊天窗口与聊天面板清单中并可选择。位置与高度也可单独指定；未勾选个别位置且高度为 0 时使用整体设置。

　“指定图片”是发送聊天时的角色图片或头像 IC。聊天文字末尾为“@farewell”时会让该角色的立绘退场。

　优先顺序由高到低为：@farewell、聊天窗口或面板选择的名称、指定图片且聊天末尾、指定图片或聊天末尾、聊天末尾、指定图片。都不符合时使用“默认”；同优先顺序的多个条件会随机选择。`,
};

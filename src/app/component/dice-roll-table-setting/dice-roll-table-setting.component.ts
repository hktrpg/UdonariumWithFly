import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ObjectSerializer } from '@udonarium/core/synchronize-object/object-serializer';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { DiceRollTable } from '@udonarium/dice-roll-table';
import { DiceRollTableList } from '@udonarium/dice-roll-table-list';
import { TextViewComponent } from 'component/text-view/text-view.component';
import { ModalService } from 'service/modal.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { SaveDataService } from 'service/save-data.service';

@Component({
    selector: 'dice-roll-table-setting',
    templateUrl: './dice-roll-table-setting.component.html',
    styleUrls: ['./dice-roll-table-setting.component.css'],
    standalone: false
})
export class DiceRollTableSettingComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('diceRollTableSelecter') diceRollTableSelecter: ElementRef<HTMLSelectElement>;

  selectedDiceRollTable: DiceRollTable = null;
  selectedDiceRollTableXml: string = '';

  get diceRollTableName(): string { return this.selectedDiceRollTable.name; }
  set diceRollTableName(name: string) { if (this.isEditable) this.selectedDiceRollTable.name = name; }

  get diceRollTableDice(): string { return this.selectedDiceRollTable.dice; }
  set diceRollTableDice(dice: string) { if (this.isEditable) this.selectedDiceRollTable.dice = dice; }

  get diceRollTableCommand(): string { return this.selectedDiceRollTable.command; }
  set diceRollTableCommand(command: string) { if (this.isEditable) this.selectedDiceRollTable.command = command; }

  get diceRollTableText(): string { return <string>this.selectedDiceRollTable.value; }
  set diceRollTableText(text: string) { if (this.isEditable) this.selectedDiceRollTable.value = text; }

  get diceRollTables(): DiceRollTable[] { return DiceRollTableList.instance.children as DiceRollTable[]; }
  get isEmpty(): boolean { return this.diceRollTables.length < 1 }
  get isDeleted(): boolean { return this.selectedDiceRollTable ? ObjectStore.instance.get(this.selectedDiceRollTable.identifier) == null : false; }
  get isEditable(): boolean { return !this.isEmpty && !this.isDeleted; }

  isSaveing: boolean = false;
  progresPercent: number = 0;

  constructor(
    private pointerDeviceService: PointerDeviceService,
    private modalService: ModalService,
    private panelService: PanelService,
    private saveDataService: SaveDataService
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }


  ngOnInit() {
    Promise.resolve().then(() => this.modalService.title = this.panelService.title = '骰子機器人表設定');
    EventSystem.register(this)
      .on('DELETE_GAME_OBJECT', 1000, event => {
        if (!this.selectedDiceRollTable || event.data.identifier !== this.selectedDiceRollTable.identifier) return;
        let object = ObjectStore.instance.get(event.data.identifier);
        if (object !== null) {
          this.selectedDiceRollTableXml = object.toXml();
        }
      });
  }

  ngAfterViewInit() {
    //const diceRollTables = DiceRollTableList.instance.diceRollTables;
    if (this.diceRollTables.length > 0) {
      queueMicrotask(() => {
        this.onChangeDiceRollTable(this.diceRollTables[0].identifier);
        this.diceRollTableSelecter.nativeElement.selectedIndex = 0;
      });
    }
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  onChangeDiceRollTable(identifier: string) {
    this.selectedDiceRollTable = ObjectStore.instance.get<DiceRollTable>(identifier);
    this.selectedDiceRollTableXml = '';
  }

  create(name: string = '骰子機器人表'): DiceRollTable {
    if (this.GuestMode()) return;
    return DiceRollTableList.instance.addDiceRollTable(name)
  }

  add() {
    const diceRollTable = this.create();
    queueMicrotask(() => {
      this.onChangeDiceRollTable(diceRollTable.identifier);
      this.diceRollTableSelecter.nativeElement.value = diceRollTable.identifier;
    })
  }
  
  async save() {
    if (this.GuestMode()) return;
    if (!this.selectedDiceRollTable || this.isSaveing) return;
    this.isSaveing = true;
    this.progresPercent = 0;

    let fileName: string = 'fly_rollTable_' + this.selectedDiceRollTable.name;

    await this.saveDataService.saveGameObjectAsync(this.selectedDiceRollTable, fileName, percent => {
      this.progresPercent = percent;
    });

    setTimeout(() => {
      this.isSaveing = false;
      this.progresPercent = 0;
    }, 500);
  }

  async saveAll() {
    if (this.isSaveing) return;
    this.isSaveing = true;
    this.progresPercent = 0;

    await this.saveDataService.saveGameObjectAsync(DiceRollTableList.instance, 'fly_rollTable_All', percent => {
      this.progresPercent = percent;
    });

    setTimeout(() => {
      this.isSaveing = false;
      this.progresPercent = 0;
    }, 500);
  }

  delete() {
    if (this.GuestMode()) return;
    if (!this.isEmpty && this.selectedDiceRollTable) {
      this.selectedDiceRollTableXml = this.selectedDiceRollTable.toXml();
      this.selectedDiceRollTable.destroy();
    }
  }

  restore() {
    if (this.GuestMode()) return;
    if (this.selectedDiceRollTable && this.selectedDiceRollTableXml) {
      let restoreTable = <DiceRollTable>ObjectSerializer.instance.parseXml(this.selectedDiceRollTableXml);
      DiceRollTableList.instance.addDiceRollTable(restoreTable);
      this.selectedDiceRollTableXml = '';
      queueMicrotask(() => {
        const diceRollTables = this.diceRollTables;
        this.onChangeDiceRollTable(diceRollTables[diceRollTables.length - 1].identifier);
        this.diceRollTableSelecter.nativeElement.selectedIndex = diceRollTables.length - 1;
      });
    }
  }

  upTabIndex() {
    if (this.GuestMode()) return;
    if (!this.selectedDiceRollTable) return;
    let parentElement = this.selectedDiceRollTable.parent;
    let index: number = parentElement.children.indexOf(this.selectedDiceRollTable);
    if (0 < index) {
      let prevElement = parentElement.children[index - 1];
      parentElement.insertBefore(this.selectedDiceRollTable, prevElement);
    }
  }

  downTabIndex() {
    if (this.GuestMode()) return;
    if (!this.selectedDiceRollTable) return;
    let parentElement = this.selectedDiceRollTable.parent;
    let index: number = parentElement.children.indexOf(this.selectedDiceRollTable);
    if (index < parentElement.children.length - 1) {
      let nextElement = parentElement.children[index + 1];
      parentElement.insertBefore(nextElement, this.selectedDiceRollTable);
    }
  }

  helpDiceRollTable() {
    if (this.GuestMode()) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x, top: coordinate.y, width: 600, height: 788 };
    let textView = this.panelService.open(TextViewComponent, option);
    textView.title = '骰子機器人表說明';
    textView.text = 
`　設定名稱、指令與要擲的骰子，依骰子數字查表並顯示結果。
　在聊天傳送指令後，會像骰子機器人一樣送出結果。
　表以每行「數字:結果」的形式撰寫，數字與結果以:（冒號）分隔（因此骰子最後必須回傳一個數字；亦支援離散骰 nBm、個數加骰 nRm、上方無限骰 nUm 的成功數）。
　
　也可以用 -（連字號）或～指定數字範圍。
　表中寫入 \\n 會在該處換行（\\n 本身不會顯示）。

骰子機器人顯示例）
　name: 遭遇艦種　
　command: ShipType　　dice: 1d6

　　1:戰艦
　　2:航空母艦
　　3:重巡洋艦
　　4:輕巡洋艦
　　5-6:驅逐艦

　查表時以先出現的項目為優先；上例即使最後一行寫成「1-6:驅逐艦」結果也相同（但仍建議寫得清楚易懂）。
　預設的 D66 不會排序；若需要（例如骰子小說的名稱表等），請使用 D66S 取得排序後的數字。
　撰寫數字時可用 *（星號）作為萬用字元（任意數字），例如 *-1 表示 1 以下、6-* 表示 6 以上（單獨的 * 代表所有數字，會從上到下比對，若寫在表中間會使後面的行無法被參照）。搭配後述修正，即使超出表範圍也能取得結果。

　聊天指令會忽略全形半形與英文字母大小寫。也可以對骰子加減修正，或以任意數字查表。在指令後加上 +修正值 或 -修正值 可修正擲出的數字；寫 =指定值 則以該數字查對應的骰子機器人表。修正值、指定值為任意整數。

指令示例）
　ShipType=3
　以前述「遭遇艦種」指定數字 3 查表，會顯示「重巡洋艦」。若指定小於 1 或大於 6 的數字，則會變成「（沒有結果）」。

　ShipType+2
　以前述「遭遇艦種」在 1d6 結果上 +2 後查表。「遭遇艦種」沒有 7 以後的項目，此時會變成「（沒有結果）」；若要避免，請使用前述萬用字元 *。`;
  }
}
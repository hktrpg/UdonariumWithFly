import { AfterViewInit, Directive, ElementRef, Input, OnDestroy } from '@angular/core';
import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { ObjectNode } from '@udonarium/core/synchronize-object/object-node';
import { DataElement } from '@udonarium/data-element';
import { DiceSymbol } from '@udonarium/dice-symbol';
import { GameCharacter } from '@udonarium/game-character';
import { GameTableMask } from '@udonarium/game-table-mask';
import { RangeArea } from '@udonarium/range';
import { Terrain } from '@udonarium/terrain';
import { TextNote } from '@udonarium/text-note';
import { ChatMessageService } from 'service/chat-message.service';
import { translate } from 'i18n';

interface LoggingValue {
  timerId?: NodeJS.Timeout;
  oldValue: string;
  //isEditing: boolean;
};

@Directive({
    selector: '[appLogging]',
    standalone: false
})
export class LoggingInputDirective implements AfterViewInit, OnDestroy {
  @Input('logging.disable') isDisable: boolean = false;
  @Input('logging.timeout') timeout: number = 666;
  @Input('logging.name') name: string;
  @Input('logging.dataElement') dataElement: DataElement;
  @Input('logging.loggingValue') showValue: boolean = true;

  private static LoggingValueMap = new Map<string, LoggingValue>(); 
  type = translate('chat.op.typeObject');

  ngAfterViewInit() {
    let elm = <ObjectNode>this.dataElement;
    while (elm = elm.parent) {
      if (elm instanceof Card) {
        this.type = translate('alias.card');
      }
      if (elm instanceof CardStack) {
        this.type = translate('alias.card-stack');
      }
      if (elm instanceof DiceSymbol) {
        this.type = elm.isCoin ? translate('dice.dynamic.1') : translate('dice.dynamic.2');
      }
      if (elm instanceof GameCharacter) {
        this.type = translate('alias.character');
      }
      if (elm instanceof GameTableMask) {
        this.type = translate('alias.table-mask');
      }
      if (elm instanceof Terrain) {
        this.type = translate('alias.terrain');
      }
      if (elm instanceof TextNote) {
        this.type = translate('alias.text-note');
      }
      if (elm instanceof RangeArea) {
        this.type = translate('alias.range');
      }
      if (!elm.parentIsAssigned || elm.parentIsUnknown) break;
    }
    const LoggingValueMap = LoggingInputDirective.LoggingValueMap;
    const identifier = this.dataElement.identifier;
    const loggingNativeElement = this.elementRef.nativeElement;
    LoggingValueMap.set(identifier, { oldValue: this.dataElement.loggingValue });
    // 若用 input 不行再改以事件控制
    /*
    LoggingValueMap.set(identifier, { oldValue: this.loggingValue, isEditing: false });
    const startFunc = () => { LoggingValueMap.get(identifier).isEditing = true; };
    const endFunc = () => { LoggingValueMap.get(identifier).isEditing = false; };
    ['focus', 'click', 'mousedown', 'pointerdown', 'touchstart', 'keydown'].forEach((eventName) => {
      loggingNativeElement.addEventListener(eventName, startFunc);
    });
    ['blur', 'mouseleave', 'pointerleave'].forEach((eventName) => {
      loggingNativeElement.addEventListener(eventName, endFunc);
    });
    */
    loggingNativeElement.addEventListener('input', () => { 
      //if (!LoggingValueMap.get(identifier).isEditing) return;
      if (LoggingValueMap.get(identifier).timerId) clearTimeout(LoggingValueMap.get(identifier).timerId);
      LoggingValueMap.get(identifier).timerId = setTimeout(() => {
        this.doLogging();
      }, this.timeout);
    });

    // 寫法粗糙；本應初始化，但目前只為對應指令，暫維持現狀
    this.dataElement.changeObserver = () => {
      if (LoggingValueMap.get(identifier).timerId) clearTimeout(LoggingValueMap.get(identifier).timerId);
      LoggingValueMap.get(identifier).timerId = setTimeout(() => {
        if (this.doLogging) this.doLogging(false);
      }, 0);
    }
    /*
    loggingNativeElement.addEventListener('change', () => {
      if (!LoggingValueMap.get(identifier).isEditing) return;
      if (LoggingValueMap.get(identifier).timerId) clearTimeout(LoggingValueMap.get(identifier).timerId);
      LoggingValueMap.get(identifier).timerId = setTimeout(() => {
        this.doLogging();
      }, this.timeout);
    });
    */
  }

  ngOnDestroy() {
    const LoggingValueMap = LoggingInputDirective.LoggingValueMap;
    const identifier = this.dataElement.identifier;
    if (LoggingValueMap.get(identifier) && LoggingValueMap.get(identifier).timerId) {
      this.doLogging();
    }
  }

  doLogging(sendMsssage = true) {
    const LoggingValueMap = LoggingInputDirective.LoggingValueMap;
    const identifier = this.dataElement.identifier;
    //LoggingValueMap.get(identifier).isEditing = false;
    if (LoggingValueMap.get(identifier).timerId) {
      clearTimeout(LoggingValueMap.get(identifier).timerId);
      LoggingValueMap.get(identifier).timerId = null;
    }
    const oldValue = LoggingValueMap.get(identifier).oldValue;
    const value = this.dataElement.loggingValue;
    const dataElement = this.dataElement;
    if (sendMsssage && !this.isDisable && value != oldValue) {
      let text = translate('chat.op.fieldChanged', {
        owner: this.name == '' ? translate('chat.op.unnamedObject', { type: this.type }) : this.name,
        field: dataElement.name == '' ? translate('chat.op.unnamedVar') : dataElement.name
      });
      if (this.showValue && (dataElement.isSimpleNumber || dataElement.isNumberResource || dataElement.isAbilityScore)) {
        text += ` ${oldValue} → ${value}`;
      } else if (dataElement.isCheckProperty) {
        text += ` ${value}`
      }
      this.chatMessageService.sendOperationLog(text);
    }
    LoggingValueMap.get(identifier).oldValue = value;
  }

  constructor(
    private elementRef: ElementRef<HTMLElement>,
    private chatMessageService: ChatMessageService
  ) { }

}

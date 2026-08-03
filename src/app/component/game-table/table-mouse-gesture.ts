import { InputHandler } from 'directive/input-handler';

type Callback = (srcEvent: TouchEvent | MouseEvent | PointerEvent) => void;
type OnTransformCallback = (transformX: number, transformY: number, transformZ: number, rotateX: number, rotateY: number, rotateZ: number, event: TableMouseGestureEvent, srcEvent: TouchEvent | MouseEvent | PointerEvent | KeyboardEvent) => void;

export enum TableMouseGestureEvent {
  DRAG = 'drag',
  ZOOM = 'zoom',
  ROTATE = 'rotate',
  KEYBOARD = 'keyboard',
}

enum Keyboard {
  ArrowLeft = 'ArrowLeft',
  ArrowUp = 'ArrowUp',
  ArrowRight = 'ArrowRight',
  ArrowDown = 'ArrowDown',
}

export class TableMouseGesture {
  private currentPositionX: number = 0;
  private currentPositionY: number = 0;

  private buttonCode: number = 0;
  private input: InputHandler = null;

  get isGrabbing(): boolean { return this.input.isGrabbing; }
  get isDragging(): boolean { return this.input.isDragging; }

  private callbackOnWheel = (e) => this.onWheel(e);
  private callbackOnKeydown = (e) => this.onKeydown(e);

  onstart: Callback = null;
  onend: Callback = null;
  ontransform: OnTransformCallback = null;

  constructor(readonly targetElement: HTMLElement) {
    this.initialize();
  }

  private initialize() {
    this.input = new InputHandler(this.targetElement, { capture: true });
    this.addEventListeners();
    this.input.onStart = this.onInputStart.bind(this);
    this.input.onMove = this.onInputMove.bind(this);
    this.input.onEnd = this.onInputEnd.bind(this);
  }

  cancel() {
    this.input.cancel();
  }

  destroy() {
    this.input.destroy();
    this.removeEventListeners();
  }

  onInputStart(ev: any) {
    this.currentPositionX = this.input.pointer.x;
    this.currentPositionY = this.input.pointer.y;
    this.buttonCode = ev.button;
    if (this.onstart) this.onstart(ev);
  }

  onInputEnd(ev: any) {
    if (this.onend) this.onend(ev);
  }

  onInputMove(ev: any) {
    let x = this.input.pointer.x;
    let y = this.input.pointer.y;
    let deltaX = x - this.currentPositionX;
    let deltaY = y - this.currentPositionY;

    let transformX = 0;
    let transformY = 0;
    let transformZ = 0;

    let rotateX = 0;
    let rotateY = 0;
    let rotateZ = 0;

    let event = TableMouseGestureEvent.DRAG;

    if (this.buttonCode === 2) {
      event = TableMouseGestureEvent.ROTATE;
      rotateZ = -deltaX / 5;
      rotateX = -deltaY / 5;
    } else {
      transformX = deltaX;
      transformY = deltaY;
    }

    this.currentPositionX = x;
    this.currentPositionY = y;

    if (this.ontransform) this.ontransform(transformX, transformY, transformZ, rotateX, rotateY, rotateZ, event, ev);
  }

  onWheel(ev: WheelEvent) {
    // Object rotation shortcuts are handled elsewhere.
    if (ev.altKey) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey) return;

    // Prefer dominant axis (Shift+wheel often becomes deltaX on OS/browser).
    const rawDelta = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
    let pixelDelta = 0;
    switch (ev.deltaMode) {
      case WheelEvent.DOM_DELTA_LINE:
        pixelDelta = rawDelta * 16;
        break;
      case WheelEvent.DOM_DELTA_PAGE:
        pixelDelta = rawDelta * window.innerHeight;
        break;
      default:
        pixelDelta = rawDelta;
        break;
    }
    if (pixelDelta === 0) return;

    let transformX = 0;
    let transformY = 0;
    let transformZ = 0;

    let rotateX = 0;
    let rotateY = 0;
    let rotateZ = 0;

    let event = TableMouseGestureEvent.ZOOM;

    if (ev.shiftKey) {
      // Shift + wheel → pan left / right
      transformX = -pixelDelta;
      event = TableMouseGestureEvent.DRAG;
      if (ev.cancelable) ev.preventDefault();
    } else if (ev.ctrlKey || ev.metaKey) {
      // Ctrl + wheel → pan up / down
      transformY = -pixelDelta;
      event = TableMouseGestureEvent.DRAG;
      if (ev.cancelable) ev.preventDefault();
    } else {
      transformZ = pixelDelta * -1.5;
      if (300 ** 2 < transformZ ** 2) transformZ = Math.min(Math.max(transformZ, -300), 300);
    }

    if (this.ontransform) this.ontransform(transformX, transformY, transformZ, rotateX, rotateY, rotateZ, event, ev);
  }

  onKeydown(ev: KeyboardEvent) {
    let transformX = 0;
    let transformY = 0;
    let transformZ = 0;

    let rotateX = 0;
    let rotateY = 0;
    let rotateZ = 0;

    let key = this.getKeyName(ev);
    switch (key) {
      case Keyboard.ArrowLeft:
        if (ev.shiftKey) {
          rotateZ = -2;
        } else {
          transformX = 10;
        }
        break;
      case Keyboard.ArrowUp:
        if (ev.shiftKey) {
          rotateX = -2;
        } else if (ev.ctrlKey) {
          transformZ = 150;
        } else {
          transformY = 10;
        }
        break;
      case Keyboard.ArrowRight:
        if (ev.shiftKey) {
          rotateZ = 2;
        } else {
          transformX = -10;
        }
        break;
      case Keyboard.ArrowDown:
        if (ev.shiftKey) {
          rotateX = 2;
        } else if (ev.ctrlKey) {
          transformZ = -150;
        } else {
          transformY = -10;
        }
        break;
    }
    let isArrowKey = Keyboard[key] != null;
    if (isArrowKey && this.ontransform) this.ontransform(transformX, transformY, transformZ, rotateX, rotateY, rotateZ, TableMouseGestureEvent.KEYBOARD, ev);
  }

  private getKeyName(keyboard: KeyboardEvent): string {
    if (keyboard.key) return keyboard.key;
    switch (keyboard.keyCode) {
      case 37: return Keyboard.ArrowLeft;
      case 38: return Keyboard.ArrowUp;
      case 39: return Keyboard.ArrowRight;
      case 40: return Keyboard.ArrowDown;
      default: return '';
    }
  }

  private addEventListeners() {
    this.targetElement.addEventListener('wheel', this.callbackOnWheel, { passive: false });
    document.body.addEventListener('keydown', this.callbackOnKeydown, false);
  }

  private removeEventListeners() {
    this.targetElement.removeEventListener('wheel', this.callbackOnWheel);
    document.body.removeEventListener('keydown', this.callbackOnKeydown, false);
  }
}

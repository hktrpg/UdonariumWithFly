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
  /** Acc for Alt(+Shift)+wheel view rotate → exactly 3° per notch. */
  private altWheelAcc = 0;

  get isGrabbing(): boolean { return this.input.isGrabbing; }
  get isDragging(): boolean { return this.input.isDragging; }

  private callbackOnWheel = (e) => this.onWheel(e);
  private callbackOnKeydown = (e) => this.onKeydown(e);

  onstart: Callback = null;
  onend: Callback = null;
  ontransform: OnTransformCallback = null;

  /**
   * @param hasObjectSelection When true, Alt(+Shift)+wheel is owned by TabletopKeyboardService
   *   (object facing/roll) — do not rotate the view.
   */
  constructor(
    readonly targetElement: HTMLElement,
    private readonly hasObjectSelection: () => boolean = () => false,
  ) {
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

    // Middle-drag = rotate view; right-drag (and other non-rotate buttons) = pan.
    if (this.buttonCode === 1) {
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
    // Ctrl+Shift+wheel = object rotate (handled in TabletopKeyboardService).
    if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey) return;
    // Alt+wheel with selection = object rotate (same service, capture phase).
    if (ev.altKey && this.hasObjectSelection()) return;

    // Prefer dominant axis (Shift+wheel often becomes deltaX on OS/browser).
    const useX = Math.abs(ev.deltaX) > Math.abs(ev.deltaY);
    const rawDelta = useX ? ev.deltaX : ev.deltaY;
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

    if (ev.altKey) {
      // Empty selection → rotate view ±3° per wheel notch.
      if (ev.ctrlKey || ev.metaKey) return;
      if (ev.cancelable) ev.preventDefault();
      const notch = 100;
      const stepDeg = 3;
      this.altWheelAcc += pixelDelta;
      if (Math.abs(this.altWheelAcc) < notch) return;
      const dir = this.altWheelAcc > 0 ? 1 : -1;
      // Keep remainder so rapid ticks still track; one notch → exactly stepDeg.
      this.altWheelAcc -= dir * notch;
      event = TableMouseGestureEvent.ROTATE;
      if (ev.shiftKey) {
        rotateX = -dir * stepDeg; // pitch
      } else {
        rotateZ = -dir * stepDeg; // yaw
      }
    } else if (ev.shiftKey) {
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

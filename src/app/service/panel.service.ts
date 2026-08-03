import { ComponentRef, Injectable, OnChanges, ViewContainerRef } from '@angular/core';
import { I18nService } from './i18n.service';

declare var Type: FunctionConstructor;
interface Type<T> extends Function {
  new(...args: any[]): T;
}

export interface PanelOption {
  title?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

@Injectable()
export class PanelService {
  /* Todo */
  static defaultParentViewContainerRef: ViewContainerRef;
  static UIPanelComponentClass: { new(...args: any[]): any } = null;

  /** Dynamically opened panels (not the fixed left-nav panel). */
  private static readonly openPanels = new Set<PanelService>();

  private panelComponentRef: ComponentRef<any>
  title: string = 'Untitled panel';
  left: number = 0;
  top: number = 0;
  width: number = 100;
  height: number = 100;
  isAbleMinimizeButton: boolean = true;
  isAbleFullScreenButton: boolean = true;
  isAbleCloseButton: boolean = true;
  isAbleRotateButton: boolean = false;

  scrollablePanel: HTMLDivElement = null;

  constructor(private i18n: I18nService) {
    this.title = this.i18n.t('panel.untitled');
  }

  get isShow(): boolean {
    return this.panelComponentRef ? true : false;
  }

  /** Close all closable desktop UI panels opened via PanelService.open(). */
  static closeAllPanels() {
    for (const panel of Array.from(PanelService.openPanels)) {
      if (panel.isAbleCloseButton) panel.close();
    }
  }

  open<T>(childComponent: Type<T>, option?: PanelOption, parentViewContainerRef?: ViewContainerRef): T {
    if (!parentViewContainerRef) {
      parentViewContainerRef = PanelService.defaultParentViewContainerRef;
    }

    const injector = parentViewContainerRef.injector;

    let panelComponentRef: ComponentRef<any> = parentViewContainerRef.createComponent(PanelService.UIPanelComponentClass, { index: parentViewContainerRef.length, injector: injector });
    let bodyComponentRef: ComponentRef<any> = panelComponentRef.instance.content.createComponent(childComponent);

    const childPanelService: PanelService = panelComponentRef.injector.get(PanelService);

    childPanelService.panelComponentRef = panelComponentRef;
    PanelService.openPanels.add(childPanelService);
    if (option) {
      if (option.title) childPanelService.title = option.title;
      if (option.top) childPanelService.top = option.top;
      if (option.left) childPanelService.left = option.left;
      if (option.width) childPanelService.width = option.width;
      if (option.height) childPanelService.height = option.height;
    }
    panelComponentRef.onDestroy(() => {
      PanelService.openPanels.delete(childPanelService);
      childPanelService.panelComponentRef = null;
      panelComponentRef = null;
    });

    bodyComponentRef.onDestroy(() => {
      bodyComponentRef = null;
    });

    let panelOnChanges = panelComponentRef.instance as OnChanges;
    let bodyOnChanges = bodyComponentRef.instance as OnChanges;
    if (panelOnChanges?.ngOnChanges != null || bodyOnChanges?.ngOnChanges != null) {
      queueMicrotask(() => {
        if (bodyComponentRef && bodyOnChanges?.ngOnChanges != null) bodyOnChanges?.ngOnChanges({});
        if (panelComponentRef && panelOnChanges?.ngOnChanges != null) panelOnChanges?.ngOnChanges({});
      });
    }

    return <T>bodyComponentRef.instance;
  }

  close() {
    if (this.panelComponentRef) {
      this.panelComponentRef.destroy();
      this.panelComponentRef = null;
    }
  }
}
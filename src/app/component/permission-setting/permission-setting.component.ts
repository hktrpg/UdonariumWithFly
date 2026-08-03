import { Component, OnDestroy, OnInit } from '@angular/core';
import { EventSystem } from '@udonarium/core/system';
import { PeerCursor } from '@udonarium/peer-cursor';
import { SceneToolPermission } from '@udonarium/table-fx/scene-tool-permission';

import { I18nService } from 'service/i18n.service';
import { PanelService } from 'service/panel.service';

@Component({
  selector: 'permission-setting',
  templateUrl: './permission-setting.component.html',
  styleUrls: ['./permission-setting.component.css'],
  standalone: false
})
export class PermissionSettingComponent implements OnInit, OnDestroy {
  get isGMMode(): boolean {
    return PeerCursor.myCursor ? PeerCursor.myCursor.isGMMode : false;
  }

  get scenePerm() { return SceneToolPermission.instance; }

  get sceneCanCreateLight(): boolean { return this.scenePerm.playerCanCreateLight; }
  set sceneCanCreateLight(v: boolean) { this.scenePerm.playerCanCreateLight = !!v; }
  get sceneCanCreateWall(): boolean { return this.scenePerm.playerCanCreateWall; }
  set sceneCanCreateWall(v: boolean) { this.scenePerm.playerCanCreateWall = !!v; }
  get sceneCanCreateRect(): boolean { return this.scenePerm.playerCanCreateRect; }
  set sceneCanCreateRect(v: boolean) { this.scenePerm.playerCanCreateRect = !!v; }
  get sceneCanCreateEllipse(): boolean { return this.scenePerm.playerCanCreateEllipse; }
  set sceneCanCreateEllipse(v: boolean) { this.scenePerm.playerCanCreateEllipse = !!v; }
  get sceneCanCreatePolygon(): boolean { return this.scenePerm.playerCanCreatePolygon; }
  set sceneCanCreatePolygon(v: boolean) { this.scenePerm.playerCanCreatePolygon = !!v; }
  get sceneCanCreateFreehand(): boolean { return this.scenePerm.playerCanCreateFreehand; }
  set sceneCanCreateFreehand(v: boolean) { this.scenePerm.playerCanCreateFreehand = !!v; }
  get sceneCanCreateText(): boolean { return this.scenePerm.playerCanCreateText; }
  set sceneCanCreateText(v: boolean) { this.scenePerm.playerCanCreateText = !!v; }

  get sceneCanModifyLight(): boolean { return this.scenePerm.playerCanModifyLight; }
  set sceneCanModifyLight(v: boolean) { this.scenePerm.playerCanModifyLight = !!v; }
  get sceneCanModifyWall(): boolean { return this.scenePerm.playerCanModifyWall; }
  set sceneCanModifyWall(v: boolean) { this.scenePerm.playerCanModifyWall = !!v; }
  get sceneCanModifyDrawing(): boolean { return this.scenePerm.playerCanModifyDrawing; }
  set sceneCanModifyDrawing(v: boolean) { this.scenePerm.playerCanModifyDrawing = !!v; }

  get sceneAllCreate(): boolean {
    const p = this.scenePerm;
    return p.playerCanCreateLight && p.playerCanCreateWall
      && p.playerCanCreateRect && p.playerCanCreateEllipse
      && p.playerCanCreatePolygon && p.playerCanCreateFreehand
      && p.playerCanCreateText;
  }
  get sceneAllModify(): boolean {
    const p = this.scenePerm;
    return p.playerCanModifyLight && p.playerCanModifyWall && p.playerCanModifyDrawing;
  }
  setAllSceneCreate(v: boolean) { this.scenePerm.setAllCreate(v); }
  setAllSceneModify(v: boolean) { this.scenePerm.setAllModify(v); }

  constructor(
    private panelService: PanelService,
    private i18n: I18nService,
  ) { }

  ngOnInit() {
    Promise.resolve().then(() => this.refreshTitle());
    EventSystem.register(this)
      .on('LOCALE_CHANGED', () => this.refreshTitle())
      .on('CHANGE_GM_MODE', () => this.refreshTitle());
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  private refreshTitle() {
    this.panelService.title = this.i18n.t('peer.permissionManage');
  }
}

import { Component } from '@angular/core';
import { GuestSession } from '@udonarium/guest-session';
import { PeerCursor } from '@udonarium/peer-cursor';
import { SceneToolMode, SceneToolService } from 'service/scene-tool.service';

@Component({
  selector: 'scene-tools',
  templateUrl: './scene-tools.component.html',
  styleUrls: ['./scene-tools.component.css'],
  standalone: false
})
export class SceneToolsComponent {
  constructor(public tools: SceneToolService) {}

  get isGuest(): boolean { return GuestSession.isGuest; }
  get isGM(): boolean { return PeerCursor.myCursor?.isGMMode; }

  setMode(mode: SceneToolMode) {
    if (this.isGuest && mode !== 'select') return;
    this.tools.setMode(mode);
  }

  toggle() {
    this.tools.paletteOpen = !this.tools.paletteOpen;
  }
}

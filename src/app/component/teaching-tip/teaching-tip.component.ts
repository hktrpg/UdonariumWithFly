import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { TeachingTipService, TeachingTipState } from 'service/teaching-tip.service';

@Component({
  selector: 'teaching-tip',
  templateUrl: './teaching-tip.component.html',
  styleUrls: ['./teaching-tip.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class TeachingTipComponent implements OnInit, OnDestroy {
  state: TeachingTipState = {
    visible: false,
    tipKey: '',
    titleKey: '',
    bodyKey: '',
    left: 0,
    top: 0,
    anchorEl: null,
  };

  private sub: Subscription;

  constructor(
    private tips: TeachingTipService,
    private cd: ChangeDetectorRef,
  ) { }

  ngOnInit() {
    this.sub = this.tips.state$.subscribe(s => {
      this.state = s;
      this.cd.markForCheck();
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }
}

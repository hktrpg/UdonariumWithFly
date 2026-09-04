import { StreetscapeImportComponent } from 'component/streetscape-import/streetscape-import.component';
import { I18nService } from 'service/i18n.service';
import { MobileLayoutService } from 'service/mobile-layout.service';
import { PanelService } from 'service/panel.service';
import { StreetscapeJobService } from 'service/streetscape-job.service';

/** Open or restore the streetscape import panel (shared by settings / nav / job HUD). */
export function openOrRestoreStreetscapeImportPanel(opts: {
  panelService: PanelService;
  i18n: I18nService;
  mobileLayout: MobileLayoutService;
  job?: StreetscapeJobService;
}): void {
  if (PanelService.bringTourPanelToFront('panel.streetscape-import')) {
    if (opts.job?.busy) opts.job.hideHudForPanel();
    else opts.job?.dismissHud();
    return;
  }
  PanelService.closePanelsByTourId('panel.streetscape-import');
  let option = {
    width: 360,
    height: 520,
    left: 100,
    title: opts.i18n.t('streetscape.title'),
    tourPanelId: 'panel.streetscape-import',
    mobileReplace: true,
    mobileSheet: 'half' as const,
  };
  option = opts.mobileLayout.adaptPanelOption(option);
  opts.panelService.open(StreetscapeImportComponent, option);
}

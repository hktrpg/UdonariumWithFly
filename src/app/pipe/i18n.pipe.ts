import { Pipe, PipeTransform } from '@angular/core';
import { I18nParams } from 'i18n';
import { I18nService } from 'service/i18n.service';

@Pipe({
  name: 'i18n',
  pure: false,
  standalone: false
})
export class I18nPipe implements PipeTransform {
  constructor(private i18n: I18nService) {}

  transform(key: string, params?: I18nParams): string {
    // Depend on revision so templates refresh when language changes.
    void this.i18n.revision;
    return this.i18n.t(key, params);
  }
}

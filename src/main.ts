import 'hammerjs';

import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { ensureI18nLocalesRegistered } from './app/i18n';

ensureI18nLocalesRegistered();

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err => console.error(err));

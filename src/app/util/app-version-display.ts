import { appVersion } from '../../environments/version';
import { buildAppVersionDisplay } from './format-utc-iso-local';

export const APP_VERSION_DISPLAY = buildAppVersionDisplay(appVersion);

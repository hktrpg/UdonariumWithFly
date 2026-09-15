// Karma configuration for Angular tests + coverage gates on critical paths.
// Prefer Playwright's bundled Chromium when installed (reliable headless on Windows + CI).
const fs = require('fs');
try {
  const { chromium } = require('playwright');
  const chromeBin = chromium.executablePath();
  if (fs.existsSync(chromeBin)) {
    process.env.CHROME_BIN = chromeBin;
  }
} catch {
  // Fall back to system Chrome via karma-chrome-launcher.
}

module.exports = function (config) {
  config.set({
    // Avoid Windows localhost → IPv6 mismatch where Chrome never captures.
    hostname: '127.0.0.1',
    listenAddress: '127.0.0.1',
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
      require('@angular-devkit/build-angular/plugins/karma'),
    ],
    client: {
      jasmine: {},
      clearContext: false,
    },
    jasmineHtmlReporter: { suppressAll: true },
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage/udonarium'),
      subdir: '.',
      reporters: [{ type: 'html' }, { type: 'text-summary' }, { type: 'lcovonly' }],
      check: {
        global: {
          // Soft global floor — most specs are smoke "should create".
          statements: 5,
          lines: 5,
          branches: 0,
          functions: 5,
        },
        each: {
          // Critical regression paths must stay reasonably covered when edited.
          overrides: {
            '**/clue-link.ts': {
              statements: 50,
              lines: 50,
              functions: 40,
              branches: 30,
            },
            '**/push-pin.util.ts': {
              statements: 40,
              lines: 40,
              functions: 30,
              branches: 20,
            },
            '**/folder-backup-layout.ts': {
              statements: 40,
              lines: 40,
              functions: 30,
              branches: 20,
            },
            '**/save-xml-remap.util.ts': {
              statements: 40,
              lines: 40,
              functions: 30,
              branches: 20,
            },
            '**/mask-appearance.ts': {
              statements: 30,
              lines: 30,
              functions: 30,
              branches: 20,
            },
            '**/compress.ts': {
              statements: 40,
              lines: 40,
              functions: 30,
              branches: 20,
            },
            '**/resource-policy.ts': {
              statements: 40,
              lines: 40,
              functions: 30,
              branches: 20,
            },
            '**/image-canvas.ts': {
              statements: 30,
              lines: 30,
              functions: 30,
              branches: 20,
            },
          },
          // Exclude Angular components / huge services from per-file gates.
          excludes: [
            '**/node_modules/**',
            '**/*.spec.ts',
            '**/testing/**',
            '**/component/**',
            '**/directive/**',
            '**/pipe/**',
          ],
        },
      },
    },
    reporters: ['progress', 'kjhtml'],
    browsers: ['Chrome'],
    // Windows CI/dev: ChromeHeadless can exceed the default 60s capture window.
    captureTimeout: 180000,
    browserDisconnectTimeout: 120000,
    browserNoActivityTimeout: 180000,
    customLaunchers: {
      ChromeHeadlessCI: {
        base: 'Chrome',
        flags: [
          '--headless=new',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-extensions',
          '--use-gl=angle',
          '--enable-webgl',
          '--ignore-gpu-blocklist',
        ],
      },
    },
    restartOnFileChange: true,
  });
};

import { StreetscapeJobService } from './streetscape-job.service';

describe('StreetscapeJobService', () => {
  it('begin sets busy and returns a live AbortSignal', () => {
    const job = new StreetscapeJobService();
    const signal = job.begin();
    expect(job.busy).toBe(true);
    expect(job.phase).toBe('running');
    expect(signal.aborted).toBe(false);
    job.cancel();
    expect(signal.aborted).toBe(true);
    expect(job.busy).toBe(false);
    expect(job.phase).toBe('idle');
  });

  it('cancel aborts but finish/fail do not require panel lifecycle', () => {
    const job = new StreetscapeJobService();
    job.begin();
    job.setStatus('downloading');
    job.pinHud();
    job.finish('done');
    expect(job.busy).toBe(false);
    expect(job.phase).toBe('done');
    expect(job.status).toBe('done');
    expect(job.showHud).toBe(true);

    job.begin();
    job.pinHud();
    job.fail('');
    expect(job.phase).toBe('error');
    expect(job.busy).toBe(false);
  });

  it('dismissHud hides finished job but not a running one', () => {
    const job = new StreetscapeJobService();
    job.begin();
    job.pinHud();
    job.dismissHud();
    expect(job.hudVisible).toBe(true);
    job.finish('ok');
    job.dismissHud();
    expect(job.hudVisible).toBe(false);
    expect(job.phase).toBe('idle');
  });
});

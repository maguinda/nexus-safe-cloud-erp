import { Logger } from '@nestjs/common';
import { DeleteOldReadingsUseCase } from '../application/delete-old-readings.use-case';

/** Cada cierto tiempo borra las lecturas que pasaron el plazo. Una pasada a la vez; un fallo se registra y se reintenta en la siguiente. */
export class RetentionScheduler {
  private readonly log = new Logger('RetentionScheduler');
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly job: DeleteOldReadingsUseCase, private readonly everyMs: number) {}

  start() {
    this.timer = setInterval(() => void this.tick(), this.everyMs);
    this.timer.unref();
    void this.tick();
  }

  async tick(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const { deleted } = await this.job.execute();
      if (deleted > 0) this.log.log(`${deleted} old reading(s) deleted`);
      return deleted;
    } catch (e) {
      this.log.warn(`retention pass failed, retrying next time: ${e instanceof Error ? e.message : 'error'}`);
      return 0;
    } finally { this.busy = false; }
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    while (this.busy) await new Promise((r) => setTimeout(r, 20));
  }
}

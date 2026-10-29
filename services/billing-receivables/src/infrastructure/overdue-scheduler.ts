import { Logger } from '@nestjs/common';
import { DetectOverdueInvoicesUseCase } from '../application/detect-overdue.use-case';

/** Revisa cada cierto tiempo si hay facturas que acaban de vencer. Una pasada a la vez; un fallo se registra y se reintenta en la siguiente. */
export class OverdueScheduler {
  private readonly log = new Logger('OverdueScheduler');
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly detect: DetectOverdueInvoicesUseCase, private readonly everyMs: number) {}

  start() {
    this.timer = setInterval(() => void this.tick(), this.everyMs);
    this.timer.unref(); // no retiene el proceso
    void this.tick();
  }

  async tick(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const { detected } = await this.detect.execute();
      if (detected > 0) this.log.log(`${detected} invoice(s) became overdue`);
      return detected;
    } catch (e) {
      this.log.warn(`overdue check failed, retrying next time: ${e instanceof Error ? e.name : 'error'}`);
      return 0;
    } finally { this.busy = false; }
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    while (this.busy) await new Promise((r) => setTimeout(r, 20));
  }
}

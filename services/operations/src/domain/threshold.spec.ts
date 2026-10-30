import { decideTransitions, DeviceAlertState, InsertedReading } from './threshold';
import { Severity } from './telemetry';

const t = (min: number) => new Date(Date.UTC(2026, 9, 20, 10, min));
const dev = (state: Severity, atMin: number | null, id = 'D1'): DeviceAlertState => ({ id, state, stateAt: atMin === null ? null : t(atMin) });
const rd = (min: number, status: string, deviceId = 'D1'): InsertedReading => ({ deviceId, recordedAt: t(min), status, value: 1, unit: 'u' });

describe('decideTransitions', () => {
  it.each([
    ['normal', 'WARNING', true, 'warning'], ['normal', 'ALERT', true, 'alert'], ['warning', 'ALERT', true, 'alert'],
    ['warning', 'WARNING', false, 'warning'], ['alert', 'ALERT', false, 'alert'], ['alert', 'WARNING', false, 'warning'],
    ['alert', 'NORMAL', false, 'normal'], ['warning', 'NORMAL', false, 'normal'], ['normal', 'NORMAL', false, 'normal'], ['normal', 'ON', false, 'normal'],
  ] as const)('%s + %s → breach=%s, state %s', (from, status, breach, to) => {
    const [r] = decideTransitions([dev(from, 0)], [rd(5, status)]);
    expect(!!r.breach).toBe(breach); expect(r.newState).toBe(to);
  });
  it('a first-ever reading (no state yet) that is bad does warn', () => {
    expect(decideTransitions([dev('normal', null)], [rd(1, 'ALERT')])[0].breach?.status).toBe('ALERT');
  });
  it('50 alert readings in one batch warn ONCE, with the latest one of the worst severity', () => {
    const batch = Array.from({ length: 50 }, (_, i) => rd(i + 1, 'ALERT'));
    const r = decideTransitions([dev('normal', 0)], batch);
    expect(r).toHaveLength(1); expect(r[0].breach?.recordedAt).toEqual(t(50)); expect(r[0].newStateAt).toEqual(t(50));
  });
  it('picks the WORST reading of the batch even when the last one is calm (alert then normal: warns, ends normal)', () => {
    const [r] = decideTransitions([dev('normal', 0)], [rd(1, 'ALERT'), rd(2, 'NORMAL')]);
    expect(r.breach?.status).toBe('ALERT'); expect(r.newState).toBe('normal'); expect(r.newStateAt).toEqual(t(2));
  });
  it('order inside the batch does not matter', () => {
    const [r] = decideTransitions([dev('normal', 0)], [rd(2, 'NORMAL'), rd(1, 'ALERT')]);
    expect(r.breach?.status).toBe('ALERT'); expect(r.newStateAt).toEqual(t(2));
  });
  it('a LATE batch (older than the last counted reading) changes nothing and warns nothing', () => {
    expect(decideTransitions([dev('normal', 30)], [rd(10, 'ALERT'), rd(30, 'ALERT')])).toEqual([]);
  });
  it('only the readings newer than the state count when a batch straddles it', () => {
    const [r] = decideTransitions([dev('warning', 20)], [rd(10, 'ALERT'), rd(25, 'WARNING')]);
    expect(r.breach).toBeUndefined(); expect(r.newState).toBe('warning'); expect(r.newStateAt).toEqual(t(25));
  });
  it('is not stuck: alert → normal (silent) → alert warns again', () => {
    let s = dev('alert', 0);
    const a = decideTransitions([s], [rd(1, 'NORMAL')])[0];
    expect(a.breach).toBeUndefined();
    s = dev(a.newState, 1);
    expect(decideTransitions([s], [rd(2, 'ALERT')])[0].breach).toBeDefined();
  });
  it('each device is decided on its own and the output follows id order', () => {
    const out = decideTransitions([dev('normal', 0, 'B'), dev('alert', 0, 'A'), dev('normal', 0, 'C')], [rd(1, 'WARNING', 'B'), rd(1, 'ALERT', 'A'), rd(1, 'NORMAL', 'C')]);
    expect(out.map((x) => x.deviceId)).toEqual(['A', 'B', 'C']);
    expect(out.map((x) => !!x.breach)).toEqual([false, true, false]);
  });
  it('a device with nothing new in the batch produces nothing', () => {
    expect(decideTransitions([dev('normal', 0, 'A'), dev('normal', 0, 'B')], [rd(1, 'ALERT', 'A')]).map((x) => x.deviceId)).toEqual(['A']);
  });
  it('matches a reference simulation (one reading at a time) on 400 random sequences: the number of warnings equals the real worsenings', () => {
    let seed = 11; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const SEV = ['NORMAL', 'WARNING', 'ALERT'];
    for (let c = 0; c < 400; c++) {
      let state: DeviceAlertState = dev('normal', null);
      let warned = 0, ref = 0; let refState = 0; let clock = 0;
      for (let b = 0; b < 6; b++) {
        const batch = Array.from({ length: 1 + rnd(4) }, () => rd(++clock, SEV[rnd(3)]));
        const [tr] = decideTransitions([state], batch);
        if (tr?.breach) warned++;
        if (tr) state = dev(tr.newState, (tr.newStateAt.getTime() - t(0).getTime()) / 60_000);
        // referencia: una lectura a la vez
        const worst = Math.max(...batch.map((x) => SEV.indexOf(x.status)));
        if (worst > refState) ref++;
        refState = SEV.indexOf(batch[batch.length - 1].status);
      }
      expect(warned).toBe(ref);
    }
  });
  it('a sensor clock running ahead never leaves the counted instant in the future (so the real readings of the next minutes still count)', () => {
    const now = t(100);
    const [r] = decideTransitions([dev('normal', 0)], [rd(104, 'ALERT')], now); // +4 min
    expect(r.breach).toBeDefined(); expect(r.newStateAt).toEqual(now);
    const next = decideTransitions([{ id: 'D1', state: r.newState, stateAt: r.newStateAt }], [rd(101, 'ALERT')], t(101));
    expect(next).toHaveLength(1); // la lectura real de 1 minuto después SÍ cuenta (no avisa: ya estaba en alerta)
    expect(next[0].breach).toBeUndefined();
  });
});

import { AdviceWriter } from '../domain/ports';
import { GetAdviceUseCase } from './get-advice.use-case';
import { GetNetworkUseCase } from './get-network.use-case';
import { GetTrendsUseCase } from './explore.use-cases';

const trends = (insights: unknown[]) => ({ execute: async () => ({ insights }) }) as unknown as GetTrendsUseCase;
const network = (insights: unknown[]) => ({ execute: async () => ({ insights }) }) as unknown as GetNetworkUseCase;
const alerts = { code: 'simultaneous_alerts', severity: 'high', params: { at: '2026-09-13T09:40:00.000Z', locations: 3, names: 'A, B, C', devices: 'd1, d2, d3', value: 1.2, unit: 'PPM' } };
const calm = [{ code: 'all_normal', severity: 'info', params: {} }];
const goodAnswer = JSON.stringify([{ evidenceIds: ['sensors:simultaneous_alerts:1'], title: 'Revisa las alertas', why: 'Hubo alertas a la vez en 3 oficinas.', action: 'Abre las lecturas.' }]);
const clock = () => new Date('2026-10-26T12:00:00Z');

function writer(impl: AdviceWriter['write']): AdviceWriter & { calls: number } {
  const w = { calls: 0, write: async (p: { system: string; user: string }, s: AbortSignal) => { w.calls++; return impl(p, s); } };
  return w;
}
const uc = (w: AdviceWriter | null, t: unknown[] = [alerts], n: unknown[] = [], timeout = 25_000) => new GetAdviceUseCase(trends(t), network(n), w, clock, timeout);

describe('GetAdviceUseCase', () => {
  it('without the AI switch it answers with rules, never calls the model, and says whether the AI is available', async () => {
    const w = writer(async () => goodAnswer);
    const r = await uc(w).execute('es', false);
    expect(r).toMatchObject({ source: 'rules', fallbackReason: null, aiAvailable: true, generatedAt: '2026-10-26T12:00:00.000Z' });
    expect(r.items).toHaveLength(1);
    expect(w.calls).toBe(0);
  });
  it('asking for the AI with no key configured answers with rules and the reason «unavailable»', async () => {
    const r = await uc(null).execute('es', true);
    expect(r).toMatchObject({ source: 'rules', fallbackReason: 'unavailable', aiAvailable: false });
    expect(r.items.length).toBe(1);
  });
  it('uses the answer of the model when it checks out against the facts', async () => {
    const r = await uc(writer(async () => goodAnswer)).execute('es', true);
    expect(r).toMatchObject({ source: 'ai', fallbackReason: null });
    expect(r.items[0].title).toBe('Revisa las alertas');
    expect(r.evidence.map((e) => e.id)).toEqual(['sensors:simultaneous_alerts:1']);
  });
  it('an answer with an invented number falls back to rules («invalid»)', async () => {
    const bad = JSON.stringify([{ evidenceIds: ['sensors:simultaneous_alerts:1'], title: 't', why: 'Hubo 9 alertas.', action: 'a' }]);
    const r = await uc(writer(async () => bad)).execute('es', true);
    expect(r).toMatchObject({ source: 'rules', fallbackReason: 'invalid' });
    expect(r.items[0].why).toContain('A, B, C'); // la de reglas, con los datos
  });
  it('a failing provider falls back to rules («error») and its message never reaches the answer', async () => {
    const r = await uc(writer(async () => { throw new Error('boom sk-secret-123'); })).execute('en', true);
    expect(r).toMatchObject({ source: 'rules', fallbackReason: 'error', language: 'en' });
    expect(JSON.stringify(r)).not.toMatch(/sk-secret|boom/);
  });
  it('a provider that never answers is cut at the deadline and falls back to rules', async () => {
    const hang = writer((_p, signal) => new Promise((_ok, fail) => signal.addEventListener('abort', () => fail(new Error('aborted')))));
    const started = Date.now();
    const r = await uc(hang, [alerts], [], 40).execute('es', true);
    expect(r).toMatchObject({ source: 'rules', fallbackReason: 'error' });
    expect(Date.now() - started).toBeLessThan(1500);
  });
  it('with nothing to decide it does not spend a call and returns no items', async () => {
    const w = writer(async () => goodAnswer);
    const r = await uc(w, calm, [{ code: 'all_covered', severity: 'info', params: {} }]).execute('es', true);
    expect(r).toMatchObject({ source: 'rules', fallbackReason: null, items: [], evidence: [] });
    expect(w.calls).toBe(0);
  });
  it('spends at most N AI calls per minute, answers with rules («limit») after that and gets its slots back as the minute passes', async () => {
    let now = Date.parse('2026-10-26T12:00:00Z');
    const w = writer(async () => goodAnswer);
    const limited = new GetAdviceUseCase(trends([alerts]), network([]), w, () => new Date(now), 25_000, 3);
    for (let i = 0; i < 3; i++) expect((await limited.execute('es', true)).source).toBe('ai');
    const over = await limited.execute('es', true);
    expect(over).toMatchObject({ source: 'rules', fallbackReason: 'limit' });
    expect(w.calls).toBe(3);
    expect((await limited.execute('es', false)).source).toBe('rules'); // las reglas no gastan cupo ni se limitan
    now += 60_000;
    expect((await limited.execute('es', true)).source).toBe('ai');
    expect(w.calls).toBe(4);
  });
  it('sends the model only the findings (data), in the language asked', async () => {
    let seen = '';
    await uc(writer(async (p) => { seen = p.user + p.system; return goodAnswer; })).execute('en', true);
    expect(seen).toContain('sensors:simultaneous_alerts:1');
    expect(seen).toContain('English');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { makeT } from '../../i18n';
import { LiveBadge } from './LiveBadge';

const view = (lang: 'es' | 'en', o: { lastOkAt: number | null; failing?: boolean; added?: number }) =>
  renderToStaticMarkup(<LiveBadge lastOkAt={o.lastOkAt} failing={o.failing ?? false} added={o.added ?? 0} lang={lang} t={makeT(lang)} />);

describe('LiveBadge', () => {
  it('shows nothing until the first load has finished (no «live» without data)', () => { expect(view('es', { lastOkAt: null })).toBe(''); });

  it('Spanish: «En vivo · actualizado hace 2 min», with the dot hidden from screen readers', () => {
    const out = view('es', { lastOkAt: Date.now() - 125_000 });
    expect(out).toContain('En vivo');
    expect(out).toContain('actualizado hace 2 min');
    expect(out).toContain('aria-hidden="true"');
  });

  it('English: «Live · updated 2 min ago»', () => {
    const out = view('en', { lastOkAt: Date.now() - 125_000 });
    expect(out).toContain('Live');
    expect(out).toContain('updated 2 min ago');
  });

  it('seconds and hours read in their own unit', () => {
    expect(view('es', { lastOkAt: Date.now() - 4_000 })).toMatch(/hace [3-5] s/);
    expect(view('es', { lastOkAt: Date.now() - 2 * 3_600_000 - 5_000 })).toContain('hace 2 h');
  });

  it('when the last refresh failed it says so and gives the age of the data on screen, instead of «live»', () => {
    const out = view('es', { lastOkAt: Date.now() - 65_000, failing: true });
    expect(out).toContain('Sin conexión · últimos datos hace 1 min');
    expect(out).not.toContain('En vivo');
    expect(out).not.toContain('actualizado');
  });

  it('counts the new readings with the thousands separator of the language, only when there are some', () => {
    expect(view('es', { lastOkAt: Date.now(), added: 0 })).not.toContain('Lecturas nuevas');
    expect(view('es', { lastOkAt: Date.now(), added: 1250 })).toContain('Lecturas nuevas desde que abriste esta pantalla: 1.250');
    expect(view('en', { lastOkAt: Date.now(), added: 1250 })).toContain('New readings since you opened this screen: 1,250');
  });

  it('screen readers hear only STATE changes: two polite regions whose text does not include the ticking age', () => {
    const out = view('es', { lastOkAt: Date.now() - 125_000, added: 21 });
    expect((out.match(/role="status"/g) ?? []).length).toBe(2);
    const live = [...out.matchAll(/<span class="[^"]*sr[^"]*" role="status">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(live[0]).toBe('Los datos se actualizan solos');
    expect(live[1]).toContain('Lecturas nuevas');
    expect(live.join(' ')).not.toMatch(/hace \d/);
  });
});

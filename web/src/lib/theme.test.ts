import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { applyTheme, DEFAULT_THEME, isTheme, THEMES, ThemeRoot } from './theme';

const root = (): ThemeRoot => ({ dataset: {}, style: { colorScheme: '' } });

describe('isTheme / THEMES', () => {
  it('knows the three themes and starts on «system»', () => { expect([...THEMES]).toEqual(['system', 'light', 'dark']); expect(DEFAULT_THEME).toBe('system'); });
  it.each(['system', 'light', 'dark'])('accepts %s', (v) => expect(isTheme(v)).toBe(true));
  it.each([['auto'], ['Dark'], ['DARK'], [''], [' dark'], [null], [undefined], [1], [['dark']], [{}]])('rejects %j', (v) => expect(isTheme(v)).toBe(false));
});

describe('applyTheme', () => {
  it('«dark» and «light» are written on the document, so they win over the mode of the computer', () => {
    const r = root();
    applyTheme('dark', r); expect(r.dataset.theme).toBe('dark'); expect(r.style.colorScheme).toBe('dark');
    applyTheme('light', r); expect(r.dataset.theme).toBe('light'); expect(r.style.colorScheme).toBe('light');
  });
  it('«system» removes both, so the style sheet goes back to following the computer', () => {
    const r = root(); applyTheme('dark', r); applyTheme('system', r);
    expect('theme' in r.dataset).toBe(false); expect(r.style.colorScheme).toBe('');
  });
  it('is idempotent and does not leave a stale value behind when going dark → system → light', () => {
    const r = root(); applyTheme('dark', r); applyTheme('dark', r); applyTheme('system', r); applyTheme('light', r);
    expect(r.dataset.theme).toBe('light'); expect(r.style.colorScheme).toBe('light');
  });
  it('does not touch any other attribute of the document', () => {
    const r = root(); r.dataset.other = 'x'; applyTheme('dark', r); applyTheme('system', r);
    expect(r.dataset).toEqual({ other: 'x' });
  });
});

describe('theme texts', () => {
  const es = makeT('es'), en = makeT('en');
  it('has the three names and the notices in both languages', () => {
    expect([es('theme.system'), es('theme.light'), es('theme.dark')]).toEqual(['Sistema', 'Claro', 'Oscuro']);
    expect([en('theme.system'), en('theme.light'), en('theme.dark')]).toEqual(['System', 'Light', 'Dark']);
    expect(es('theme.saved', { theme: es('theme.dark') })).toBe('Tema cambiado a Oscuro.');
    expect(en('theme.saved', { theme: en('theme.dark') })).toBe('Theme changed to Dark.');
    expect(es('theme.error', { reason: 'x' })).toContain('x'); expect(en('theme.error', { reason: 'x' })).toContain('x');
  });
});

describe('tokens.css: the dark palette', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
  const declarations = (selector: string) => {
    const at = css.indexOf(selector); expect(at, `no encontré «${selector}»`).toBeGreaterThan(-1);
    const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
    return Object.fromEntries([...body.matchAll(/(--[\w-]+|color-scheme):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  };
  const light = declarations(':root {');
  const byTheme = declarations(':root[data-theme="dark"]');
  const bySystem = declarations(':root:not([data-theme="light"])');

  it('the dark palette chosen by the person and the one followed from the computer are exactly the same', () => { expect(bySystem).toEqual(byTheme); });
  it('every color of the light palette has its dark pair (nothing stays light on a dark screen)', () => {
    const colors = Object.keys(light).filter((k) => /^--(bg|surface|surface-2|fg|muted|line|navy|accent|accent-soft|on-accent|ok|ok-soft|warn|warn-soft|bad|bad-soft)$/.test(k));
    expect(colors.length).toBe(16);
    expect(colors.filter((k) => !(k in byTheme))).toEqual([]);
  });
  it('the dark palette changes the colors and only the colors (sizes and spacing do not move with the theme)', () => {
    expect(Object.keys(byTheme).filter((k) => /^--(fs|sp|radius|font|mono)/.test(k))).toEqual([]);
    expect(byTheme['color-scheme']).toBe('dark'); expect(light['color-scheme']).toBe('light');
  });
  it('forcing «light» switches the follow-the-computer palette off', () => { expect(css).toContain('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"])'); });
});

import type { ReactElement } from 'react';

export type IconName = 'grid' | 'network' | 'users' | 'layers' | 'clock' | 'document' | 'check' | 'hourglass' | 'receipt' | 'signal' | 'pulse' | 'warning' | 'alert' | 'bell';

const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;

/** Íconos de la app (tarjetas de indicadores y menú): solo decoran, el nombre ya está escrito al lado. */
const icons: Record<IconName, ReactElement> = {
  grid: <svg {...base}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>,
  network: <svg {...base}><circle cx="12" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" /><path d="M12 7v5M12 12l-6 5M12 12l6 5" /></svg>,
  users: <svg {...base}><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 5.3a3 3 0 0 1 0 5.4M18 14.3c2 .7 3 2.6 3 5.7" /></svg>,
  layers: <svg {...base}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></svg>,
  clock: <svg {...base}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>,
  document: <svg {...base}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M9.5 12h5M9.5 16h5" /></svg>,
  check: <svg {...base}><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.4 2.4 4.6-4.8" /></svg>,
  hourglass: <svg {...base}><path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9" /></svg>,
  receipt: <svg {...base}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>,
  signal: <svg {...base}><path d="M5 12.5a10 10 0 0 1 14 0M8 15.5a6 6 0 0 1 8 0" /><circle cx="12" cy="19" r="1" /></svg>,
  pulse: <svg {...base}><path d="M3 12h4l2.5-6 4 12 2.5-6H21" /></svg>,
  warning: <svg {...base}><path d="M12 4 3 20h18z" /><path d="M12 10v4M12 17.2v.1" /></svg>,
  bell: <svg {...base}><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z" /><path d="M10 21h4" /></svg>,
  alert: <svg {...base}><path d="M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7z" /><path d="M12 8v5M12 16.2v.1" /></svg>,
};

export const icon = (name: IconName): ReactElement => icons[name];

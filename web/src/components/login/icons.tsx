/** Íconos de línea del login: decorativos (el texto los acompaña), heredan el color del texto. */
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;

export const MailIcon = () => <svg {...base}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7.5 8 5.5 8-5.5" /></svg>;
export const LockIcon = () => <svg {...base}><rect x="4.5" y="10.5" width="15" height="10" rx="3" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>;
export const EyeIcon = () => <svg {...base}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></svg>;
export const EyeOffIcon = () => <svg {...base}><path d="M4 4l16 16" /><path d="M9.9 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.8M6.2 7.6A15.7 15.7 0 0 0 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.3 3.8-.8" /><path d="M9.9 9.9a2.8 2.8 0 0 0 4 4" /></svg>;
export const ShieldIcon = () => <svg {...base}><path d="M12 3 5 6v5.5c0 4.3 2.9 7.6 7 9.5 4.1-1.9 7-5.2 7-9.5V6l-7-3Z" /><path d="m9 12 2.2 2.2L15.2 10" /></svg>;
export const LayersIcon = () => <svg {...base}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></svg>;
export const PulseIcon = () => <svg {...base}><path d="M3 12h4l2.5-6 4 12 2.5-6H21" /></svg>;

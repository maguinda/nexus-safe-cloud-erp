import type { ReactNode } from 'react';
import { icon as iconOf, type IconName } from '../Icons';
import s from './StatusChip.module.css';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
const DEFAULT_ICON: Record<Tone, IconName> = { ok: 'check', warn: 'warning', bad: 'alert', info: 'clock', neutral: 'hourglass' };

/** Estado con semáforo: el color nunca va solo, siempre lo acompañan un ícono y el texto. */
export function StatusChip({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: IconName | null }) {
  const name = icon === undefined ? DEFAULT_ICON[tone] : icon;
  return <span className={s[tone]} data-tone={tone}>{name && iconOf(name)}{children}</span>;
}

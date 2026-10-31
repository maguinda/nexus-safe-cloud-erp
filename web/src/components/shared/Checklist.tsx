import type { ReactNode } from 'react';
import { icon as iconOf, type IconName } from '../Icons';
import s from './Checklist.module.css';

export type CheckState = 'done' | 'doing' | 'todo' | 'bad';
export interface CheckItem { key: string; state: CheckState; label: ReactNode; detail?: ReactNode; trailing?: ReactNode }
const ICON: Record<CheckState, IconName> = { done: 'check', doing: 'clock', todo: 'hourglass', bad: 'alert' };

/** Lista de verificación: lo que se hizo (✓), lo que se está haciendo, lo que falta y lo que está mal. El estado se dice también con texto oculto, no solo con el ícono. */
export function Checklist({ items, labels, ariaLabel }: { items: CheckItem[]; labels: Record<CheckState, string>; ariaLabel: string }) {
  return (
    <ul className={s.list} aria-label={ariaLabel}>
      {items.map((i) => (
        <li key={i.key} className={s.item} data-state={i.state}>
          <span className={i.state === 'todo' ? s.mark : s[i.state]} aria-hidden="true">{iconOf(ICON[i.state])}</span>
          <span className={s.sr}>{labels[i.state]}: </span>
          <span className={s.text}>{i.label}{i.detail && <><br /><span className={s.detail}>{i.detail}</span></>}</span>
          {i.trailing}
        </li>
      ))}
    </ul>
  );
}

import type { MsgKey, TFn } from '../../i18n';
import s from './login.module.css';

// El botón lleva el nombre del rol (se traduce); el correo es de la cuenta de demostración.
export const DEMO: { email: string; label: MsgKey }[] = [
  { email: 'laura.rios@nexus.example', label: 'role.project_lead' },
  { email: 'andres.mora@nexus.example', label: 'role.billing_analyst' },
  { email: 'camila.soto@nexus.example', label: 'role.sales' },
  { email: 'diana.vega@nexus.example', label: 'role.manager' },
];

const AVATARS = [s.avatar1, s.avatar2, s.avatar3, s.avatar4];

/** Cuentas de demostración: cada botón rellena el correo de ese rol. */
export function DemoAccounts({ onPick, t }: { onPick: (email: string) => void; t: TFn }) {
  return (
    <div className={s.demo}>
      <p className={s.demoTitle} id="demo-title">{t('login.demoAccounts')}</p>
      <div className={s.demoList} role="group" aria-labelledby="demo-title">
        {DEMO.map((d, i) => <button key={d.email} type="button" className={s.demoBtn} onClick={() => onPick(d.email)}><span className={AVATARS[i]} aria-hidden>{t(d.label).charAt(0)}</span><span>{t(d.label)}</span></button>)}
      </div>
    </div>
  );
}

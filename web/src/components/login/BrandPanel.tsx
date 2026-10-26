import type { TFn } from '../../i18n';
import { LayersIcon, PulseIcon, ShieldIcon } from './icons';
import s from './login.module.css';

const POINTS = [
  { icon: <ShieldIcon />, text: 'login.brand.p1' },
  { icon: <LayersIcon />, text: 'login.brand.p2' },
  { icon: <PulseIcon />, text: 'login.brand.p3' },
] as const;

/** El lado de la marca: una frase y tres razones. La barra de la app ya trae el nombre; este panel aparece desde 900 px. */
export function BrandPanel({ t }: { t: TFn }) {
  return (
    <aside className={s.brand} aria-label={t('app.name')}>
      <div className={s.brandBody}>
        <p className={s.tagline}>{t('login.brand.tagline')}</p>
        <ul className={s.points}>
          {POINTS.map((p) => <li key={p.text}><span className={s.pointIcon}>{p.icon}</span><span>{t(p.text)}</span></li>)}
        </ul>
      </div>
    </aside>
  );
}

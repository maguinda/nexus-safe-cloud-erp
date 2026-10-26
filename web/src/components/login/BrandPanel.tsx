import type { TFn } from '../../i18n';
import { Hero } from './Hero';
import { LayersIcon, PulseIcon, ShieldIcon } from './icons';
import s from './login.module.css';

const POINTS = [
  { icon: <ShieldIcon />, text: 'login.brand.p1' },
  { icon: <LayersIcon />, text: 'login.brand.p2' },
  { icon: <PulseIcon />, text: 'login.brand.p3' },
] as const;

/** El lado de la marca: la ilustración, una frase y tres razones. En celular solo se ve una franja con la ilustración; la frase y las razones aparecen desde 900 px. */
export function BrandPanel({ t }: { t: TFn }) {
  return (
    <aside className={s.brand} aria-label={t('app.name')}>
      <div className={s.brandArt}><Hero t={t} /></div>
      <div className={s.brandBody}>
        <p className={s.tagline}>{t('login.brand.tagline')}</p>
        <ul className={s.points}>
          {POINTS.map((p) => <li key={p.text}><span className={s.pointIcon}>{p.icon}</span><span>{t(p.text)}</span></li>)}
        </ul>
      </div>
    </aside>
  );
}

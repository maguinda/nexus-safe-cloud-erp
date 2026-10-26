import type { TFn } from '../../i18n';
import s from './hero.module.css';

/** Un nodo de la red: tarjeta de vidrio con un ícono de línea (dibujado en una cuadrícula de 24). */
function Node({ x, y, label, children }: { x: number; y: number; label: string; children: React.ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={s.node}>
        <rect className={s.nodeCard} x="-34" y="-34" width="68" height="68" rx="18" />
        <g className={s.nodeIcon} transform="translate(-14 -14) scale(1.1667)">{children}</g>
        <title>{label}</title>
      </g>
    </g>
  );
}

/**
 * La ilustración del panel de marca: una nube con escudo en el centro, conectada con líneas de circuito a un servidor, un sensor, un switch y una cerradura
 * (lo que gestiona el ERP). Es decorativa (aria-hidden): el mensaje lo dicen la frase y las razones. Sin cifras: en el login no hay datos reales.
 */
export function Hero({ t }: { t: TFn }) {
  return (
    <div className={s.hero} aria-hidden>
      <svg className={s.art} viewBox="0 0 520 440" focusable="false">
        <defs>
          <linearGradient id="hero-cloud" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className={s.cloudA} />
            <stop offset="1" className={s.cloudB} />
          </linearGradient>
          <radialGradient id="hero-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0" className={s.glowA} />
            <stop offset="1" className={s.glowB} />
          </radialGradient>
        </defs>
        <circle className={s.glow} cx="260" cy="205" r="190" fill="url(#hero-glow)" />
        <g className={s.wires}>
          <path d="M260 205 H190 V110 H124" />
          <path d="M260 205 H340 V96 H400" />
          <path d="M260 205 H182 V318 H118" />
          <path d="M260 205 H346 V334 H408" />
        </g>
        <g className={s.pulses}>
          <path className={s.pulse1} d="M260 205 H190 V110 H124" />
          <path className={s.pulse2} d="M260 205 H340 V96 H400" />
          <path className={s.pulse3} d="M260 205 H182 V318 H118" />
          <path className={s.pulse4} d="M260 205 H346 V334 H408" />
        </g>
        <Node x={90} y={110} label={t('login.chip.zt')}>
          <rect x="4.5" y="10.5" width="15" height="10" rx="3" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
        </Node>
        <Node x={434} y={96} label={t('login.chip.telemetry')}>
          <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />
        </Node>
        <Node x={84} y={318} label={t('login.chip.billing')}>
          <rect x="4" y="3.5" width="16" height="17" rx="3" /><path d="M8 9h8M8 13h8M8 17h4" />
        </Node>
        <Node x={442} y={334} label={t('login.chip.network')}>
          <rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 14v-3M12 14V8M17 14v-3M6 6.5a8.5 8.5 0 0 1 12 0" />
        </Node>
        <g className={s.cloudWrap}>
          <path className={s.cloud} d="M196 244a42 42 0 0 1 6-83 62 62 0 0 1 116-6 48 48 0 0 1 8 89z" fill="url(#hero-cloud)" />
          <g className={s.shield} transform="translate(236 168) scale(1.7)">
            <path d="M12 3 5 6v5.5c0 4.3 2.9 7.6 7 9.5 4.1-1.9 7-5.2 7-9.5V6l-7-3Z" /><path d="m9 12 2.2 2.2L15.2 10" />
          </g>
        </g>
      </svg>
      <ul className={s.chips}>
        <li className={s.chip1}>{t('login.chip.zt')}</li>
        <li className={s.chip2}>{t('login.chip.telemetry')}</li>
        <li className={s.chip3}>{t('login.chip.billing')}</li>
      </ul>
    </div>
  );
}

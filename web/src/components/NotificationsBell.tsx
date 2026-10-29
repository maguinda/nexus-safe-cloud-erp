import { useEffect, useId, useRef, useState } from 'react';
import { useNotifications } from '../hooks/useNotifications';
import { timeAgo } from '../lib/format';
import { notificationText } from '../lib/notifications';
import { useSession } from '../session';
import { icon } from './Icons';
import s from './NotificationsBell.module.css';

const SEVERITY_KEY = { info: 'notif.severity.info', warning: 'notif.severity.warning', critical: 'notif.severity.critical' } as const;

/** La campana del encabezado: cuántos avisos sin leer hay y, al abrirla, la lista (cada rol ve los suyos; las marcas de lectura son de cada persona). */
export function NotificationsBell() {
  const { t, lang } = useSession();
  const [open, setOpen] = useState(false);
  const { unread, page, error, markRead, markAll, showMore } = useNotifications(open);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const close = (back: boolean) => { setOpen(false); if (back) trigger.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true); };
    const outside = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) close(false); };
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', outside);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', outside); };
  }, [open]);

  const now = Date.now();
  const items = page?.items ?? [];
  return (
    <div className={s.wrap} ref={root}>
      <button
        ref={trigger} type="button" className={s.trigger} aria-haspopup="dialog" aria-expanded={open}
        aria-label={unread > 0 ? t('notif.open', { n: unread }) : t('notif.openNone')} onClick={() => (open ? close(false) : setOpen(true))}
      >
        {icon('bell')}
        {unread > 0 && <span className={s.badge} aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className={s.panel} role="dialog" aria-labelledby={titleId}>
          <div className={s.head}>
            <h2 className={s.title} id={titleId}>{t('notif.title')}</h2>
            {unread > 0 && <button type="button" className={s.act} onClick={() => void markAll()}>{t('notif.markAll')}</button>}
          </div>
          {error && <p className={s.error} role="alert">{t('notif.error', { reason: error })}</p>}
          {!page && !error && <p className={s.empty}>{t('notif.loading')}</p>}
          {page && items.length === 0 && <p className={s.empty}>{t('notif.empty')}</p>}
          {items.length > 0 && (
            <ul className={s.list}>
              {items.map((n) => (
                <li key={n.id} className={`${s.item} ${s[n.severity] ?? ''} ${n.read ? '' : s.unread}`} data-kind={n.kind} data-read={n.read}>
                  <div className={s.meta}>
                    <span className={s.tag}>{t(SEVERITY_KEY[n.severity] ?? 'notif.severity.info')}</span>
                    {!n.read && <span>· {t('notif.unread')}</span>}
                    <span>· {timeAgo(n.occurredAt, now, t)}</span>
                  </div>
                  <p className={s.text}>{notificationText(n, t, lang)}</p>
                  {!n.read && <button type="button" className={s.act} onClick={() => void markRead(n.id)}>{t('notif.markOne')}</button>}
                </li>
              ))}
            </ul>
          )}
          {page && page.total > items.length && items.length < 100 && <button type="button" className={s.act} onClick={showMore}>{t('notif.more')}</button>}
        </div>
      )}
    </div>
  );
}

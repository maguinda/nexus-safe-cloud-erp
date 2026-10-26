import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { errorText, serverText } from '../i18n/server';
import { formatDay } from '../lib/format';
import { roleKey } from '../lib/types';
import type { ManagedUser } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import { ChangeRoleForm, NewUserForm } from './UserForms';
import s from './UsersView.module.css';

/** Administración de usuarios: solo el gerente (la API lo exige y vuelve a mirar su rol en la base en cada acción). */
export function UsersView({ toast }: { toast: (m: string) => void }) {
  const { api, user, t, lang } = useSession();
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState('');
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    try {
      const list = await api.users();
      if (alive.current) { setUsers(list); setError(''); setDenied(''); }
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.status === 403) setDenied(serverText(e.message, t));
      else setError(errorText(e, t, 'users.loadError'));
    }
  }, [api, t]);
  useEffect(() => { void load(); }, [load]);

  if (denied) {
    return (
      <div className={ui.panelError} role="alert">
        <strong>{t('users.forbiddenTitle')}</strong>
        <span>{denied} {t('users.forbiddenDetail')}</span>
      </div>
    );
  }
  if (error) return <div className={ui.panelError} role="alert"><strong>{t('users.somethingWrong')}</strong><span>{error}</span><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('users.tryAgain')}</button></div>;

  const newestFirst = [...(users ?? [])].reverse();

  return (
    <section aria-labelledby="users-h" className={s.stack}>
      <h2 id="users-h" className={ui.h2}>{t('users.title')}</h2>
      <NewUserForm api={api} onCreated={(u) => { toast(t('users.createdAs', { name: u.name, role: t(roleKey(u.role)) })); void load(); }} />
      {editing && (
        <ChangeRoleForm key={editing.id} api={api} user={editing} onCancel={() => setEditing(null)}
          onSaved={(u) => { toast(t('users.nowRole', { name: u.name, role: t(roleKey(u.role)) })); setEditing(null); void load(); }} />
      )}
      {users === null ? <p role="status" className={ui.muted}>{t('users.loading')}</p> : (
        <div className={ui.scrollTall}>
          <table className={`${ui.tableDense} ${ui.cardsOnPhone} ${s.tableCards}`}>
            <caption className={s.sr}>{t('users.caption', { n: users.length })}</caption>
            <thead><tr><th>{t('users.col.name')}</th><th>{t('users.col.email')}</th><th>{t('users.col.role')}</th><th>{t('users.col.created')}</th><th>{t('users.col.action')}</th></tr></thead>
            <tbody>
              {newestFirst.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td data-label={t('users.col.email')}>{u.email}</td>
                  <td data-label={t('users.col.role')}><span className={ui.draft}>{t(roleKey(u.role))}</span></td>
                  <td className={ui.muted} data-label={t('users.col.created')}>{formatDay(u.createdAt, lang)}</td>
                  <td data-label={t('users.col.action')}>{u.email === user?.email
                    ? <span className={ui.muted}>{t('users.you')}</span>
                    : <button type="button" className={ui.btnGhost} onClick={() => setEditing(u)} aria-label={t('users.changeRoleFor', { name: u.name })}>{t('users.changeRole')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={ui.muted}>{t('users.footNote')}</p>
    </section>
  );
}

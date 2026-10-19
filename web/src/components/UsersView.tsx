import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { formatDay } from '../lib/format';
import { ROLE_LABEL } from '../lib/types';
import type { ManagedUser } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import { ChangeRoleForm, NewUserForm } from './UserForms';
import s from './UsersView.module.css';

/** Administración de usuarios: solo el gerente (la API lo exige y vuelve a mirar su rol en la base en cada acción). */
export function UsersView({ toast }: { toast: (m: string) => void }) {
  const { api, user } = useSession();
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
      if (e instanceof ApiError && e.status === 403) setDenied(e.message);
      else setError(e instanceof ApiError ? e.message : 'We could not load the users. Check your connection.');
    }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  if (denied) {
    return (
      <div className={ui.panelError} role="alert">
        <strong>403 Forbidden</strong>
        <span>{denied} The API checks your role in the database on every request, not only the menu.</span>
      </div>
    );
  }
  if (error) return <div className={ui.panelError} role="alert"><strong>Something went wrong</strong><span>{error}</span><button type="button" className={ui.btnGhost} onClick={() => void load()}>Try again</button></div>;

  const newestFirst = [...(users ?? [])].reverse();

  return (
    <section aria-labelledby="users-h" className={s.stack}>
      <h2 id="users-h" className={ui.h2}>Users</h2>
      <NewUserForm api={api} onCreated={(u) => { toast(`${u.name} created as ${ROLE_LABEL[u.role]}`); void load(); }} />
      {editing && (
        <ChangeRoleForm key={editing.id} api={api} user={editing} onCancel={() => setEditing(null)}
          onSaved={(u) => { toast(`${u.name} is now ${ROLE_LABEL[u.role]} (from their next sign-in)`); setEditing(null); void load(); }} />
      )}
      {users === null ? <p role="status" className={ui.muted}>Loading users…</p> : (
        <div className={ui.scrollTall}>
          <table className={`${ui.tableDense} ${ui.cardsOnPhone} ${s.tableCards}`}>
            <caption className={s.sr}>Users, newest first ({users.length})</caption>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Created</th><th>Action</th></tr></thead>
            <tbody>
              {newestFirst.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td data-label="Email">{u.email}</td>
                  <td data-label="Role"><span className={ui.draft}>{ROLE_LABEL[u.role]}</span></td>
                  <td className={ui.muted} data-label="Created">{formatDay(u.createdAt)}</td>
                  <td data-label="Action">{u.email === user?.email
                    ? <span className={ui.muted}>You</span>
                    : <button type="button" className={ui.btnGhost} onClick={() => setEditing(u)} aria-label={`Change role for ${u.name}`}>Change role</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={ui.muted}>A new person can sign in right away with the initial password you set. A role change applies from their next sign-in.</p>
    </section>
  );
}

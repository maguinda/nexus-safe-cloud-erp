import { useCallback, useState } from 'react';
import { DashboardView } from './components/DashboardView';
import { InvoicesView } from './components/InvoicesView';
import { JwtPanel } from './components/JwtPanel';
import { LoginView } from './components/LoginView';
import { ProjectsView } from './components/ProjectsView';
import { Toast } from './components/Toast';
import { mmss } from './lib/format';
import { ROLE_LABEL } from './lib/types';
import { SessionProvider, useSession } from './session';
import s from './App.module.css';

type View = 'projects' | 'invoices';
// El gerente solo ve el dashboard (la API responde 403 al resto de sus rutas); los demás roles no tienen esa pestaña.

function Shell() {
  const { user, secondsLeft, signOut } = useSession();
  const [view, setView] = useState<View>('projects');
  const [toast, setToast] = useState('');
  const isManager = user?.role === 'manager';
  const clear = useCallback(() => setToast(''), []);

  return (
    <div className={s.app}>
      <header className={s.top}>
        <div className={s.brand}><span className={s.logo} aria-hidden>VS</span><span>Nexus Safe-Cloud ERP</span></div>
        <span className={s.sp} />
        {user && (
          <>
            <span className={s.chip}>{ROLE_LABEL[user.role]}</span>
            <span className={s.chip}>token expires in {mmss(secondsLeft)}</span>
            <button type="button" className={s.out} onClick={signOut}>Sign out</button>
          </>
        )}
      </header>

      {!user ? <LoginView /> : (
        <div className={s.body}>
          <nav className={s.nav} aria-label="Modules">
            {isManager
              ? <button type="button" aria-current="page">Dashboard</button>
              : (
                <>
                  <button type="button" aria-current={view === 'projects' ? 'page' : undefined} onClick={() => setView('projects')}>Projects</button>
                  <button type="button" aria-current={view === 'invoices' ? 'page' : undefined} onClick={() => setView('invoices')}>Invoices</button>
                </>
              )}
          </nav>
          <main className={s.content}>
            {isManager ? <DashboardView key="d" /> : view === 'projects' ? <ProjectsView key="p" toast={setToast} /> : <InvoicesView key="i" toast={setToast} />}
            <JwtPanel />
          </main>
        </div>
      )}
      <Toast message={toast} onDone={clear} />
    </div>
  );
}

export default function App() {
  return <SessionProvider><Shell /></SessionProvider>;
}

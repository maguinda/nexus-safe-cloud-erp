import { useCallback, useState } from 'react';
import { DashboardView } from './components/DashboardView';
import { InvoicesView } from './components/InvoicesView';
import { JwtPanel } from './components/JwtPanel';
import { LoginView } from './components/LoginView';
import { NetworkView } from './components/NetworkView';
import { ProjectsView } from './components/ProjectsView';
import { SensorsView } from './components/SensorsView';
import { ProfileMenu } from './components/ProfileMenu';
import { Toast } from './components/Toast';
import { UsersView } from './components/UsersView';
import { mmss } from './lib/format';
import { SessionProvider, useSession } from './session';
import s from './App.module.css';

type View = 'projects' | 'invoices';
type ManagerView = 'dashboard' | 'sensors' | 'network' | 'users';
// El gerente ve el dashboard y administra usuarios (la API responde 403 al resto de sus rutas); los demás roles no tienen esas pestañas.

function Shell() {
  const { user, secondsLeft, signOut, t } = useSession();
  const [view, setView] = useState<View>('projects');
  const [managerView, setManagerView] = useState<ManagerView>('dashboard');
  const [toast, setToast] = useState('');
  const isManager = user?.role === 'manager';
  const clear = useCallback(() => setToast(''), []);

  return (
    <div className={s.app}>
      <header className={s.top}>
        <div className={s.brand}><span className={s.logo} aria-hidden>VS</span><span>{t('app.name')}</span></div>
        <span className={s.sp} />
        {user && (
          <>
            <ProfileMenu onChanged={setToast} />
            <span className={s.chip}>{t('header.tokenExpires', { time: mmss(secondsLeft) })}</span>
            <button type="button" className={s.out} onClick={signOut}>{t('header.signOut')}</button>
          </>
        )}
      </header>

      {!user ? <LoginView /> : (
        <div className={s.body}>
          <nav className={s.nav} aria-label={t('nav.modules')}>
            {isManager
              ? (
                <>
                  <button type="button" aria-current={managerView === 'dashboard' ? 'page' : undefined} onClick={() => setManagerView('dashboard')}>{t('nav.dashboard')}</button>
                  <button type="button" aria-current={managerView === 'sensors' ? 'page' : undefined} onClick={() => setManagerView('sensors')}>{t('nav.sensors')}</button>
                  <button type="button" aria-current={managerView === 'network' ? 'page' : undefined} onClick={() => setManagerView('network')}>{t('nav.network')}</button>
                  <button type="button" aria-current={managerView === 'users' ? 'page' : undefined} onClick={() => setManagerView('users')}>{t('nav.users')}</button>
                </>
              )
              : (
                <>
                  <button type="button" aria-current={view === 'projects' ? 'page' : undefined} onClick={() => setView('projects')}>{t('nav.projects')}</button>
                  <button type="button" aria-current={view === 'invoices' ? 'page' : undefined} onClick={() => setView('invoices')}>{t('nav.invoices')}</button>
                </>
              )}
          </nav>
          <main className={s.content}>
            {isManager ? (managerView === 'users' ? <UsersView key="u" toast={setToast} /> : managerView === 'sensors' ? <SensorsView key="s" /> : managerView === 'network' ? <NetworkView key="n" /> : <DashboardView key="d" />) : view === 'projects' ? <ProjectsView key="p" toast={setToast} /> : <InvoicesView key="i" toast={setToast} />}
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

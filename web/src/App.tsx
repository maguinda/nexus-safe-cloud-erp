import { Fragment, useCallback, useState } from 'react';
import { AdvisorPanel } from './components/advisor/AdvisorPanel';
import { DashboardView } from './components/DashboardView';
import { InvoicesView } from './components/InvoicesView';
import { JwtPanel } from './components/JwtPanel';
import { LoginView } from './components/LoginView';
import { NetworkView } from './components/NetworkView';
import { ProjectsView } from './components/ProjectsView';
import { SensorsView } from './components/SensorsView';
import { NotificationsBell } from './components/NotificationsBell';
import { CapacityView } from './components/CapacityView';
import { ProcurementView } from './components/ProcurementView';
import { ContractsView } from './components/ContractsView';
import { QuotesView } from './components/QuotesView';
import { PayrollView } from './components/PayrollView';
import { PayablesView } from './components/PayablesView';
import { CashflowView } from './components/CashflowView';
import { ProfitabilityView } from './components/ProfitabilityView';
import { AuditView } from './components/AuditView';
import { CamerasView } from './components/CamerasView';
import { WorkOrdersView } from './components/WorkOrdersView';
import { ProfileMenu } from './components/ProfileMenu';
import { icon, type IconName } from './components/Icons';
import { Toast } from './components/Toast';
import { UsersView } from './components/UsersView';
import type { MsgKey } from './i18n';
import { mmss } from './lib/format';
import { SessionProvider, useSession } from './session';
import s from './App.module.css';

type View = 'projects' | 'invoices' | 'contracts' | 'capacity' | 'procurement' | 'workorders' | 'quotes' | 'payroll' | 'payables' | 'cashflow';
type ManagerView = 'dashboard' | 'quotes' | 'payroll' | 'payables' | 'cashflow' | 'contracts' | 'profitability' | 'audit' | 'cameras' | 'workorders' | 'sensors' | 'network' | 'capacity' | 'procurement' | 'users';
interface NavItem { label: MsgKey; icon: IconName; on: boolean; go: () => void }
interface NavGroup { label?: MsgKey; items: NavItem[] }
// El gerente ve el dashboard y administra usuarios (la API responde 403 al resto de sus rutas); los demás roles no tienen esas pestañas.

function Shell() {
  const { user, secondsLeft, signOut, t, booting } = useSession();
  const [view, setView] = useState<View>('projects');
  const [managerView, setManagerView] = useState<ManagerView>('dashboard');
  const [toast, setToast] = useState('');
  const isManager = user?.role === 'manager';
  const clear = useCallback(() => setToast(''), []);
  // El gerente ve el tablero, los datos de Nexus y la administración (con una etiqueta por grupo); los demás roles, sus dos pantallas de trabajo.
  const groups: NavGroup[] = isManager
    ? [
      { items: [{ label: 'nav.dashboard', icon: 'grid', on: managerView === 'dashboard', go: () => setManagerView('dashboard') }] },
      { label: 'nav.group.business', items: [{ label: 'nav.quotes', icon: 'receipt', on: managerView === 'quotes', go: () => setManagerView('quotes') }, { label: 'nav.payroll', icon: 'users', on: managerView === 'payroll', go: () => setManagerView('payroll') }, { label: 'nav.payables', icon: 'receipt', on: managerView === 'payables', go: () => setManagerView('payables') }, { label: 'nav.cashflow', icon: 'grid', on: managerView === 'cashflow', go: () => setManagerView('cashflow') }, { label: 'nav.contracts', icon: 'receipt', on: managerView === 'contracts', go: () => setManagerView('contracts') }, { label: 'nav.profitability', icon: 'grid', on: managerView === 'profitability', go: () => setManagerView('profitability') }] },
      { label: 'nav.group.data', items: [{ label: 'nav.sensors', icon: 'pulse', on: managerView === 'sensors', go: () => setManagerView('sensors') }, { label: 'nav.network', icon: 'network', on: managerView === 'network', go: () => setManagerView('network') }, { label: 'nav.cameras', icon: 'pulse', on: managerView === 'cameras', go: () => setManagerView('cameras') }, { label: 'nav.workorders', icon: 'layers', on: managerView === 'workorders', go: () => setManagerView('workorders') }] },
      { label: 'nav.group.team', items: [{ label: 'nav.capacity', icon: 'users', on: managerView === 'capacity', go: () => setManagerView('capacity') }, { label: 'nav.procurement', icon: 'layers', on: managerView === 'procurement', go: () => setManagerView('procurement') }] },
      { label: 'nav.group.admin', items: [{ label: 'nav.users', icon: 'users', on: managerView === 'users', go: () => setManagerView('users') }, { label: 'nav.audit', icon: 'grid', on: managerView === 'audit', go: () => setManagerView('audit') }] },
    ]
    : user?.role === 'finance'
    ? [{ items: [{ label: 'nav.payroll', icon: 'users', on: view !== 'payables' && view !== 'cashflow', go: () => setView('payroll') }, { label: 'nav.payables', icon: 'receipt', on: view === 'payables', go: () => setView('payables') }, { label: 'nav.cashflow', icon: 'grid', on: view === 'cashflow', go: () => setView('cashflow') }] }]
    : [{ items: [{ label: 'nav.projects', icon: 'layers', on: view === 'projects', go: () => setView('projects') }, { label: 'nav.invoices', icon: 'receipt', on: view === 'invoices', go: () => setView('invoices') },
      // Ventas y el líder de proyecto ven las cotizaciones (el líder solo las lee); facturación no.
      ...(user?.role === 'sales' || user?.role === 'project_lead' ? [{ label: 'nav.quotes' as const, icon: 'receipt' as const, on: view === 'quotes', go: () => setView('quotes') }] : []),
      // Ventas no ve los contratos (la API le responde 403).
      ...(user?.role === 'sales' ? [] : [{ label: 'nav.contracts' as const, icon: 'receipt' as const, on: view === 'contracts', go: () => setView('contracts') }]),
      // Facturación no ve la capacidad técnica (la API le responde 403).
      ...(user?.role === 'billing_analyst' ? [] : [{ label: 'nav.capacity' as const, icon: 'users' as const, on: view === 'capacity', go: () => setView('capacity') }]),
      // Solo el líder de proyecto ve las órdenes de trabajo (solo lectura); los demás reciben 403.
      ...(user?.role === 'project_lead' ? [{ label: 'nav.workorders' as const, icon: 'layers' as const, on: view === 'workorders', go: () => setView('workorders') }] : []),
      // Ventas no ve las compras (la API le responde 403).
      ...(user?.role === 'sales' ? [] : [{ label: 'nav.procurement' as const, icon: 'layers' as const, on: view === 'procurement', go: () => setView('procurement') }])] }];

  return (
    <div className={s.app}>
      <header className={s.top}>
        <div className={s.brand}><span className={s.logo} aria-hidden>VS</span><span>{t('app.name')}</span></div>
        <span className={s.sp} />
        {user && (
          <>
            <NotificationsBell />
            <ProfileMenu onChanged={setToast} />
            <span className={s.chip}>{t('header.tokenExpires', { time: mmss(secondsLeft) })}</span>
            <button type="button" className={s.out} onClick={signOut}>{t('header.signOut')}</button>
          </>
        )}
      </header>

      {booting ? null : !user ? <LoginView /> : (
        <div className={s.body}>
          <nav className={s.nav} aria-label={t('nav.modules')}>
            <div className={s.navStick}>
              {groups.map((g, gi) => (
                <div key={gi} className={s.navGroup} role={g.label ? 'group' : undefined} aria-label={g.label ? t(g.label) : undefined}>
                  {g.label && <span className={s.navLabel} aria-hidden="true">{t(g.label)}</span>}
                  {g.items.map((it) => (
                    <button key={it.label} type="button" aria-current={it.on ? 'page' : undefined} onClick={it.go}>
                      <span className={s.navIcon} aria-hidden="true">{icon(it.icon)}</span>{t(it.label)}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </nav>
          <main className={s.content}>
            {isManager ? (managerView === 'cashflow' ? <CashflowView key="cf" /> : managerView === 'payables' ? <PayablesView key="ap" toast={setToast} /> : managerView === 'payroll' ? <PayrollView key="py" toast={setToast} /> : managerView === 'quotes' ? <QuotesView key="qt" toast={setToast} /> : managerView === 'workorders' ? <WorkOrdersView key="wo" toast={setToast} /> : managerView === 'cameras' ? <CamerasView key="cm" /> : managerView === 'audit' ? <AuditView key="au" /> : managerView === 'profitability' ? <ProfitabilityView key="pf" /> : managerView === 'contracts' ? <ContractsView key="ct" toast={setToast} /> : managerView === 'users' ? <UsersView key="u" toast={setToast} /> : managerView === 'procurement' ? <ProcurementView key="pr" toast={setToast} /> : managerView === 'capacity' ? <CapacityView key="c" toast={setToast} /> : managerView === 'sensors' ? <SensorsView key="s" /> : managerView === 'network' ? <NetworkView key="n" /> : <Fragment key="d"><AdvisorPanel onOpen={setManagerView} /><DashboardView /></Fragment>): user?.role === 'finance' ? (view === 'cashflow' ? <CashflowView key="cf" /> : view === 'payables' ? <PayablesView key="ap" toast={setToast} /> : <PayrollView key="py" toast={setToast} />) : view === 'payroll' ? <PayrollView key="py" toast={setToast} /> : view === 'quotes' ? <QuotesView key="qt" toast={setToast} /> : view === 'workorders' ? <WorkOrdersView key="wo" toast={setToast} /> : view === 'contracts' ? <ContractsView key="ct" toast={setToast} /> : view === 'procurement' ? <ProcurementView key="pr" toast={setToast} /> : view === 'capacity' ? <CapacityView key="c" toast={setToast} /> : view === 'projects' ? <ProjectsView key="p" toast={setToast} /> : <InvoicesView key="i" toast={setToast} />}
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

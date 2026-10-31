import { PrismaClient } from '@prisma/client';
import { parseCashEvent } from '../domain/cash';
import { allocationFacts } from './prisma-allocation-store';
import { buildProfitability } from '../domain/profitability';
import { DashboardQueries } from '../domain/ports';

/** Cobros, nómina y pagos a proveedores como movimientos de dinero (solo agregar), y lo cotizado de cada proyecto aprobado. Un evento repetido no cambia nada. */
export function cashEventHandler(prisma: PrismaClient) {
  return async (raw: unknown): Promise<'applied' | 'duplicate'> => {
    const c = parseCashEvent(raw);
    if (c.kind === 'entry') {
      const n = await prisma.$executeRaw`INSERT INTO cash_entries (event_id, entry_date, direction, category, amount_cop, ref, project_name)
        VALUES (${c.eventId}::uuid, ${c.date}::date, ${c.direction}, ${c.category}, ${c.amountCop}, ${c.ref}, ${c.projectName}) ON CONFLICT (event_id) DO NOTHING`;
      return n === 1 ? 'applied' : 'duplicate';
    }
    const n = await prisma.$executeRaw`INSERT INTO quote_facts (quote_number, event_id, project_id, project_name, price_cop, cost_cop, margin_pct, approved_by, approved_at)
      VALUES (${c.quoteNumber}, ${c.eventId}::uuid, ${c.projectId}, ${c.projectName}, ${c.priceCop}, ${c.costCop}, ${c.marginPct}, ${c.approvedBy}, ${c.approvedAt}::timestamptz) ON CONFLICT DO NOTHING`;
    return n === 1 ? 'applied' : 'duplicate';
  };
}

export interface CashMonth { month: string; inCop: number; payrollCop: number; supplierCop: number; outCop: number; netCop: number; balanceCop: number }
/** Entradas contra salidas por mes (los últimos `months`), con el saldo acumulado: el saldo arranca con lo de los meses anteriores a la ventana. */
export async function cashflow(prisma: PrismaClient, months: number, now: Date) {
  const rows = await prisma.$queryRaw<{ month: string; in_cop: bigint; payroll_cop: bigint; supplier_cop: bigint }[]>`
    SELECT to_char(date_trunc('month', entry_date), 'YYYY-MM') AS month,
      COALESCE(SUM(amount_cop) FILTER (WHERE direction = 'in'), 0) AS in_cop,
      COALESCE(SUM(amount_cop) FILTER (WHERE category = 'payroll'), 0) AS payroll_cop,
      COALESCE(SUM(amount_cop) FILTER (WHERE category = 'supplier'), 0) AS supplier_cop
    FROM cash_entries GROUP BY 1 ORDER BY 1`;
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const list: string[] = [];
  const cur = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = months - 1; i >= 0; i--) { const d = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - i, 1)); list.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`); }
  let balance = rows.filter((r) => r.month < list[0]).reduce((s, r) => s + Number(r.in_cop) - Number(r.payroll_cop) - Number(r.supplier_cop), 0);
  const out: CashMonth[] = list.map((m) => {
    const r = byMonth.get(m);
    const inCop = Number(r?.in_cop ?? 0), payrollCop = Number(r?.payroll_cop ?? 0), supplierCop = Number(r?.supplier_cop ?? 0), outCop = payrollCop + supplierCop;
    balance += inCop - outCop;
    return { month: m, inCop, payrollCop, supplierCop, outCop, netCop: inCop - outCop, balanceCop: balance };
  });
  return { months: out, totals: { inCop: out.reduce((s, m) => s + m.inCop, 0), outCop: out.reduce((s, m) => s + m.outCop, 0), netCop: out.reduce((s, m) => s + m.netCop, 0) }, balanceCop: balance };
}

/** Lo cotizado contra lo real de cada proyecto aprobado. Real hasta hoy = mano de obra de las asignaciones (porcentaje × días hábiles transcurridos × costo diario) + lo pagado a proveedores ligado al proyecto. */
export async function projectCosts(prisma: PrismaClient, queries: DashboardQueries, now: Date) {
  const [quotes, paid, facts, allocations] = await Promise.all([
    prisma.quoteFact.findMany({ orderBy: [{ approvedAt: 'desc' }, { quoteNumber: 'asc' }], take: 200 }),
    prisma.$queryRaw<{ project_name: string; total: bigint }[]>`SELECT project_name, SUM(amount_cop) AS total FROM cash_entries WHERE category = 'supplier' AND project_name IS NOT NULL GROUP BY project_name`,
    queries.facts(), allocationFacts(prisma),
  ]);
  const labor = new Map(buildProfitability(facts, allocations, now).projects.map((p) => [p.projectName, p.laborCostCop]));
  const purchases = new Map(paid.map((p) => [p.project_name, Number(p.total)]));
  const projects = quotes.map((q) => {
    const laborCostCop = labor.get(q.projectName) ?? 0, purchasesPaidCop = purchases.get(q.projectName) ?? 0, realCostCop = laborCostCop + purchasesPaidCop;
    return { quoteNumber: q.quoteNumber, projectName: q.projectName, quotedPriceCop: q.priceCop, quotedCostCop: q.costCop, quotedMarginPct: q.marginPct, laborCostCop, purchasesPaidCop, realCostCop,
      varianceCop: realCostCop - q.costCop, usedPct: q.costCop > 0 ? Math.round((realCostCop / q.costCop) * 1000) / 10 : null, approvedAt: q.approvedAt.toISOString() };
  });
  return { asOf: now.toISOString().slice(0, 10), projects };
}

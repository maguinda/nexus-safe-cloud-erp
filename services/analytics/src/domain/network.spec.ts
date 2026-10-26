import { buildNetworkSummary, CRITICALITY_ORDER, NetworkInput } from './network';

const NOW = new Date('2026-10-26T12:00:00Z');
const infra = (name: string, criticality: string, over: Partial<NetworkInput['infrastructure'][number]> = {}) => ({
  name, model: '3560-24PS', role: 'Core / Distribución L3', criticality, ips: '10.0.0.2; 10.0.0.9', syslog: false, snmp: false, ntp: false, netflow: false, signals: ['CPU', 'Memoria', 'Interfaces'], ...over,
});
const base = (): NetworkInput => ({
  byCategory: [{ category: 'Laptop', count: 36 }, { category: 'PC', count: 11 }, { category: 'Router', count: 2 }, { category: 'Switch Acceso', count: 5 }, { category: 'Firewall / ASA', count: 1 }],
  byCriticality: [{ criticality: 'Media', count: 47 }, { criticality: 'Crítica', count: 3 }, { criticality: 'Alta', count: 5 }],
  links: { total: 74, functional: 69, notFunctional: 0, noData: 5, byType: [{ type: 'eCustomIOLink', count: 5 }, { type: 'eCopper', count: 69 }], byCriticality: [{ criticality: 'Alta', count: 63 }, { criticality: 'Crítica', count: 11 }] },
  infrastructure: [
    infra('SW1 P1', 'Alta', { netflow: false }), infra('Router0', 'Crítica', { netflow: true, signals: ['CPU', 'Memoria'] }),
    infra('Multilayer Switch0', 'Crítica', { netflow: true }), infra('ASA0', 'Crítica', { syslog: true, ips: null }),
  ],
});

describe('buildNetworkSummary', () => {
  it('totals: devices are the sum of the categories, links come with their count, critical ones are the «Crítica» devices', () => {
    const s = buildNetworkSummary(base(), NOW);
    expect(s.totals).toEqual({ devices: 55, links: 74, criticalDevices: 3, infrastructure: 4 });
    expect(s.asOf).toBe(NOW.toISOString());
  });

  it('categories come biggest first, ties by name', () => {
    const i = base(); i.byCategory.push({ category: 'Servidor', count: 2 });
    expect(buildNetworkSummary(i, NOW).byCategory.map((c) => [c.category, c.count])).toEqual([['Laptop', 36], ['PC', 11], ['Switch Acceso', 5], ['Router', 2], ['Servidor', 2], ['Firewall / ASA', 1]]);
  });

  it('criticality is always listed Crítica, Alta, Media, with zero for the one that has none', () => {
    const i = base(); i.byCriticality = [{ criticality: 'Media', count: 4 }];
    expect(buildNetworkSummary(i, NOW).byCriticality).toEqual([{ criticality: 'Crítica', count: 0 }, { criticality: 'Alta', count: 0 }, { criticality: 'Media', count: 4 }]);
    expect(CRITICALITY_ORDER).toEqual(['Crítica', 'Alta', 'Media']);
  });

  it('links: types biggest first, criticality in its fixed order, and the three functional states add up', () => {
    const l = buildNetworkSummary(base(), NOW).links;
    expect(l.byType).toEqual([{ type: 'eCopper', count: 69 }, { type: 'eCustomIOLink', count: 5 }]);
    expect(l.byCriticality).toEqual([{ criticality: 'Crítica', count: 11 }, { criticality: 'Alta', count: 63 }, { criticality: 'Media', count: 0 }]);
    expect(l.functional + l.notFunctional + l.noData).toBe(l.total);
  });

  it('monitoring counts how many pieces of equipment have each thing configured and how many have nothing', () => {
    const m = buildNetworkSummary(base(), NOW).monitoring;
    expect(m).toEqual({ equipment: 4, syslog: 1, snmp: 0, ntp: 0, netflow: 2, withoutAnyConfig: 1, signalsPossible: 3 });
  });

  it('the infrastructure list puts «Crítica» first, then by name, and shows how many signals each can send', () => {
    const rows = buildNetworkSummary(base(), NOW).infrastructure;
    expect(rows.map((r) => [r.name, r.criticality])).toEqual([['ASA0', 'Crítica'], ['Multilayer Switch0', 'Crítica'], ['Router0', 'Crítica'], ['SW1 P1', 'Alta']]);
    expect(rows.find((r) => r.name === 'Router0')).toMatchObject({ netflow: true, signals: 2 });
    expect(rows.find((r) => r.name === 'ASA0')).toMatchObject({ ips: null, syslog: true });
  });

  it('criticality comes before the name: a «Alta» piece whose name sorts first still goes after a «Crítica» one', () => {
    const i = base(); i.infrastructure = [infra('Access A', 'Alta'), infra('Zeta firewall', 'Crítica'), infra('Beta switch', 'Alta')];
    expect(buildNetworkSummary(i, NOW).infrastructure.map((r) => r.name)).toEqual(['Zeta firewall', 'Access A', 'Beta switch']);
  });

  it('a criticality the source never uses is still shown, after the known ones', () => {
    const i = base(); i.byCriticality.push({ criticality: 'Baja', count: 2 });
    expect(buildNetworkSummary(i, NOW).byCriticality.map((c) => c.criticality)).toEqual(['Crítica', 'Alta', 'Media', 'Baja']);
  });

  describe('insights', () => {
    it('no Syslog, SNMP or NTP anywhere is a high finding with the numbers', () => {
      const i = base(); i.infrastructure = i.infrastructure.map((r) => ({ ...r, syslog: false }));
      const f = buildNetworkSummary(i, NOW).insights.find((x) => x.code === 'monitoring_basics_missing')!;
      expect(f).toMatchObject({ severity: 'high', params: { equipment: 4, syslog: 0, snmp: 0, ntp: 0 } });
    });
    it('…but not when at least one piece of equipment has one of them', () => {
      const i = base(); i.infrastructure = i.infrastructure.map((r) => ({ ...r, syslog: false })); i.infrastructure[0] = infra('SW1 P1', 'Alta', { snmp: true });
      const f = buildNetworkSummary(i, NOW).insights.find((x) => x.code === 'monitoring_basics_missing');
      expect(f).toBeUndefined();
    });
    it('critical equipment with nothing configured is named', () => {
      const i = base(); i.infrastructure = [infra('Zed', 'Crítica'), infra('Alfa', 'Crítica'), infra('Beta', 'Crítica', { netflow: true }), infra('Gama', 'Alta')];
      const f = buildNetworkSummary(i, NOW).insights.find((x) => x.code === 'critical_unmonitored')!;
      expect(f).toMatchObject({ severity: 'high', params: { count: 2, critical: 3, names: 'Alfa, Zed' } });
    });
    it('NetFlow on some but not all is a medium finding; on all or on none it is not', () => {
      expect(buildNetworkSummary(base(), NOW).insights.find((x) => x.code === 'netflow_partial')).toMatchObject({ severity: 'medium', params: { withNetflow: 2, equipment: 4 } });
      const none = base(); none.infrastructure = none.infrastructure.map((r) => ({ ...r, netflow: false }));
      expect(buildNetworkSummary(none, NOW).insights.some((x) => x.code === 'netflow_partial')).toBe(false);
      const all = base(); all.infrastructure = all.infrastructure.map((r) => ({ ...r, netflow: true }));
      expect(buildNetworkSummary(all, NOW).insights.some((x) => x.code === 'netflow_partial')).toBe(false);
    });
    it('links that do not say whether they work are an info note', () => {
      expect(buildNetworkSummary(base(), NOW).insights.find((x) => x.code === 'links_without_status')).toMatchObject({ severity: 'info', params: { count: 5 } });
    });
    it('high severity first, then medium, then info', () => {
      const sev = buildNetworkSummary(base(), NOW).insights.map((x) => x.severity);
      expect(sev).toEqual([...sev].sort((a, b) => ['high', 'medium', 'info'].indexOf(a) - ['high', 'medium', 'info'].indexOf(b)));
    });
    it('everything configured and no unknown links: one «all covered» note', () => {
      const i = base(); i.links.noData = 0; i.infrastructure = i.infrastructure.map((r) => ({ ...r, syslog: true, snmp: true, ntp: true, netflow: true }));
      expect(buildNetworkSummary(i, NOW).insights.map((x) => x.code)).toEqual(['all_covered']);
    });
  });

  it('with nothing loaded everything is zero and the lists are empty', () => {
    const s = buildNetworkSummary({ byCategory: [], byCriticality: [], links: { total: 0, functional: 0, notFunctional: 0, noData: 0, byType: [], byCriticality: [] }, infrastructure: [] }, NOW);
    expect(s.totals).toEqual({ devices: 0, links: 0, criticalDevices: 0, infrastructure: 0 });
    expect(s.byCategory).toEqual([]); expect(s.infrastructure).toEqual([]);
    expect(s.monitoring).toEqual({ equipment: 0, syslog: 0, snmp: 0, ntp: 0, netflow: 0, withoutAnyConfig: 0, signalsPossible: 0 });
    expect(s.byCriticality.map((c) => c.count)).toEqual([0, 0, 0]);
    expect(s.insights.map((x) => x.code)).toEqual(['all_covered']);
  });

  it('does not change what it receives', () => {
    const i = base(); const copy = JSON.stringify(i);
    buildNetworkSummary(i, NOW);
    expect(JSON.stringify(i)).toBe(copy);
  });
});

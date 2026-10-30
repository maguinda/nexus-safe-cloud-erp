import type { history as es } from '../es/history';

export const history: Record<keyof typeof es, string> = {
  'hist.title': 'Inventory movements',
  'hist.intro': 'Every time the stock goes up or down a row is left: when, how much, the balance after and who did it. It is append-only; nobody can edit it.',
  'hist.filter': 'Item',
  'hist.all': 'All',
  'hist.empty': 'There are no movements yet.',
  'hist.col.when': 'When',
  'hist.col.item': 'Item',
  'hist.col.change': 'Change',
  'hist.col.after': 'Balance after',
  'hist.col.what': 'What happened',
  'hist.col.who': 'Who',
  'hist.src.opening': 'Opening balance',
  'hist.src.purchase': 'Order received',
  'hist.src.adjustment': 'Manual adjustment',
  'hist.src.count': 'Physical count',
  'hist.noActor': 'system',
  'hist.loadError': 'Could not load the history: {reason}',
};

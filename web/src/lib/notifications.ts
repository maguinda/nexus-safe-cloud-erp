import type { Lang, MsgKey } from '../i18n';
import { formatCop, formatDay } from './format';
import type { NotificationItem } from './types';

type T = (key: MsgKey, vars?: Record<string, string | number>) => string;

const KINDS = ['OverdueDetected', 'ThresholdBreached', 'OverAllocationDetected', 'WorkOrderCreated', 'WorkOrderClosed'] as const;

const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

/** El texto de un aviso en el idioma de la persona. El servidor guarda el tipo y los datos; un tipo desconocido (de una versión futura) dice «Aviso nuevo». */
export function notificationText(n: NotificationItem, t: T, lang: Lang): string {
  const p = n.params ?? {};
  switch (n.kind) {
    case 'OverdueDetected':
      return t('notif.OverdueDetected', { invoiceNumber: str(p.invoiceNumber), projectName: str(p.projectName), milestoneName: str(p.milestoneName), days: Number(p.daysOverdue) || 0, total: `${formatCop(Number(p.totalCop) || 0)} COP` });
    case 'ThresholdBreached':
      return t('notif.ThresholdBreached', { deviceName: str(p.deviceName), location: str(p.location), readingKind: str(p.readingKind), value: str(p.value), unit: str(p.unit), status: str(p.status) });
    case 'OverAllocationDetected':
      return t('notif.OverAllocationDetected', { engineerName: str(p.engineerName), percent: Number(p.allocationPercent) || 0, from: dayOf(str(p.periodStart), lang), to: dayOf(str(p.periodEnd), lang) });
    case 'WorkOrderCreated':
      return t('notif.WorkOrderCreated', { orderNumber: str(p.orderNumber), type: t(`wo.type.${str(p.orderType)}` as MsgKey), targetName: str(p.targetName), priority: t(`wo.priority.${str(p.priority)}` as MsgKey) });
    case 'WorkOrderClosed':
      return t('notif.WorkOrderClosed', { orderNumber: str(p.orderNumber), type: t(`wo.type.${str(p.orderType)}` as MsgKey), targetName: str(p.targetName), outcome: t(`wo.status.${str(p.outcome)}` as MsgKey) });
    default:
      return t('notif.unknown');
  }
}

function dayOf(iso: string, lang: Lang): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? formatDay(`${iso}T00:00:00Z`, lang) : iso;
}

export const knownKind = (k: string): boolean => (KINDS as readonly string[]).includes(k);

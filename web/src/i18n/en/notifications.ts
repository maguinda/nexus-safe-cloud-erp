import type { notifications as es } from '../es/notifications';

export const notifications: Record<keyof typeof es, string> = {
  'notif.open': 'Notifications ({n} unread)',
  'notif.openNone': 'Notifications (none unread)',
  'notif.title': 'Notifications',
  'notif.empty': 'No notifications right now.',
  'notif.loading': 'Loading notifications…',
  'notif.error': 'Could not load notifications: {reason}',
  'notif.markAll': 'Mark all as read',
  'notif.markOne': 'Mark as read',
  'notif.unread': 'Unread',
  'notif.severity.info': 'Information',
  'notif.severity.warning': 'Warning',
  'notif.severity.critical': 'Critical',
  'notif.more': 'Show more notifications',
  'notif.OverdueDetected': 'Invoice {invoiceNumber} of “{projectName}” ({milestoneName}) is {days} days overdue · {total} with IVA',
  'notif.ThresholdBreached': '{deviceName} in {location}: {readingKind} at {value} {unit} ({status})',
  'notif.OverAllocationDetected': '{engineerName} is allocated at {percent}% between {from} and {to}',
  'notif.unknown': 'New notification',
};

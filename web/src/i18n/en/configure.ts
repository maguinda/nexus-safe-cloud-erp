import type { configure as es } from '../es/configure';

export const configure: Record<keyof typeof es, string> = {
  'cfg.title': 'Purchased equipment to configure',
  'cfg.intro': 'These devices entered the inventory from a received purchase. Fill in what each one is for, how critical it is and its IPs (optional).',
  'cfg.done': 'Device {name} completed.',
  'cfg.failed': 'Could not save: {reason}',
  'cfg.open': 'Complete',
  'cfg.openFor': 'Complete the device {name}',
  'cfg.field.role': 'What it is for (role)',
  'cfg.field.criticality': 'Criticality',
  'cfg.field.ips': 'IPs (optional, up to 4, comma separated)',
  'cfg.save': 'Save device',
  'cfg.saving': 'Saving…',
  'cfg.cancel': 'Cancel',
  'cfg.note': 'There is no site field: the network inventory does not have one.',
  'cfg.v.role': 'Write 2 to 60 characters (letters, numbers, spaces and . _ ( ) / & -).',
  'cfg.v.rolePending': 'Say what the device is for; “pending” does not count.',
  'cfg.v.criticality': 'Choose a criticality.',
  'cfg.v.ips': 'Write 1 to 4 different IPv4 addresses, for example 10.0.2.5.',
};

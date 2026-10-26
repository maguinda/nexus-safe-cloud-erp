import type { theme as es } from '../es/theme';

export const theme: Record<keyof typeof es, string> = {
  'theme.title': 'Theme',
  'theme.system': 'System',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.help': 'System uses the light or dark mode of your computer.',
  'theme.saved': 'Theme changed to {theme}.',
  'theme.error': 'The theme could not be changed: {reason}',
};

import { Language } from './language';
import { Role } from './role';
import { Theme } from './theme';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  language: Language;
  theme: Theme;
  passwordHash: string;
}

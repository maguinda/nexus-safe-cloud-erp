import { Language } from './language';
import { Role } from './role';
import { Theme } from './theme';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Solo ingeniero y técnico: la persona del personal técnico. */
  staffId: string | null;
  language: Language;
  theme: Theme;
  passwordHash: string;
}

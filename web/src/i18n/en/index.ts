import { auth } from './auth';
import { common } from './common';
import { dashboard } from './dashboard';
import { invoices } from './invoices';
import { projects } from './projects';
import { server } from './server';
import { users } from './users';
import { theme } from './theme';
import { charts } from './charts';
import { sensors } from './sensors';
import { netview } from './netview';
import { summary } from './summary';
import { advisor } from './advisor';
import { einvoice } from './einvoice';
import { notifications } from './notifications';

export const en = { ...common, ...auth, ...projects, ...users, ...invoices, ...dashboard, ...server, ...theme, ...charts, ...sensors, ...netview, ...summary, ...advisor, ...einvoice, ...notifications };

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
import { capacity } from './capacity';
import { procurement } from './procurement';
import { payments } from './payments';
import { contracts } from './contracts';
import { team } from './team';
import { profitability } from './profitability';
import { audit } from './audit';
import { cameras } from './cameras';
import { configure } from './configure';
import { history } from './history';

/** El español es la fuente de las claves: el inglés tiene que tener exactamente las mismas (si falta una, no compila). */
export const es = { ...common, ...auth, ...projects, ...users, ...invoices, ...dashboard, ...server, ...theme, ...charts, ...sensors, ...netview, ...summary, ...advisor, ...einvoice, ...notifications, ...capacity, ...procurement, ...payments, ...contracts, ...team, ...profitability, ...audit, ...cameras, ...configure, ...history } as const;

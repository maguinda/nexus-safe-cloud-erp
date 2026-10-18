import 'reflect-metadata';
import { createApp } from './app.factory';
import { loadConfig } from './config';

async function main() {
  const { port } = loadConfig();
  const app = await createApp();
  await app.listen(port, '0.0.0.0');
  console.log(`billing-receivables listening on :${port} (docs at /docs)`);
}
main().catch((e) => { console.error(e); process.exit(1); });

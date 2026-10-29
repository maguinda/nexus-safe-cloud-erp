import 'reflect-metadata';
import { createServer } from 'http';
import { createApp } from './app.factory';
import { loadConfig } from './config';
import { enforceAllowedClients, httpsOptions, loadTlsConfig } from './tls';

async function main() {
  const { port } = loadConfig();
  const tls = loadTlsConfig();
  const app = await createApp(tls ? httpsOptions(tls) : undefined);
  if (tls) enforceAllowedClients(app.getHttpServer(), tls.allowedClients);
  await app.listen(port, '0.0.0.0');
  console.log(`notifications listening on :${port} (${tls ? `mTLS, allowed clients: ${tls.allowedClients.join(', ')}` : 'plain HTTP'}; docs at /docs)`);

  // SOLO para la demo (docker-compose.docs.yml): un segundo puerto sin TLS para abrir Swagger en el navegador, que no tiene carné.
  // El JWT sigue siendo obligatorio en toda ruta. Sin esta variable no existe esa puerta.
  const docsPort = process.env.DOCS_HTTP_PORT;
  if (tls && docsPort) {
    createServer(app.getHttpAdapter().getInstance()).listen(Number(docsPort), '0.0.0.0');
    console.warn(`WARNING: plain-HTTP docs listener on :${docsPort} (demo only, no mTLS on this port)`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

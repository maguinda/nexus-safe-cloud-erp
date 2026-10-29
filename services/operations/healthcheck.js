// Healthcheck del contenedor. Con mTLS activo presenta el certificado del propio servicio (que su lista de permitidos acepta);
// sin TLS hace una petición normal. Sale con 0 si /health responde 200.
const fs = require('fs');
const port = Number(process.env.PORT);
const done = (res) => process.exit(res.statusCode === 200 ? 0 : 1);
const fail = () => process.exit(1);
if (process.env.TLS_ENABLED === 'true') {
  require('https').get({
    host: '127.0.0.1', port, path: '/health', timeout: 2500,
    cert: fs.readFileSync(process.env.TLS_CERT_PATH), key: fs.readFileSync(process.env.TLS_KEY_PATH), ca: fs.readFileSync(process.env.TLS_CA_PATH),
  }, done).on('error', fail).on('timeout', fail);
} else {
  require('http').get({ host: '127.0.0.1', port, path: '/health', timeout: 2500 }, done).on('error', fail).on('timeout', fail);
}

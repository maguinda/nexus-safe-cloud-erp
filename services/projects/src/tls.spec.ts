import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { httpsOptions, isAllowedClient, loadTlsConfig } from './tls';

const fakeSocket = (cn: unknown) => ({ getPeerCertificate: () => ({ subject: { CN: cn } }) }) as any;

describe('loadTlsConfig', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tls-'));
  for (const f of ['k.pem', 'c.pem', 'ca.pem']) writeFileSync(join(dir, f), f);
  const base = { TLS_ENABLED: 'true', TLS_KEY_PATH: join(dir, 'k.pem'), TLS_CERT_PATH: join(dir, 'c.pem'), TLS_CA_PATH: join(dir, 'ca.pem'), TLS_ALLOWED_CLIENTS: 'gateway' };

  it('is off unless TLS_ENABLED is exactly "true"', () => {
    expect(loadTlsConfig({})).toBeNull();
    expect(loadTlsConfig({ ...base, TLS_ENABLED: 'false' })).toBeNull();
    expect(loadTlsConfig({ ...base, TLS_ENABLED: '1' })).toBeNull();
  });

  it('reads the files and the list of allowed names', () => {
    const c = loadTlsConfig({ ...base, TLS_ALLOWED_CLIENTS: ' gateway , identity ,, ' })!;
    expect(c.key.toString()).toBe('k.pem');
    expect(c.cert.toString()).toBe('c.pem');
    expect(c.ca.toString()).toBe('ca.pem');
    expect(c.allowedClients).toEqual(['gateway', 'identity']);
  });

  it.each(['TLS_KEY_PATH', 'TLS_CERT_PATH', 'TLS_CA_PATH', 'TLS_ALLOWED_CLIENTS'])('refuses to start with TLS on but without %s', (name) => {
    expect(() => loadTlsConfig({ ...base, [name]: '' })).toThrow(name);
  });

  it('refuses an empty list of allowed names', () => {
    expect(() => loadTlsConfig({ ...base, TLS_ALLOWED_CLIENTS: ' , ' })).toThrow('at least one');
  });

  it('requires and verifies the client certificate', () => {
    const o = httpsOptions(loadTlsConfig(base)!);
    expect(o).toMatchObject({ requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
  });
});

describe('isAllowedClient', () => {
  it('accepts only the listed names', () => {
    expect(isAllowedClient(fakeSocket('gateway'), ['gateway'])).toBe(true);
    expect(isAllowedClient(fakeSocket('billing'), ['gateway'])).toBe(false);
    expect(isAllowedClient(fakeSocket('GATEWAY'), ['gateway'])).toBe(false);
    expect(isAllowedClient(fakeSocket('gateway.evil'), ['gateway'])).toBe(false);
  });
  it.each([[undefined], [null], [''], [['gateway']], [42]])('rejects a missing or odd name %p', (cn) => {
    expect(isAllowedClient(fakeSocket(cn), ['gateway'])).toBe(false);
  });
  it('rejects a connection without certificate', () => {
    expect(isAllowedClient({ getPeerCertificate: () => ({}) } as any, ['gateway'])).toBe(false);
    expect(isAllowedClient({ getPeerCertificate: () => undefined } as any, ['gateway'])).toBe(false);
  });
});

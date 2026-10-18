import { generateKeyPairSync } from 'crypto';
import { verify, decode } from 'jsonwebtoken';
import { Rs256TokenIssuer } from './rs256-token-issuer';
import { User } from '../domain/user';

const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const user: User = { id: '0b8c1f1a-1111-4222-8333-444455556666', email: 'laura.rios@nexus.example', name: 'Laura Ríos', role: 'project_lead', passwordHash: 'x' };

describe('Rs256TokenIssuer', () => {
  const keys = pair();
  const issuer = new Rs256TokenIssuer({ privateKey: keys.privateKey, issuer: 'identity-access', audience: 'erp-api', ttlSeconds: 900 });

  it('signs a token that verifies with the public key and carries the role', () => {
    const { token, expiresIn } = issuer.issue(user);
    const claims: any = verify(token, keys.publicKey, { algorithms: ['RS256'], issuer: 'identity-access', audience: 'erp-api' });
    expect(expiresIn).toBe(900);
    expect(claims.sub).toBe(user.id);
    expect(claims.role).toBe('project_lead');
    expect(claims.email).toBe(user.email);
    expect(claims.exp - claims.iat).toBe(900);
    expect(claims.jti).toBeTruthy();
    expect(claims).not.toHaveProperty('passwordHash');
  });

  it('is rejected by a different public key', () => {
    const { token } = issuer.issue(user);
    expect(() => verify(token, pair().publicKey, { algorithms: ['RS256'] })).toThrow();
  });

  it('uses a fresh jti for every token', () => {
    const a: any = decode(issuer.issue(user).token);
    const b: any = decode(issuer.issue(user).token);
    expect(a.jti).not.toBe(b.jti);
  });

  it('cannot be verified as HS256 using the public key as a secret (algorithm confusion)', () => {
    const { token } = issuer.issue(user);
    expect(() => verify(token, keys.publicKey, { algorithms: ['HS256'] })).toThrow();
  });
});

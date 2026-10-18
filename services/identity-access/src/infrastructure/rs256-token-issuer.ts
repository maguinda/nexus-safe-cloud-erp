import { randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import { AccessToken, TokenIssuer } from '../domain/ports';
import { User } from '../domain/user';

export interface TokenOptions {
  privateKey: string;
  issuer: string;
  audience: string;
  ttlSeconds: number;
}

/** Firma con RS256: los demás servicios verifican con la llave pública y no pueden fabricar tokens. */
export class Rs256TokenIssuer implements TokenIssuer {
  constructor(private readonly opts: TokenOptions) {}

  issue(user: User): AccessToken {
    const token = sign({ email: user.email, name: user.name, role: user.role }, this.opts.privateKey, {
      algorithm: 'RS256',
      subject: user.id,
      issuer: this.opts.issuer,
      audience: this.opts.audience,
      expiresIn: this.opts.ttlSeconds,
      jwtid: randomUUID(),
    });
    return { token, expiresIn: this.opts.ttlSeconds };
  }
}

// JWT HS256 de prueba, solo con node:crypto.
import { createHmac } from 'node:crypto';

const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

export function signJwt(claims, secret, { expiresIn = 3600 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ aud: 'authenticated', role: 'authenticated', iat: now, exp: now + expiresIn, ...claims });
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

// Trava de acesso opcional (cookie + token) pra quando o Escritório roda atrás de um domínio
// público (deploy no VPS do cliente), não só em localhost. Sem HABBLAUD_ACCESS_TOKEN definido,
// fica totalmente desligada (comportamento de hoje, sem mudança). Porta do mesmo esquema já
// provado em produção no Guilda Office (lib/instalador/guilda-office-src/server/access-gate.js).
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

function parseCookies(header: string | undefined): Record<string, string> {
  const raw = typeof header === 'string' ? header : '';
  if (!raw.trim()) return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function createRateLimiter(maxAttempts = 10, windowMs = 60_000) {
  const attempts = new Map<string, { count: number; start: number }>();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of attempts) if (now - entry.start > windowMs) attempts.delete(key);
  }, windowMs);
  cleanup.unref();
  return {
    isLimited(ip: string): boolean {
      const entry = attempts.get(ip);
      return !!entry && entry.count >= maxAttempts;
    },
    recordFailure(ip: string): void {
      const now = Date.now();
      const entry = attempts.get(ip);
      if (!entry || now - entry.start > windowMs) { attempts.set(ip, { count: 1, start: now }); return; }
      entry.count++;
    },
    reset(ip: string): void { attempts.delete(ip); },
  };
}

const COOKIE_NAME = 'escritorio_access';

export interface AccessGate {
  enabled: boolean;
  /** true = já respondeu (bloqueado); o chamador não deve seguir pro resto das rotas. */
  handleHttp(req: IncomingMessage, res: ServerResponse): boolean;
  /** Rota de conveniência: /set-access?t=<token> seta o cookie e redireciona. true = já respondeu. */
  handleSetAccess(req: IncomingMessage, res: ServerResponse): boolean;
}

export function createAccessGate(token: string | undefined): AccessGate {
  const t = String(token ?? '').trim();
  const enabled = Boolean(t);
  const rateLimiter = createRateLimiter();

  const clientIp = (req: IncomingMessage): string => req.socket?.remoteAddress || 'unknown';

  const authorized = (req: IncomingMessage): boolean => {
    const cookies = parseCookies(req.headers?.cookie);
    return safeCompare(cookies[COOKIE_NAME] || '', t);
  };

  return {
    enabled,
    handleHttp(req, res) {
      if (!enabled) return false;
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/set-access') return false; // deixa a rota de login passar
      // o healthcheck do Docker bate aqui sem cookie - sem essa exceção o
      // container fica "unhealthy" pra sempre com o gate ligado, e o Traefik
      // nunca roteia pra ele (nem tenta emitir certificado ACME). Achado ao
      // vivo 2026-10-20, Escritório de IA do Claudemir Godinho.
      if (url.pathname === '/api/health') return false;
      const ip = clientIp(req);
      if (authorized(req)) { rateLimiter.reset(ip); return false; }
      const limited = rateLimiter.isLimited(ip);
      if (!limited) rateLimiter.recordFailure(ip);
      res.statusCode = limited ? 429 : 401;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(limited ? 'Muitas tentativas. Aguarde um minuto.' : 'Acesso restrito. Peça o link de acesso.');
      return true;
    },
    handleSetAccess(req, res) {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname !== '/set-access') return false;
      const provided = url.searchParams.get('t') || '';
      if (!enabled || provided !== t) {
        res.statusCode = 403;
        res.end('token inválido');
        return true;
      }
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(t)}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`);
      res.statusCode = 302;
      res.setHeader('Location', '/');
      res.end();
      return true;
    },
  };
}

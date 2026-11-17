// Fonte de agentes pro HERMES AGENT (a Manu), implementando o mesmo contrato AgentSource
// que o ClaudeWatcher usa pro Claude Code — só que lendo ~/.hermes/state.db (SQLite que o
// próprio Hermes grava) em vez de arquivo de transcript. Sempre read-only.
//
// Identidade UNIFICADA: a Manu é UMA personagem só, não importa por qual canal a conversa
// entrou (Telegram, voz, API, Escritório) — o Hermes grava uma `sessions` row NOVA pra cada
// canal/conversa, mas pro escritório isso tem que aparecer como a mesma Manu trabalhando,
// não um fantasma por canal. Mesma ideia pros 6 funcionários (Giovana, Leonardo, Rafael,
// Thiago, Mel, Dudu): reconhecidos pelo nome, não pela sessão específica que os chamou.
import { DatabaseSync } from 'node:sqlite';
import type { AgentStatus, Provider, SourceInfo } from '../../shared/types';
import type { Office } from '../model/office';
import type { AgentSource } from './source';
import { log } from '../log';
import { describeHermesTool, describePrompt, SPECIAL } from '../../shared/hermes-activity';
import { hash32 } from '../../shared/hash';

const POLL_MS = 2_000;
const IDLE_AFTER_MS = 2 * 60_000;
const OFFLINE_SWEEP_MS = 5 * 60_000; // sessão sem ended_at mas sem heartbeat há 5min: considera encerrada
const MAIN_AGENT_ID = 'hermes:manu';

// Nomes fixos do time (funcionarios-ia/*, ver AGENTS.md real do Hermes) — a sessão de um
// subagente guarda em `title` algo como "giovana-ops" ou "Giovana"; casa por substring,
// sem diferenciar caixa. Quem não bate em ninguém do time fica de fora da unificação (cada
// sessão dele vira um personagem à parte, como antes).
const TEAM_NAMES: Record<string, string> = {
  giovana: 'Giovana',
  leonardo: 'Leonardo',
  rafael: 'Rafael',
  thiago: 'Thiago',
  mel: 'Mel',
  dudu: 'Dudu',
};

function resolveSubName(title: string | null | undefined): string | undefined {
  if (!title) return undefined;
  const t = title.toLowerCase();
  for (const [key, name] of Object.entries(TEAM_NAMES)) if (t.includes(key)) return name;
  return undefined;
}

/**
 * O Hermes grava started_at/ended_at/timestamp em epoch SEGUNDOS (convenção Python,
 * `time.time()`), não milissegundos como o resto deste servidor (Date.now()). Sem essa
 * conversão toda sessão parece ter bilhões de ms de idade e nunca aparece como "recente"
 * (bug real, achado 18/10/2026 testando contra state.db de produção).
 */
function toMs(epochSeconds: number | null | undefined): number | undefined {
  return epochSeconds == null ? undefined : epochSeconds * 1000;
}

interface SessionRow {
  id: string;
  parent_session_id: string | null;
  started_at: number | null;
  ended_at: number | null;
  title: string | null;
}

interface MessageRow {
  id: number;
  role: string;
  content: string | null;
  tool_calls: string | null;
  tool_name: string | null;
  timestamp: number | null;
}

function parseToolCalls(raw: string | null): Array<{ name: string; input: unknown }> {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((c: any) => {
        const fn = c?.function ?? c;
        const name = fn?.name ?? c?.name;
        if (!name) return null;
        let input: unknown = {};
        try {
          input = typeof fn?.arguments === 'string' ? JSON.parse(fn.arguments) : (fn?.arguments ?? {});
        } catch {
          input = {};
        }
        return { name: String(name), input };
      })
      .filter((x: unknown): x is { name: string; input: unknown } => !!x);
  } catch {
    return [];
  }
}

function looksPendingApproval(content: string | null): boolean {
  if (!content) return false;
  return content.includes('"approval_pending": true') || content.includes('"status": "pending_approval"');
}

/** Uma personagem unificada (a Manu, ou um funcionário) — pode ter várias sessões Hermes abertas ao mesmo tempo (canais). */
interface UnifiedCharacter {
  agentId: string;
  sessionIds: Set<string>;
  lastMessageId: Map<string, number>; // por sessionId
  status: AgentStatus;
}

export interface HermesWatcherOptions {
  office: Office;
  /** Caminho do state.db (padrão: ~/.hermes/state.db — ou /hermes-data/state.db no container). */
  dbPath: string;
  /** Nome do dono do VPS, pra rotular a sala ("Escritório do <nome>"). */
  ownerName?: string;
}

export class HermesWatcher implements AgentSource {
  readonly provider: Provider = 'hermes' as Provider;
  private timer: ReturnType<typeof setInterval> | undefined;
  private main: UnifiedCharacter | undefined;
  private readonly subs = new Map<string, UnifiedCharacter>(); // chave: nome resolvido (Giovana, Leonardo...)
  private readonly adHocSubs = new Map<string, UnifiedCharacter>(); // subagente sem nome reconhecido: 1 por session.id
  private readonly roomId: string;

  constructor(private readonly opts: HermesWatcherOptions) {
    this.roomId = opts.ownerName ? `/manu/${opts.ownerName}` : '/manu';
  }

  start(): void {
    if (this.timer) return;

    this.opts.office.beginBoot();
    try {
      try {
        this.poll();
      } catch (err) {
        log.warn(`HermesWatcher: falha no poll inicial (${err instanceof Error ? err.stack ?? err.message : String(err)})`);
      }
    } finally {
      this.opts.office.endBoot();
    }

    // O acompanhamento precisa continuar mesmo se o primeiro acesso ao SQLite falhar.
    this.timer = setInterval(() => {
      try {
        this.poll();
      } catch (err) {
        log.warn(`HermesWatcher: falha no poll (${err instanceof Error ? err.message : String(err)})`);
      }
    }, POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  sources(): SourceInfo[] {
    return [{ provider: this.provider, account: 'hermes', ok: true }] as unknown as SourceInfo[];
  }

  transcriptPathOf(): string | undefined {
    return undefined; // v1: sem replay de transcript completo
  }

  private openDb(): DatabaseSync | undefined {
    try {
      return new DatabaseSync(this.opts.dbPath, { readOnly: true });
    } catch (err) {
      log.warn(`HermesWatcher: falha ao abrir SQLite (${this.opts.dbPath}): ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      return undefined;
    }
  }

  private poll(): void {
    const db = this.openDb();
    if (!db) return;
    try {
      try {
        const probe = db.prepare("SELECT 1 AS ok").get();
        log.info(`HermesWatcher: diagnóstico SQLite SELECT 1: ${JSON.stringify(probe)}`);
      } catch (err) {
        log.warn(`HermesWatcher: diagnóstico SQLite SELECT 1 falhou: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      }

      let query;
      try {
        query = db.prepare(
          `SELECT id, parent_session_id, started_at, ended_at, title FROM sessions
           WHERE ended_at IS NULL OR ended_at > ?
           ORDER BY started_at ASC LIMIT 40`,
        );
      } catch (err) {
        const sqliteError = err as Error & {
          code?: unknown;
          errcode?: unknown;
          errstr?: unknown;
          errno?: unknown;
          syscall?: unknown;
          path?: unknown;
        };
        log.warn(`HermesWatcher: falha ao preparar consulta SQLite (${this.opts.dbPath}): ${JSON.stringify({
          name: sqliteError.name,
          message: sqliteError.message,
          code: sqliteError.code,
          errcode: sqliteError.errcode,
          errstr: sqliteError.errstr,
          errno: sqliteError.errno,
          syscall: sqliteError.syscall,
          path: sqliteError.path,
          stack: sqliteError.stack,
        })}`);
        throw err;
      }

      let sessions: SessionRow[];
      try {
        sessions = query.all((Date.now() - OFFLINE_SWEEP_MS) / 1000) as unknown as SessionRow[];
      } catch (err) {
        log.warn(`HermesWatcher: falha ao executar consulta SQLite (${this.opts.dbPath}): ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
        throw err;
      }

      const seenSessionIds = new Set<string>();
      for (const session of sessions) {
        seenSessionIds.add(session.id);
        this.syncSession(db, session);
      }

      this.sweepGone(seenSessionIds);
    } finally {
      db.close();
    }
  }

  /** Tira sessões que não apareceram mais na consulta (encerraram, ou passaram do sweep) de cada personagem. */
  private sweepGone(seenSessionIds: Set<string>): void {
    if (this.main) {
      for (const sid of this.main.sessionIds) if (!seenSessionIds.has(sid)) this.main.sessionIds.delete(sid);
      if (this.main.sessionIds.size === 0) {
        this.opts.office.closeMain(this.main.agentId);
        this.main = undefined;
      }
    }
    for (const [key, ch] of this.subs) {
      for (const sid of ch.sessionIds) if (!seenSessionIds.has(sid)) ch.sessionIds.delete(sid);
      if (ch.sessionIds.size === 0) {
        this.opts.office.completeSub(ch.agentId);
        this.subs.delete(key);
      }
    }
    for (const [sid, ch] of this.adHocSubs) {
      if (!seenSessionIds.has(sid)) {
        this.opts.office.completeSub(ch.agentId);
        this.adHocSubs.delete(sid);
      }
    }
  }

  private syncSession(db: DatabaseSync, session: SessionRow): void {
    const isSub = !!session.parent_session_id;
    const startedAt = toMs(session.started_at) ?? Date.now();

    const character = isSub ? this.resolveSubCharacter(session, startedAt) : this.resolveMainCharacter(startedAt);
    if (!character) return; // subagente cujo pai ainda não existe nesta fonte — tenta de novo no próximo poll

    character.sessionIds.add(session.id);
    this.feedActivity(db, session, character);
  }

  private resolveMainCharacter(startedAt: number): UnifiedCharacter {
    if (this.main) return this.main;
    this.opts.office.addMain({
      id: MAIN_AGENT_ID,
      provider: this.provider,
      account: 'hermes',
      sessionId: MAIN_AGENT_ID,
      cwd: this.roomId,
      role: 'Agente principal',
      startedAt,
      status: 'working',
    });
    this.opts.office.setCharacter(MAIN_AGENT_ID, { name: 'Manu', seed: hash32('manu'), parts: {} });
    this.main = { agentId: MAIN_AGENT_ID, sessionIds: new Set(), lastMessageId: new Map(), status: 'working' };
    return this.main;
  }

  private resolveSubCharacter(session: SessionRow, startedAt: number): UnifiedCharacter | undefined {
    const name = resolveSubName(session.title);
    if (name) {
      const existing = this.subs.get(name);
      if (existing) return existing;
      if (!this.main) return undefined; // precisa da Manu já existir nesta fonte pra ser "pai"
      const agentId = `hermes:${name.toLowerCase()}`;
      const added = this.opts.office.addSub({
        id: agentId,
        parentId: MAIN_AGENT_ID,
        sessionId: agentId,
        role: name,
        title: name,
        background: false,
        startedAt,
      });
      if (!added) return undefined;
      this.opts.office.setCharacter(agentId, { name, seed: hash32(name), parts: {} });
      const ch: UnifiedCharacter = { agentId, sessionIds: new Set(), lastMessageId: new Map(), status: 'working' };
      this.subs.set(name, ch);
      return ch;
    }

    // subagente sem nome do time reconhecido: 1 personagem por sessão (comportamento antigo)
    const existing = this.adHocSubs.get(session.id);
    if (existing) return existing;
    if (!this.main) return undefined;
    const added = this.opts.office.addSub({
      id: session.id,
      parentId: MAIN_AGENT_ID,
      sessionId: session.id,
      role: session.title || 'Especialista',
      title: session.title ?? undefined,
      background: false,
      startedAt,
    });
    if (!added) return undefined;
    const ch: UnifiedCharacter = { agentId: session.id, sessionIds: new Set(), lastMessageId: new Map(), status: 'working' };
    this.adHocSubs.set(session.id, ch);
    return ch;
  }

  private feedActivity(db: DatabaseSync, session: SessionRow, character: UnifiedCharacter): void {
    const lastId = character.lastMessageId.get(session.id) ?? 0;
    const messages = db
      .prepare(`SELECT id, role, content, tool_calls, tool_name, timestamp FROM messages WHERE session_id = ? AND id > ? ORDER BY id ASC LIMIT 100`)
      .all(session.id, lastId) as unknown as MessageRow[];
    if (!messages.length) return;

    // Novas mensagens reativam um personagem que estava ocioso.
    // Estados de espera por aprovação são preservados.
    if (character.status === 'idle') {
      this.opts.office.setStatus(character.agentId, 'working');
      character.status = 'working';
    }

    character.lastMessageId.set(session.id, messages[messages.length - 1].id);

    for (const m of messages) {
      const at = toMs(m.timestamp) ?? Date.now();
      if (m.role === 'user') {
        this.opts.office.addActivity(character.agentId, { id: `${session.id}:${m.id}`, at, ...describePrompt(m.content ?? '') }, true);
        continue;
      }
      if (m.role === 'assistant') {
        const calls = parseToolCalls(m.tool_calls);
        if (calls.length) {
          calls.forEach((c, i) => {
            this.opts.office.addActivity(character.agentId, { id: `${session.id}:${m.id}:${i}`, at, tool: c.name, ...describeHermesTool(c.name, c.input) }, true);
          });
        } else if (m.content) {
          this.opts.office.addActivity(character.agentId, { id: `${session.id}:${m.id}`, at, ...SPECIAL.respond(m.content) }, true);
        }
        continue;
      }
      if (m.role === 'tool' && looksPendingApproval(m.content)) {
        this.opts.office.setStatus(character.agentId, 'waiting', 'aprovar uma ação');
        character.status = 'waiting';
      }
    }

    // sem atividade nova há um tempo e não está esperando aprovação: volta a ficar ociosa
    if (character.status === 'working') {
      const lastAt = toMs(messages[messages.length - 1]?.timestamp);
      if (lastAt && Date.now() - lastAt > IDLE_AFTER_MS) {
        this.opts.office.setStatus(character.agentId, 'idle');
        character.status = 'idle';
      }
    }
  }
}

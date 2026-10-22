// Tradução de chamadas de ferramenta do HERMES AGENT (a Manu) em atividades
// legíveis (PT-BR) para o Escritório de IA — equivalente ao activity.ts
// original do Habblaud (que só entendia as ferramentas do Claude Code).
//
// Vocabulário real do Hermes (confirmado em state.db de cliente em produção,
// 18/10/2026): browser_click, browser_console, browser_get_images,
// browser_navigate, browser_press, browser_scroll, browser_snapshot,
// browser_type, cronjob, execute_code, memory, patch, process, read_file,
// search_files, send_message, session_search, skill_manage, skill_view,
// terminal, todo, write_file — nada em comum com os nomes do Claude Code
// (Bash, Read, Write, Edit...), por isso esse arquivo é todo novo em vez de
// só adaptar o describeTool original.
import type { ActivityKind, AskQuestion } from './types';
import { describeCommand, truncate, basename, maskSecrets } from './activity';

export interface ActivityDescription {
  kind: ActivityKind;
  icon: string;
  text: string;
  detail?: string;
  questions?: AskQuestion[];
}

function make(kind: ActivityKind, icon: string, text: string, detail?: string): ActivityDescription {
  return {
    kind,
    icon,
    text: truncate(text, 46),
    ...(detail ? { detail: truncate(maskSecrets(detail), 300) } : {}),
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Descreve uma chamada de ferramenta do Hermes Agent. */
export function describeHermesTool(name: string, rawInput: unknown): ActivityDescription {
  const input = (rawInput && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : {}) as Record<string, unknown>;
  const path = str(input.path) || str(input.file_path);

  switch (name) {
    case 'terminal':
      return describeCommand(str(input.command), str(input.description)) as ActivityDescription;
    case 'execute_code':
      return make('run', '▶️', 'Executando código');
    case 'read_file':
      return make('read', '📖', path ? `Lendo ${basename(path)}` : 'Lendo arquivo', path);
    case 'write_file':
      return make('write', '📝', path ? `Escrevendo ${basename(path)}` : 'Escrevendo arquivo', path);
    case 'patch':
      return make('edit', '✏️', path ? `Editando ${basename(path)}` : 'Editando arquivo', path);
    case 'search_files': {
      const q = str(input.query) || str(input.pattern);
      return make('search', '🔎', q ? `Buscando "${truncate(q, 26)}"` : 'Buscando arquivos', q);
    }
    case 'session_search':
      return make('search', '🔎', 'Revendo conversas anteriores');
    case 'memory':
      return make('other', '🧠', 'Atualizando a memória');
    case 'todo':
      return make('plan', '🗒️', 'Atualizando a lista de tarefas');
    case 'skill_manage':
      return make('skill', '🧩', 'Ajustando uma skill');
    case 'skill_view':
      return make('skill', '🧩', 'Consultando uma skill');
    case 'cronjob':
      return make('plan', '⏰', 'Agendando uma tarefa');
    case 'process':
      return make('run', '🛠️', 'Gerenciando um processo');
    case 'send_message':
      return make('communicate', '💬', 'Mandando uma mensagem');
    case 'browser_navigate': {
      const url = str(input.url);
      return make('browser', '🧭', url ? `Abrindo ${url}` : 'Navegando', url);
    }
    case 'browser_click':
      return make('browser', '🖱️', 'Clicando na página');
    case 'browser_type':
      return make('browser', '⌨️', 'Preenchendo formulário');
    case 'browser_scroll':
      return make('browser', '🧭', 'Rolando a página');
    case 'browser_press':
      return make('browser', '⌨️', 'Apertando uma tecla');
    case 'browser_snapshot':
    case 'browser_console':
    case 'browser_get_images':
      return make('browser', '🧭', 'Lendo a página');
    default:
      return make('other', '🛠️', `Usando ${name}`);
  }
}

/** Atividade para uma nova instrução do dono. */
export function describePrompt(text: string): ActivityDescription {
  return make('prompt', '📨', `Nova tarefa: "${truncate(text, 30)}"`, text);
}

export const SPECIAL = {
  think: (): ActivityDescription => make('think', '💭', 'Pensando…'),
  respond: (text?: string): ActivityDescription => make('respond', '💬', 'Escrevendo a resposta', text),
  turnDone: (): ActivityDescription => make('done', '✅', 'Concluiu'),
  error: (tool?: string): ActivityDescription => make('error', '⚠️', tool ? `Erro em ${tool}` : 'Algo deu errado'),
  waiting: (reason?: string): ActivityDescription => make('wait', '✋', reason ? `Precisa de você: ${reason}` : 'Precisa de você'),
} as const;

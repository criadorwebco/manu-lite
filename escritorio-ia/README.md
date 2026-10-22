# 🏢 Escritório de IA

Um escritório virtual em pixel art que mostra a Manu (e qualquer "colega" que
ela delegue tarefa) trabalhando **ao vivo** — lendo direto o `state.db` que o
próprio [Hermes Agent](https://github.com/NousResearch/hermes-agent) grava em
`~/.hermes`. Sem gravação, sem mock: é a sessão real acontecendo na tela.

É um fork do [Habblaud](https://github.com/marmottajr/habblaud) (MIT, veja
`LICENSE-habblaud`), adaptado pra ler o Hermes em vez do Claude Code — a
engine visual (o prédio, os andares, os bonecos em pixel art) é 100% a
original deles, sem nenhuma mudança. Só trocamos a fonte dos dados.

Essa é a versão aberta/independente, pra rodar no seu próprio servidor ao
lado do Hermes. **Não** é o produto completo da GuildaHub — lá a Manu tem
orquestração automática de verdade entre os colegas, voz em tempo real,
instalador de 1 clique e domínio/HTTPS prontos. Aqui você sobe na mão.

## O que você precisa

- O [Hermes Agent](https://github.com/NousResearch/hermes-agent) já rodando
  nesse mesmo servidor (`~/.hermes/state.db` precisa existir)
- Docker + Docker Compose

## Subindo

```bash
cd escritorio-ia
docker compose up -d --build
```

Abre em `http://localhost:4747` (ou `http://ip-do-servidor:4747`).

## Configuração

Tudo fica no `docker-compose.yml`:

- `HERMES_OWNER_NAME` — o nome que aparece como "chefe" no escritório (o seu)
- `HABBLAUD_ALLOWED_HOSTS` — se for acessar por um domínio (não só
  `localhost`), lista o domínio aqui, senão o servidor recusa a conexão por
  segurança (proteção contra DNS rebinding)
- `HABBLAUD_ACCESS_TOKEN` — opcional. Se expuser isso num domínio público
  (não só na sua rede local), defina um token aleatório aqui e acesse com
  `https://seudominio.com/set-access?t=SEU_TOKEN` na primeira vez — isso seta
  um cookie e libera o acesso. Sem essa variável, qualquer um que ache a URL
  consegue ver o escritório.

## Como funciona

O servidor lê o SQLite do Hermes em modo somente-leitura (`server/sources/hermes-watcher.ts`)
e traduz cada sessão/ferramenta chamada pelo Hermes num evento genérico que a
engine visual (vendorizada do Habblaud, sem mudança) já sabe desenhar. Cada
canal (Telegram, voz, API) que conversa com a Manu aparece como **a mesma
Manu**, não um personagem por canal — a identidade é unificada pelo nome.

Delegações pra um "colega" (se o Hermes estiver configurado com um time) só
aparecem quando o Hermes de fato cria uma sessão filha pra esse colega —
ninguém fica "de plantão" visível sem ter sido chamado.

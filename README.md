# 🤖 Manu (versão simples)

Uma versão enxuta da **Manu** — assistente de IA pessoal que roda em cima do
[Hermes Agent](https://github.com/NousResearch/hermes-agent) (open source) —
e um [escritório visual](./escritorio-ia) pra ver ela trabalhando ao vivo.

Isso **não** é o produto completo da GuildaHub. Tem uma versão bem simples
do time (Giovana, Thiago, Leonardo, Rafael, Mel e Dudu), mas sem voz, sem
orquestração automática entre eles, sem instalador de 1 clique, sem suporte.
É a Manu no básico, pra rodar no seu próprio servidor.

## O que tem neste repo

| Pasta/arquivo | O que é |
|---|---|
| `SOUL.md` + `AGENTS.md` | Identidade e regras básicas da Manu |
| `team/` | Versão simples de 6 "colegas" (sem orquestração automática) |
| `install.sh` | Instala o Hermes Agent + planta a persona da Manu |
| [`escritorio-ia/`](./escritorio-ia) | Escritório virtual em pixel art pra ver a Manu trabalhando ao vivo (fork do [Habblaud](https://github.com/marmottajr/habblaud), MIT) |

## O que você precisa

- Um servidor/VPS com Linux (Ubuntu/Debian de preferência)
- Um bot do Telegram (crie em [@BotFather](https://t.me/BotFather) e pegue o token)
- Uma chave de API de algum provedor suportado pelo Hermes (ex: [OpenRouter](https://openrouter.ai/))

## Instalação rápida

```bash
curl -fsSL https://raw.githubusercontent.com/thiagomurtasoares/manu-lite/main/install.sh | bash
```

Isso instala o Hermes Agent (se ainda não tiver) e planta a persona da Manu
(`SOUL.md` + `AGENTS.md`) em `~/.hermes/`. Depois é só:

```bash
hermes setup            # configura sua chave de API e o bot do Telegram
hermes gateway install  # deixa ela rodando sempre, mesmo se o servidor reiniciar
```

Pronto — a Manu já responde no seu Telegram.

## Instalação manual

Prefere fazer na mão? Segue o guia oficial do
[Hermes Agent](https://github.com/NousResearch/hermes-agent) e depois copie
`SOUL.md` e `AGENTS.md` deste repo pra dentro de `~/.hermes/`.

Sobre o `team/`: são arquivos simples que a própria Manu lê quando o assunto
é claramente de um deles (ex: pergunta de código → ela lê `leonardo-dev.md`
e responde nesse papel). Não tem orquestração automática nem delegação real
entre eles — é bem mais rústico que o produto completo.

## Quer ver ela trabalhando?

Depois de instalar a Manu acima, suba o [`escritorio-ia/`](./escritorio-ia)
— um escritório em pixel art que lê o Hermes ao vivo e mostra cada
conversa/ferramenta acontecendo em tempo real.

## Quer o pacote completo?

Essas versões são só a ponta do iceberg. O produto de verdade da GuildaHub tem:

- 🧑‍💻 O time de verdade, com **orquestração automática** — a Manu delega
  a tarefa pro especialista certo sozinha, sem você precisar pedir
- 🎙️ **Voz em tempo real** — fala com ela, ela responde por voz
- 🏢🎙️ **Escritório com a voz integrada e domínio/HTTPS prontos** — sem
  configurar nada na mão, e um **Guilda Office em 3D** à parte
- ⚡ **Instalador de 1 clique** — zero servidor, zero Docker, zero
  configuração na mão
- 🛟 Suporte de verdade quando algo travar

👉 **[guildahub.com](https://guildahub.com)**

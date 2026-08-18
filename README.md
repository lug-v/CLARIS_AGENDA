# Clari — Agenda Inteligente

Agenda web que transforma texto, gravações de voz e fotos em compromissos estruturados. A interpretação é feita pela Groq e sempre passa por uma tela de confirmação antes de entrar na agenda.

## Recursos do MVP

- interpretação de compromissos escritos em linguagem natural;
- transcrição de áudio em português com Whisper;
- leitura de fotos e páginas de agenda;
- revisão de título, data, horários e local;
- interface responsiva para computador e celular;
- instalação como aplicativo (PWA) em Android, iPhone e computador.

## Instalar no celular

- **Android (Chrome):** abra o site, toque no menu e escolha **Instalar app** ou **Adicionar à tela inicial**.
- **iPhone (Safari):** abra o site, toque em **Compartilhar** e escolha **Adicionar à Tela de Início**.

Depois de instalada, a Clari abre em uma janela própria e fica disponível pelo ícone na tela inicial.

## Executar localmente

Requer Node.js 22 ou mais recente.

```bash
npm install
```

Crie `.env.local` usando `.env.example` como referência:

```env
GROQ_API_KEY=sua_chave_da_groq
DATABASE_URL=postgresql://usuario:senha@host/neondb?sslmode=require
```

Inicie o projeto:

```bash
npm run dev
```

A chave da Groq nunca deve ser adicionada ao GitHub. Arquivos `.env*` são ignorados, com exceção do modelo seguro `.env.example`.

## Banco de dados

A Clari usa PostgreSQL com o driver serverless do Neon. Na Vercel, conecte uma integração Neon ao projeto ou defina `DATABASE_URL` em **Settings → Environment Variables**. A tabela e o índice da agenda são criados automaticamente na primeira requisição.

Enquanto não houver login, cada navegador recebe um identificador protegido por cookie e enxerga apenas os próprios compromissos. Limpar os cookies cria uma agenda nova; o vínculo entre aparelhos será adicionado junto da autenticação e do Telegram.

## Telegram

Crie um bot pelo `@BotFather` com o comando `/newbot`. Guarde o token como senha e configure na Vercel:

```env
TELEGRAM_BOT_TOKEN=token_fornecido_pelo_botfather
APP_URL=https://claris-agenda.vercel.app
```

O webhook é registrado automaticamente ao gerar o primeiro link de conexão. Para registro manual durante o desenvolvimento, use os mesmos valores em `.env.local` e execute:

```bash
npm run telegram:setup
```

Na Clari, gere um link temporário para vincular a conversa. O bot aceita texto, áudio e foto, mostra os dados interpretados e só salva após a confirmação do usuário. O comando `/agenda` lista os compromissos do dia.

## Tecnologias

Next.js, React, TypeScript, Vercel e Groq API.

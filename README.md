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
```

Inicie o projeto:

```bash
npm run dev
```

A chave da Groq nunca deve ser adicionada ao GitHub. Arquivos `.env*` são ignorados, com exceção do modelo seguro `.env.example`.

## Tecnologias

Next.js, React, TypeScript, Vercel e Groq API.

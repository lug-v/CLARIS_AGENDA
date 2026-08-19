# Arquitetura de automações da Clari

## Objetivo

Evoluir a Clari de uma agenda que registra compromissos para uma assistente que detecta conflitos, envia resumos e executa lembretes de forma segura e idempotente.

## Fluxo

1. Página ou Telegram recebe texto, áudio ou imagem.
2. A camada de intenção separa consultas de criação de compromissos.
3. Groq transforma a entrada em um ou até dez rascunhos estruturados.
4. O serviço de agenda valida datas, recorrência, horários e conflitos.
5. O Neon persiste eventos, séries, preferências e entregas pendentes.
6. Consultas do Telegram leem intervalos como hoje, amanhã e próxima semana.
7. A exclusão remove somente o evento selecionado e seus lembretes.
8. Um worker protegido processa automações vencidas.
9. O Telegram entrega resumos e lembretes.

## Componentes

- `agenda_events`: fonte principal dos compromissos.
- `automation_preferences`: fuso, resumo diário e lembretes padrão por proprietário.
- `event_reminders`: fila persistente para lembretes de eventos.
- `automation_deliveries`: controle idempotente de resumos e outras entregas.
- `/api/cron/daily-summary`: worker protegido por `CRON_SECRET`.
- `lib/calendar.ts`: regras compartilhadas de conflito.
- `lib/recurrence.ts`: normalização e expansão atômica de séries recorrentes.
- `lib/agenda-query.ts`: interpretação determinística de consultas do Telegram.
- `lib/automations.ts`: processamento de resumos e, futuramente, lembretes.

## Fases

1. Detecção de conflitos, tabelas-base e resumo diário pelo Telegram.
2. Disparador frequente para lembretes de 24 horas, 1 hora e horário inicial.
3. Recorrência, consultas por período e exclusão de ocorrências.
4. Consulta de horários livres, reagendamento e cancelamento de séries inteiras.
5. Tempo de deslocamento, regras de confiança e autenticação entre aparelhos.

## Operação

O plano Hobby da Vercel executa Cron apenas uma vez por dia e sem precisão de minuto. O resumo diário usa esse limite. A fila de lembretes fica pronta para um disparador mais frequente, como GitHub Actions ou Vercel Pro, sem alteração no domínio ou banco.

Toda rota de automação deve exigir `Authorization: Bearer <CRON_SECRET>`. Entregas usam chave única por usuário, tipo e data para impedir duplicidade.

# Arquitetura de automações da Clari

## Objetivo

Evoluir a Clari de uma agenda que registra compromissos para uma assistente que detecta conflitos, envia resumos e executa lembretes de forma segura e idempotente.

## Fluxo

1. Página ou Telegram recebe texto, áudio ou imagem.
2. A camada de interpretação transforma a entrada em uma intenção e dados estruturados.
3. O serviço de agenda valida datas, horários e conflitos.
4. O Neon persiste eventos, preferências e entregas pendentes.
5. Um worker protegido processa automações vencidas.
6. O Telegram entrega resumos e lembretes.

## Componentes

- `agenda_events`: fonte principal dos compromissos.
- `automation_preferences`: fuso, resumo diário e lembretes padrão por proprietário.
- `event_reminders`: fila persistente para lembretes de eventos.
- `automation_deliveries`: controle idempotente de resumos e outras entregas.
- `/api/cron/daily-summary`: worker protegido por `CRON_SECRET`.
- `lib/calendar.ts`: regras compartilhadas de conflito.
- `lib/automations.ts`: processamento de resumos e, futuramente, lembretes.

## Fases

1. Detecção de conflitos, tabelas-base e resumo diário pelo Telegram.
2. Disparador frequente para lembretes de 24 horas, 1 hora e horário inicial.
3. Recorrência, consulta de horários livres, reagendamento e cancelamento.
4. Tempo de deslocamento, regras de confiança e autenticação entre aparelhos.

## Operação

O plano Hobby da Vercel executa Cron apenas uma vez por dia e sem precisão de minuto. O resumo diário usa esse limite. A fila de lembretes fica pronta para um disparador mais frequente, como GitHub Actions ou Vercel Pro, sem alteração no domínio ou banco.

Toda rota de automação deve exigir `Authorization: Bearer <CRON_SECRET>`. Entregas usam chave única por usuário, tipo e data para impedir duplicidade.

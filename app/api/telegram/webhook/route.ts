import { timingSafeEqual } from "node:crypto";
import { ensureDatabaseSchema, getDatabase } from "@/lib/db";
import { CalendarEventDraft, interpretImageEvents, interpretTextEvents, transcribeAudio } from "@/lib/groq";
import { findCalendarConflicts } from "@/lib/calendar";
import { scheduleDefaultReminders } from "@/lib/automations";
import { AgendaRange, detectAgendaQuery } from "@/lib/agenda-query";
import { expandRecurrence, normalizeRecurrence, recurrenceLabel } from "@/lib/recurrence";
import { todayInSaoPaulo } from "@/lib/agenda-query";
import {
  detectExpenseIntent,
  detectExpenseQuery,
  ExpenseDraft,
  formatBRL,
  formatDateBR,
  stripExpenseCommand,
} from "@/lib/expense-core";
import {
  buildMonthSummary,
  cancelPendingExpense,
  confirmPendingExpense,
  deleteExpense,
  ExpenseSource,
  interpretExpenseText,
  interpretReceiptImage,
  savePendingExpense,
} from "@/lib/expenses";
import {
  answerTelegramCallback,
  downloadTelegramFile,
  editTelegramMessage,
  sendTelegramChatAction,
  sendTelegramMessage,
  telegramWebhookSecret,
  telegramFileAsDataUrl,
} from "@/lib/telegram";

export const runtime = "nodejs";

type TelegramUser = { id: number; username?: string };
type TelegramChat = { id: number; type: string };
type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  voice?: { file_id: string };
  photo?: Array<{ file_id: string; file_size?: number }>;
};
type TelegramCallback = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};
type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallback;
};

function validWebhookSecret(received: string | null) {
  if (!received || !process.env.TELEGRAM_BOT_TOKEN) return false;
  const expected = telegramWebhookSecret();
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function draftMessage(event: CalendarEventDraft, conflictTitles: string[] = []) {
  const dateLabel = event.endDate && event.endDate !== event.date
    ? `${formatDate(event.date)} até ${formatDate(event.endDate)}`
    : formatDate(event.date);
  return [
    "📅 Confira antes de agendar",
    "",
    `Título: ${event.title}`,
    `Data: ${dateLabel}`,
    `Horário: ${event.startTime}${event.endTime ? `–${event.endTime}` : ""}`,
    event.location ? `Local: ${event.location}` : "",
    event.notes ? `Observações: ${event.notes}` : "",
    recurrenceLabel(event) ? `Repetição: ${recurrenceLabel(event)}` : "",
    conflictTitles.length ? `⚠️ Conflito com: ${conflictTitles.join(", ")}` : "",
    "",
    `Confiança: ${Math.round(event.confidence * 100)}%`,
  ].filter(Boolean).join("\n");
}

async function sendDraft(chatId: number, ownerId: string, event: CalendarEventDraft) {
  const sql = getDatabase();
  const conflicts = await findCalendarConflicts(ownerId, event);
  const id = crypto.randomUUID();
  await sql`DELETE FROM telegram_pending_events WHERE chat_id = ${chatId} AND expires_at < NOW()`;
  await sql`
    INSERT INTO telegram_pending_events (
      id, chat_id, owner_id, title, event_date, end_date, start_time, end_time,
      location, notes, source_text, confidence, recurrence, recurrence_interval,
      recurrence_weekdays, recurrence_until, recurrence_count, expires_at
    ) VALUES (
      ${id}::uuid, ${chatId}, ${ownerId}::uuid, ${event.title}, ${event.date}::date, ${event.endDate}::date,
      ${event.startTime}::time, ${event.endTime || null}::time, ${event.location},
      ${event.notes}, ${event.sourceText}, ${event.confidence}, ${event.recurrence},
      ${event.recurrenceInterval}, ${event.recurrenceWeekdays}, ${event.recurrenceUntil || null}::date,
      ${event.recurrenceCount}, NOW() + INTERVAL '30 minutes'
    )
  `;
  await sendTelegramMessage(chatId, draftMessage(event, conflicts.map((conflict) => conflict.title)), {
    inline_keyboard: [[
      { text: "✅ Confirmar", callback_data: `confirm:${id}` },
      { text: "❌ Cancelar", callback_data: `cancel:${id}` },
    ]],
  });
}

async function connectChat(message: TelegramMessage, code: string) {
  const sql = getDatabase();
  const links = await sql`
    DELETE FROM telegram_link_codes
    WHERE code = ${code} AND expires_at > NOW()
    RETURNING owner_id::text AS "ownerId"
  `;
  if (!links[0]) {
    await sendTelegramMessage(message.chat.id, "Este link expirou ou já foi usado. Gere um novo link na Clari.");
    return;
  }

  const ownerId = String(links[0].ownerId);
  await sql`DELETE FROM telegram_connections WHERE owner_id = ${ownerId}::uuid OR chat_id = ${message.chat.id}`;
  await sql`
    INSERT INTO telegram_connections (chat_id, owner_id, telegram_user_id, telegram_username)
    VALUES (
      ${message.chat.id}, ${ownerId}::uuid, ${message.from?.id || message.chat.id},
      ${message.from?.username || ""}
    )
  `;
  await sql`
    INSERT INTO automation_preferences (owner_id)
    VALUES (${ownerId}::uuid)
    ON CONFLICT (owner_id) DO NOTHING
  `;
  await sendTelegramMessage(
    message.chat.id,
    "✅ Telegram conectado à Clari!\n\nAgora envie um compromisso por texto, áudio ou foto. Eu mostrarei os dados para você confirmar antes de salvar.",
  );
}

async function showAgenda(chatId: number, ownerId: string, range: AgendaRange) {
  const sql = getDatabase();
  const events = await sql`
    SELECT title, event_date::text AS date, COALESCE(end_date, event_date)::text AS "endDate",
      to_char(start_time, 'HH24:MI') AS time, location
    FROM agenda_events
    WHERE owner_id = ${ownerId}::uuid
      AND event_date <= ${range.end}::date
      AND COALESCE(end_date, event_date) >= ${range.start}::date
    ORDER BY event_date, start_time
  `;
  if (!events.length) {
    await sendTelegramMessage(chatId, `Você não tem compromissos ${range.label}.`);
    return;
  }
  const lines = events.map((event) => {
    const period = event.endDate !== event.date
      ? `${formatDate(String(event.date))}–${formatDate(String(event.endDate))}`
      : formatDate(String(event.date));
    return `${period} · ${event.time} — ${event.title}${event.location ? ` · ${event.location}` : ""}`;
  });
  await sendTelegramMessage(chatId, [`📆 Sua agenda ${range.label}`, "", ...lines].join("\n"));
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function expenseDraftMessage(expense: ExpenseDraft) {
  return [
    "💰 Confira o gasto antes de registrar",
    "",
    `Valor: ${formatBRL(expense.amount)}`,
    `Data: ${formatDateBR(expense.date)}`,
    expense.merchant ? `Onde: ${expense.merchant}` : "",
    expense.description ? `O quê: ${expense.description}` : "",
    `Categoria: ${expense.category}`,
    `Pagamento: ${expense.paymentMethod}`,
    expense.items.length ? `Itens lidos: ${expense.items.length}` : "",
    "",
    `Confiança: ${Math.round(expense.confidence * 100)}%`,
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");
}

async function sendExpenseDrafts(chatId: number, ownerId: string, expenses: ExpenseDraft[], source: ExpenseSource) {
  if (!expenses.length) {
    await sendTelegramMessage(chatId, "Não encontrei o valor do gasto. Tente algo como “gastei 45,90 no mercado no Pix”.");
    return;
  }
  for (const expense of expenses) {
    const id = await savePendingExpense(chatId, ownerId, expense, source);
    await sendTelegramMessage(chatId, expenseDraftMessage(expense), {
      inline_keyboard: [[
        { text: "✅ Registrar", callback_data: `econfirm:${id}` },
        { text: "❌ Cancelar", callback_data: `ecancel:${id}` },
      ]],
    });
  }
}

async function processMessage(message: TelegramMessage) {
  if (message.chat.type !== "private") return;
  const text = message.text?.trim() || "";
  const startMatch = text.match(/^\/start(?:\s+([A-Za-z0-9_-]+))?$/);
  if (startMatch?.[1]) {
    await connectChat(message, startMatch[1]);
    return;
  }
  if (startMatch) {
    await sendTelegramMessage(message.chat.id, "Abra a área de integração da Clari e use o botão “Conectar Telegram” para vincular esta conversa.");
    return;
  }

  const sql = getDatabase();
  const connections = await sql`
    SELECT owner_id::text AS "ownerId"
    FROM telegram_connections
    WHERE chat_id = ${message.chat.id}
  `;
  if (!connections[0]) {
    await sendTelegramMessage(message.chat.id, "Este Telegram ainda não está vinculado. Abra a Clari e gere um link de conexão.");
    return;
  }
  const ownerId = String(connections[0].ownerId);

  const expenseQuery = detectExpenseQuery(text, todayInSaoPaulo());
  if (expenseQuery) {
    await sendTelegramMessage(message.chat.id, await buildMonthSummary(ownerId, expenseQuery));
    return;
  }
  const textQuery = detectAgendaQuery(text);
  if (textQuery) {
    await showAgenda(message.chat.id, ownerId, textQuery);
    return;
  }
  if (text === "/ajuda") {
    await sendTelegramMessage(message.chat.id, [
      "📅 Agenda: envie texto, áudio ou foto de um compromisso. Pergunte “o que tenho amanhã?” ou use /agenda.",
      "",
      "💰 Gastos: diga “gastei 45 no mercado no Pix”, use /gasto ou envie a foto da nota fiscal.",
      "Veja o resumo com /gastos, “/gastos mês passado” ou “quanto gastei em setembro?”.",
    ].join("\n"));
    return;
  }

  await sendTelegramChatAction(message.chat.id, "typing");
  let events: CalendarEventDraft[];
  if (message.voice) {
    const audio = await downloadTelegramFile(message.voice.file_id, "compromisso.ogg");
    const transcript = await transcribeAudio(audio);
    const voiceExpenseQuery = detectExpenseQuery(transcript, todayInSaoPaulo());
    if (voiceExpenseQuery) {
      await sendTelegramMessage(message.chat.id, await buildMonthSummary(ownerId, voiceExpenseQuery));
      return;
    }
    const voiceQuery = detectAgendaQuery(transcript);
    if (voiceQuery) {
      await showAgenda(message.chat.id, ownerId, voiceQuery);
      return;
    }
    if (detectExpenseIntent(transcript)) {
      await sendExpenseDrafts(message.chat.id, ownerId, await interpretExpenseText(transcript), "audio");
      return;
    }
    events = await interpretTextEvents(transcript);
  } else if (message.photo?.length) {
    const photo = message.photo[message.photo.length - 1];
    const image = await telegramFileAsDataUrl(photo.file_id);
    // Primeiro verifica se é nota/comprovante; se não for, segue como agenda.
    const reading = await interpretReceiptImage(image, message.caption || "");
    if (reading.kind === "receipt") {
      await sendExpenseDrafts(message.chat.id, ownerId, [reading.expense], "foto");
      return;
    }
    events = await interpretImageEvents(image, message.caption || "Compromissos extraídos de uma foto enviada pelo Telegram");
  } else if (text && detectExpenseIntent(text)) {
    const content = stripExpenseCommand(text);
    if (!content) {
      await sendTelegramMessage(message.chat.id, "Descreva o gasto depois do comando, por exemplo: /gasto 32,50 almoço no débito.");
      return;
    }
    await sendExpenseDrafts(message.chat.id, ownerId, await interpretExpenseText(content), "texto");
    return;
  } else if (text && !text.startsWith("/")) {
    events = await interpretTextEvents(text);
  } else {
    await sendTelegramMessage(message.chat.id, "Envie um compromisso ou um gasto por texto, áudio ou foto. Use /ajuda para ver as opções.");
    return;
  }
  for (const event of events) await sendDraft(message.chat.id, ownerId, event);
}

async function processExpenseCallback(callback: TelegramCallback, message: TelegramMessage, action: string, id: string) {
  if (!UUID_PATTERN.test(id)) {
    await answerTelegramCallback(callback.id);
    return;
  }
  if (action === "ecancel") {
    await cancelPendingExpense(id, message.chat.id);
    await answerTelegramCallback(callback.id, "Cancelado");
    await editTelegramMessage(message.chat.id, message.message_id, "❌ Gasto não registrado.");
    return;
  }
  if (action === "econfirm") {
    await answerTelegramCallback(callback.id, "Registrando...");
    const saved = await confirmPendingExpense(id, message.chat.id);
    if (!saved) {
      await editTelegramMessage(message.chat.id, message.message_id, "Este gasto expirou ou já foi processado.");
      return;
    }
    const { expense, expenseId } = saved;
    await editTelegramMessage(
      message.chat.id,
      message.message_id,
      `✅ Gasto registrado!\n\n${formatBRL(expense.amount)} · ${expense.category}\n${formatDateBR(expense.date)}${expense.merchant ? ` · ${expense.merchant}` : ""}`,
      { inline_keyboard: [[{ text: "↩️ Desfazer", callback_data: `eundo:${expenseId}` }]] },
    );
    return;
  }
  if (action === "eundo") {
    const sql = getDatabase();
    const connections = await sql`
      SELECT owner_id::text AS "ownerId" FROM telegram_connections WHERE chat_id = ${message.chat.id}
    `;
    const removed = connections[0] ? await deleteExpense(id, String(connections[0].ownerId)) : false;
    await answerTelegramCallback(callback.id, removed ? "Desfeito" : "Já removido");
    await editTelegramMessage(message.chat.id, message.message_id, removed ? "↩️ Gasto removido." : "Este gasto já tinha sido removido.");
    return;
  }
  await answerTelegramCallback(callback.id);
}

async function processCallback(callback: TelegramCallback) {
  const message = callback.message;
  const data = callback.data || "";
  if (!message || !data.includes(":")) {
    await answerTelegramCallback(callback.id);
    return;
  }
  const [action, id] = data.split(":", 2);
  if (["econfirm", "ecancel", "eundo"].includes(action)) {
    await processExpenseCallback(callback, message, action, id);
    return;
  }
  const sql = getDatabase();

  if (action === "cancel") {
    await sql`DELETE FROM telegram_pending_events WHERE id = ${id}::uuid AND chat_id = ${message.chat.id}`;
    await answerTelegramCallback(callback.id, "Cancelado");
    await editTelegramMessage(message.chat.id, message.message_id, "❌ Compromisso cancelado.");
    return;
  }
  if (action !== "confirm") {
    await answerTelegramCallback(callback.id);
    return;
  }

  await answerTelegramCallback(callback.id, "Salvando...");
  const pending = await sql`
    DELETE FROM telegram_pending_events
    WHERE id = ${id}::uuid AND chat_id = ${message.chat.id} AND expires_at > NOW()
    RETURNING
      owner_id::text AS "ownerId", title, event_date::text AS date,
      COALESCE(end_date, event_date)::text AS "endDate",
      to_char(start_time, 'HH24:MI') AS "startTime",
      COALESCE(to_char(end_time, 'HH24:MI'), '') AS "endTime",
      location, notes, source_text AS "sourceText",
      recurrence, recurrence_interval AS "recurrenceInterval",
      recurrence_weekdays AS "recurrenceWeekdays",
      COALESCE(recurrence_until::text, '') AS "recurrenceUntil",
      recurrence_count AS "recurrenceCount"
  `;
  if (!pending[0]) {
    await editTelegramMessage(message.chat.id, message.message_id, "Este pedido expirou ou já foi processado.");
    return;
  }

  const event = pending[0];
  const recurrence = normalizeRecurrence({
    recurrence: String(event.recurrence) as CalendarEventDraft["recurrence"],
    recurrenceInterval: Number(event.recurrenceInterval),
    recurrenceWeekdays: event.recurrenceWeekdays as number[],
    recurrenceUntil: String(event.recurrenceUntil),
    recurrenceCount: Number(event.recurrenceCount),
  }, String(event.date));
  const occurrences = expandRecurrence({ date: String(event.date), endDate: String(event.endDate), ...recurrence });
  const seriesId = recurrence.recurrence === "none" ? null : crypto.randomUUID();
  const recurrenceRule = recurrence.recurrence === "none" ? null : JSON.stringify(recurrence);
  const preparedOccurrences = occurrences.map((occurrence) => ({ id: crypto.randomUUID(), ...occurrence }));
  await sql`
    INSERT INTO agenda_events (
      id, owner_id, title, event_date, end_date, start_time, end_time, location, notes,
      source_text, series_id, occurrence_index, recurrence_rule
    )
    SELECT
      item.id::uuid, ${event.ownerId}::uuid, ${event.title}, item.date::date, item."endDate"::date,
      ${event.startTime}::time, ${event.endTime || null}::time, ${event.location}, ${event.notes},
      ${event.sourceText}, ${seriesId}::uuid, item."occurrenceIndex", ${recurrenceRule}::jsonb
    FROM jsonb_to_recordset(${JSON.stringify(preparedOccurrences)}::jsonb)
      AS item(id text, date text, "endDate" text, "occurrenceIndex" integer)
  `;
  for (const occurrence of preparedOccurrences) {
    try {
      await scheduleDefaultReminders(String(event.ownerId), occurrence.id, {
        date: occurrence.date,
        startTime: String(event.startTime),
      });
    } catch (reminderError) {
      console.error("Compromisso salvo pelo Telegram, mas os lembretes não foram preparados:", reminderError);
    }
  }
  await editTelegramMessage(
    message.chat.id,
    message.message_id,
    `✅ ${preparedOccurrences.length > 1 ? `${preparedOccurrences.length} compromissos salvos` : "Compromisso salvo"}!\n\n${event.title}\n${formatDate(String(event.date))}${event.endDate !== event.date ? ` até ${formatDate(String(event.endDate))}` : ""} · ${event.startTime}${event.endTime ? `–${event.endTime}` : ""}`,
  );
}

export async function POST(request: Request) {
  if (!validWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  let update: TelegramUpdate | null = null;
  try {
    update = await request.json() as TelegramUpdate;
    await ensureDatabaseSchema();
    const sql = getDatabase();
    const inserted = await sql`
      INSERT INTO telegram_updates (update_id)
      VALUES (${update.update_id})
      ON CONFLICT (update_id) DO NOTHING
      RETURNING update_id
    `;
    if (!inserted[0]) return Response.json({ ok: true, duplicate: true });
    await sql`DELETE FROM telegram_updates WHERE received_at < NOW() - INTERVAL '7 days'`;

    if (update.callback_query) await processCallback(update.callback_query);
    else if (update.message) await processMessage(update.message);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Erro no webhook do Telegram:", error);
    const chatId = update?.message?.chat.id || update?.callback_query?.message?.chat.id;
    if (chatId) {
      try {
        await sendTelegramMessage(chatId, "Não consegui processar isso agora. Tente novamente em alguns instantes.");
      } catch (replyError) {
        console.error("Erro ao responder no Telegram:", replyError);
      }
    }
    return Response.json({ ok: true });
  }
}

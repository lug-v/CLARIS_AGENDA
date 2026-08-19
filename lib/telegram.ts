type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type TelegramFile = {
  file_path?: string;
  file_size?: number;
};

function botToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN_NOT_CONFIGURED");
  return token;
}

export function isTelegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export function telegramWebhookSecret() {
  return createHash("sha256").update(`clari-telegram:${botToken()}`).digest("hex");
}

export async function telegramRequest<T>(method: string, payload: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = (await response.json()) as TelegramApiResponse<T>;
  if (!response.ok || !data.ok) throw new Error(data.description || `TELEGRAM_${method.toUpperCase()}_FAILED`);
  return data.result as T;
}

export async function getTelegramBotUsername() {
  const bot = await telegramRequest<{ username?: string }>("getMe", {});
  if (!bot.username) throw new Error("TELEGRAM_BOT_USERNAME_MISSING");
  return bot.username;
}

export async function ensureTelegramWebhook(origin: string) {
  const appUrl = (process.env.APP_URL || origin).replace(/\/$/, "");
  await telegramRequest("setWebhook", {
    url: `${appUrl}/api/telegram/webhook`,
    secret_token: telegramWebhookSecret(),
    allowed_updates: ["message", "callback_query"],
  });
  await telegramRequest("setMyCommands", {
    commands: [
      { command: "agenda", description: "Consultar hoje, amanhã ou a próxima semana" },
      { command: "ajuda", description: "Ver como usar a Clari" },
    ],
  });
}

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: Record<string, unknown>,
) {
  return telegramRequest("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function editTelegramMessage(chatId: string | number, messageId: number, text: string) {
  return telegramRequest("editMessageText", { chat_id: chatId, message_id: messageId, text });
}

export async function answerTelegramCallback(callbackQueryId: string, text?: string) {
  return telegramRequest("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

export async function sendTelegramChatAction(chatId: string | number, action: "typing") {
  return telegramRequest("sendChatAction", { chat_id: chatId, action });
}

export async function downloadTelegramFile(fileId: string, fallbackName: string) {
  const file = await telegramRequest<TelegramFile>("getFile", { file_id: fileId });
  if (!file.file_path) throw new Error("TELEGRAM_FILE_PATH_MISSING");
  if (file.file_size && file.file_size > 20 * 1024 * 1024) throw new Error("TELEGRAM_FILE_TOO_LARGE");

  const response = await fetch(`https://api.telegram.org/file/bot${botToken()}/${file.file_path}`, { cache: "no-store" });
  if (!response.ok) throw new Error("TELEGRAM_FILE_DOWNLOAD_FAILED");
  const type = response.headers.get("content-type") || "application/octet-stream";
  return new File([await response.arrayBuffer()], fallbackName, { type });
}

export async function telegramFileAsDataUrl(fileId: string) {
  const file = await downloadTelegramFile(fileId, "agenda.jpg");
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  return `data:${file.type};base64,${base64}`;
}
import { createHash } from "node:crypto";

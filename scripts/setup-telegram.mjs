import { createHash } from "node:crypto";

const token = process.env.TELEGRAM_BOT_TOKEN;
const appUrl = process.env.APP_URL || "https://claris-agenda.vercel.app";

if (!token) throw new Error("Configure TELEGRAM_BOT_TOKEN antes de registrar o webhook.");
const secret = createHash("sha256").update(`clari-telegram:${token}`).digest("hex");

const api = async (method, payload = {}) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `${method} falhou`);
  return data.result;
};

const bot = await api("getMe");
const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/telegram/webhook`;
await api("setWebhook", {
  url: webhookUrl,
  secret_token: secret,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: true,
});
await api("setMyCommands", {
  commands: [
    { command: "agenda", description: "Ver os compromissos de hoje" },
    { command: "ajuda", description: "Ver como usar a Clari" },
  ],
});

console.log(`Bot @${bot.username} conectado ao webhook ${webhookUrl}`);

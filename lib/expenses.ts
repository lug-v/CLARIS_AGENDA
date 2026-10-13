import { getDatabase } from "@/lib/db";
import { GROQ_MODEL, groq, todayInSaoPaulo, weekdayInSaoPaulo } from "@/lib/groq";
import {
  CategoryTotal,
  EXPENSE_CATEGORIES,
  ExpenseDraft,
  ExpenseMonth,
  normalizeExpense,
  PAYMENT_METHODS,
  summaryMessage,
} from "@/lib/expense-core";

export type ExpenseSource = "texto" | "audio" | "foto";

const MAX_EXPENSES = 10;

const expenseFieldRules = `Cada gasto usa exatamente: amount, date, merchant, description, category, paymentMethod, items, confidence, sourceText.
- amount é o valor total pago, em reais, como número (ex.: 45.9). Nunca invente valor.
- date é a data do gasto em YYYY-MM-DD. "Ontem", "sexta" etc. são resolvidos com a data atual informada. Sem data, use hoje.
- merchant é o estabelecimento ou quem recebeu (ex.: "Uber", "Supermercado Andreazza"). Vazio se não houver.
- description resume o que foi comprado em poucas palavras.
- category deve ser exatamente uma de: ${EXPENSE_CATEGORIES.join(", ")}.
- Use Alimentação para restaurante, lanche, delivery e café; Mercado para supermercado e feira; Assinaturas para serviços mensais como streaming e academia.
- paymentMethod deve ser exatamente um de: ${PAYMENT_METHODS.join(", ")}.
- items lista os produtos quando aparecerem (name, quantity, total). Caso contrário, use lista vazia.
- confidence vai de 0 a 1. Reduza quando o valor ou a categoria forem incertos.
- sourceText contém apenas o trecho do pedido que originou aquele gasto.`;

function parseJson(result: { choices?: Array<{ message?: { content?: string } }> }) {
  try {
    return JSON.parse(result.choices?.[0]?.message?.content || "{}") as Record<string, unknown>;
  } catch {
    throw new Error("GROQ_INVALID_JSON");
  }
}

function asRecords(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .slice(0, MAX_EXPENSES);
}

export async function interpretExpenseText(text: string): Promise<ExpenseDraft[]> {
  const today = todayInSaoPaulo();
  const result = await groq("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GROQ_MODEL,
      response_format: { type: "json_object" },
      reasoning_effort: "none",
      max_completion_tokens: 2048,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `Você registra gastos pessoais em português do Brasil. Responda APENAS JSON válido no formato {"expenses": [...]}. Se a mensagem citar mais de um gasto, crie um item para cada, no máximo ${MAX_EXPENSES}. ${expenseFieldRules}`,
        },
        { role: "user", content: `Hoje é ${today} (${weekdayInSaoPaulo()}). Mensagem: ${text}` },
      ],
    }),
  });
  const expenses = asRecords(parseJson(result).expenses);
  return expenses
    .map((expense) => normalizeExpense(expense, today, expenses.length === 1 ? text : String(expense.sourceText || text)))
    .filter((expense) => expense.amount > 0);
}

export type ImageReading =
  | { kind: "receipt"; expense: ExpenseDraft }
  | { kind: "other" };

// Uma única chamada decide se a foto é nota/comprovante e, se for, já extrai o gasto.
export async function interpretReceiptImage(image: string, caption = ""): Promise<ImageReading> {
  const today = todayInSaoPaulo();
  const result = await groq("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GROQ_MODEL,
      response_format: { type: "json_object" },
      reasoning_effort: "none",
      max_completion_tokens: 3072,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `Você analisa fotos enviadas a uma assistente pessoal. Responda APENAS JSON.
Se a imagem for nota fiscal, cupom, recibo ou comprovante de pagamento (Pix, cartão, boleto), responda {"type": "receipt", "expense": {...}}.
Caso contrário (agenda, convite, print de conversa etc.), responda {"type": "other"}.
Em notas fiscais, amount é o VALOR TOTAL PAGO (após descontos), não a soma de impostos.
${expenseFieldRules}`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Hoje é ${today}. ${caption ? `Legenda enviada: ${caption}` : "Sem legenda."}` },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
    }),
  });
  const parsed = parseJson(result);
  if (parsed.type !== "receipt" || !parsed.expense || typeof parsed.expense !== "object") return { kind: "other" };
  const expense = normalizeExpense(parsed.expense as Record<string, unknown>, today, caption || "Nota fiscal enviada por foto");
  return expense.amount > 0 ? { kind: "receipt", expense } : { kind: "other" };
}

export async function savePendingExpense(chatId: number, ownerId: string, expense: ExpenseDraft, source: ExpenseSource) {
  const sql = getDatabase();
  const id = crypto.randomUUID();
  await sql`DELETE FROM telegram_pending_expenses WHERE expires_at < NOW()`;
  await sql`
    INSERT INTO telegram_pending_expenses (id, chat_id, owner_id, source, payload, expires_at)
    VALUES (${id}::uuid, ${chatId}, ${ownerId}::uuid, ${source}, ${JSON.stringify(expense)}::jsonb, NOW() + INTERVAL '30 minutes')
  `;
  return id;
}

// Move o rascunho para a tabela definitiva. Retorna null se expirou ou já foi usado.
export async function confirmPendingExpense(id: string, chatId: number) {
  const sql = getDatabase();
  const pending = await sql`
    DELETE FROM telegram_pending_expenses
    WHERE id = ${id}::uuid AND chat_id = ${chatId} AND expires_at > NOW()
    RETURNING owner_id::text AS "ownerId", source, payload
  `;
  if (!pending[0]) return null;
  const expense = pending[0].payload as ExpenseDraft;
  const expenseId = crypto.randomUUID();
  await sql`
    INSERT INTO expenses (
      id, owner_id, amount, spent_on, merchant, description, category,
      payment_method, items, source, source_text, confidence
    ) VALUES (
      ${expenseId}::uuid, ${String(pending[0].ownerId)}::uuid, ${expense.amount}, ${expense.date}::date,
      ${expense.merchant}, ${expense.description}, ${expense.category}, ${expense.paymentMethod},
      ${JSON.stringify(expense.items)}::jsonb, ${String(pending[0].source)}, ${expense.sourceText}, ${expense.confidence}
    )
  `;
  return { expenseId, expense };
}

export async function cancelPendingExpense(id: string, chatId: number) {
  const sql = getDatabase();
  await sql`DELETE FROM telegram_pending_expenses WHERE id = ${id}::uuid AND chat_id = ${chatId}`;
}

export async function deleteExpense(id: string, ownerId: string) {
  const sql = getDatabase();
  const rows = await sql`
    DELETE FROM expenses WHERE id = ${id}::uuid AND owner_id = ${ownerId}::uuid
    RETURNING id
  `;
  return Boolean(rows[0]);
}

export async function buildMonthSummary(ownerId: string, period: ExpenseMonth) {
  const sql = getDatabase();
  const categories = await sql`
    SELECT category, SUM(amount)::float8 AS total, COUNT(*)::int AS count
    FROM expenses
    WHERE owner_id = ${ownerId}::uuid AND spent_on BETWEEN ${period.start}::date AND ${period.end}::date
    GROUP BY category
  ` as CategoryTotal[];
  const top = await sql`
    SELECT merchant, description, amount::float8 AS amount, spent_on::text AS date
    FROM expenses
    WHERE owner_id = ${ownerId}::uuid AND spent_on BETWEEN ${period.start}::date AND ${period.end}::date
    ORDER BY amount DESC
    LIMIT 3
  ` as Array<{ merchant: string; description: string; amount: number; date: string }>;

  // No mês corrente, compara com o mesmo intervalo de dias do mês anterior (comparação justa).
  const today = todayInSaoPaulo();
  let comparison: { previousTotal: number; untilDay: number } | undefined;
  if (today.startsWith(period.month)) {
    const untilDay = Number(today.slice(8, 10));
    const previous = await sql`
      SELECT COALESCE(SUM(amount), 0)::float8 AS total
      FROM expenses
      WHERE owner_id = ${ownerId}::uuid
        AND spent_on >= (${period.start}::date - INTERVAL '1 month')
        AND spent_on <= LEAST(
          (${period.start}::date - INTERVAL '1 month') + (${untilDay - 1} * INTERVAL '1 day'),
          ${period.start}::date - INTERVAL '1 day'
        )
    `;
    comparison = { previousTotal: Number(previous[0]?.total || 0), untilDay };
  }
  return summaryMessage(
    period,
    categories.map((row) => ({ ...row, total: Number(row.total), count: Number(row.count) })),
    top.map((row) => ({ ...row, amount: Number(row.amount) })),
    comparison,
  );
}

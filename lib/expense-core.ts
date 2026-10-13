// Regras puras do módulo de gastos: sem banco, sem IA e sem rede.
// Ficam isoladas aqui para serem testadas com `npm run test:unit`.

export const EXPENSE_CATEGORIES = [
  "Alimentação",
  "Mercado",
  "Transporte",
  "Moradia",
  "Saúde",
  "Lazer",
  "Compras",
  "Educação",
  "Assinaturas",
  "Outros",
] as const;

export const PAYMENT_METHODS = ["pix", "crédito", "débito", "dinheiro", "boleto", "não informado"] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type ExpenseItem = { name: string; quantity: number; total: number };

export type ExpenseDraft = {
  amount: number;
  date: string;
  merchant: string;
  description: string;
  category: ExpenseCategory;
  paymentMethod: PaymentMethod;
  items: ExpenseItem[];
  confidence: number;
  sourceText: string;
};

export type ExpenseMonth = { month: string; start: string; end: string; label: string };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_NAMES = [
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const MONTH_LABELS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// "R$ 1.234,56", "45,90", "45.90", 45.9 → 45.9. Retorna 0 quando não há valor válido.
export function parseAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
  if (typeof value !== "string") return 0;
  let cleaned = value.replace(/[^\d.,-]/g, "");
  if (!cleaned) return 0;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma > lastDot) {
    // Formato brasileiro: ponto de milhar e vírgula decimal.
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > -1 && lastComma > -1) {
    // Formato americano: vírgula de milhar e ponto decimal.
    cleaned = cleaned.replace(/,/g, "");
  } else if (lastDot > -1 && cleaned.length - lastDot - 1 === 3 && cleaned.indexOf(".") === lastDot) {
    // "1.500" no Brasil é mil e quinhentos, não 1,5.
    cleaned = cleaned.replace(".", "");
  }
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
}

function pickCategory(value: unknown): ExpenseCategory {
  const normalized = normalizeText(String(value || ""));
  return EXPENSE_CATEGORIES.find((category) => normalizeText(category) === normalized) || "Outros";
}

function pickPayment(value: unknown): PaymentMethod {
  const normalized = normalizeText(String(value || ""));
  if (/pix/.test(normalized)) return "pix";
  if (/credito|cartao de credito/.test(normalized)) return "crédito";
  if (/debito/.test(normalized)) return "débito";
  if (/dinheiro|especie/.test(normalized)) return "dinheiro";
  if (/boleto/.test(normalized)) return "boleto";
  return "não informado";
}

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeExpense(value: Record<string, unknown>, today: string, sourceText: string): ExpenseDraft {
  const rawDate = text(value.date, 10);
  // Datas futuras não fazem sentido para um gasto já realizado; nesses casos usa hoje.
  const date = DATE_PATTERN.test(rawDate) && rawDate <= today ? rawDate : today;
  const items = (Array.isArray(value.items) ? value.items : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .slice(0, 50)
    .map((item) => ({
      name: text(item.name, 120),
      quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
      total: parseAmount(item.total),
    }))
    .filter((item) => item.name);
  const confidence = Number(value.confidence);
  return {
    amount: parseAmount(value.amount),
    date,
    merchant: text(value.merchant, 160),
    description: text(value.description, 240),
    category: pickCategory(value.category),
    paymentMethod: pickPayment(value.paymentMethod),
    items,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
    sourceText: sourceText.slice(0, 4000),
  };
}

// Decide se uma mensagem é um registro de gasto (e não um compromisso).
export function detectExpenseIntent(message: string) {
  const value = normalizeText(message);
  if (value.startsWith("/gasto ") || value === "/gasto") return true;
  if (/\b(gastei|paguei|comprei|torrei|desembolsei)\b/.test(value)) return true;
  const hasMoney = /(r\$\s*\d|\d+(?:[.,]\d+)?\s*(?:reais|conto|pila)\b)/.test(value);
  const looksLikeSchedule = /\b(\d{1,2}h\d{0,2}|\d{1,2}:\d{2}|amanha|reuniao|consulta|agendar|marcar)\b/.test(value);
  return hasMoney && !looksLikeSchedule;
}

export function stripExpenseCommand(message: string) {
  return message.replace(/^\/gasto\b/i, "").trim();
}

function monthInfo(year: number, monthIndex: number): ExpenseMonth {
  const date = new Date(Date.UTC(year, monthIndex, 1));
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const month = `${y}-${String(m + 1).padStart(2, "0")}`;
  return { month, start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}`, label: `${MONTH_LABELS[m]}/${y}` };
}

// Reconhece pedidos de resumo: "/gastos", "quanto gastei esse mês", "meus gastos de setembro".
export function detectExpenseQuery(message: string, today: string): ExpenseMonth | null {
  const value = normalizeText(message);
  const asks = value.startsWith("/gastos")
    || /quanto (?:eu )?(?:ja )?gastei|meus gastos|resumo (?:dos |de )?gastos|ver gastos/.test(value);
  if (!asks) return null;

  const [year, month] = today.split("-").map(Number);
  const explicit = value.match(/(\d{4})-(0[1-9]|1[0-2])/);
  if (explicit) return monthInfo(Number(explicit[1]), Number(explicit[2]) - 1);
  if (/mes passado|mes anterior/.test(value)) return monthInfo(year, month - 2);
  const named = MONTH_NAMES.findIndex((name) => new RegExp(`\\b${name}\\b`).test(value));
  if (named >= 0) return monthInfo(named + 1 > month ? year - 1 : year, named);
  return monthInfo(year, month - 1);
}

export function formatBRL(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function formatDateBR(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export type CategoryTotal = { category: string; total: number; count: number };

export function summaryMessage(
  period: ExpenseMonth,
  categories: CategoryTotal[],
  top: Array<{ merchant: string; description: string; amount: number; date: string }>,
  comparison?: { previousTotal: number; untilDay: number },
) {
  const total = categories.reduce((sum, item) => sum + item.total, 0);
  const count = categories.reduce((sum, item) => sum + item.count, 0);
  if (!count) return `💰 Você não registrou gastos em ${period.label}.`;
  const lines = [
    `💰 Gastos de ${period.label}`,
    "",
    `Total: ${formatBRL(total)} em ${count} ${count === 1 ? "lançamento" : "lançamentos"}`,
  ];
  if (comparison && comparison.previousTotal > 0) {
    const change = ((total - comparison.previousTotal) / comparison.previousTotal) * 100;
    const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "=";
    lines.push(`${arrow} ${Math.abs(change).toFixed(0)}% em relação ao mês anterior até o dia ${comparison.untilDay}`);
  }
  lines.push("", "Por categoria:");
  for (const item of [...categories].sort((a, b) => b.total - a.total)) {
    lines.push(`• ${item.category}: ${formatBRL(item.total)} (${((item.total / total) * 100).toFixed(0)}%)`);
  }
  if (top.length) {
    lines.push("", "Maiores gastos:");
    for (const item of top) {
      lines.push(`• ${formatDateBR(item.date)} · ${item.merchant || item.description || "Gasto"} · ${formatBRL(item.amount)}`);
    }
  }
  return lines.join("\n");
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  detectExpenseIntent,
  detectExpenseQuery,
  normalizeExpense,
  parseAmount,
  stripExpenseCommand,
  summaryMessage,
} from "../lib/expense-core.ts";

const today = "2026-10-13";

test("lê valores em formato brasileiro e americano", () => {
  assert.equal(parseAmount("R$ 1.234,56"), 1234.56);
  assert.equal(parseAmount("45,90"), 45.9);
  assert.equal(parseAmount("45.90"), 45.9);
  assert.equal(parseAmount("1.500"), 1500);
  assert.equal(parseAmount("1,234.56"), 1234.56);
  assert.equal(parseAmount(32), 32);
  assert.equal(parseAmount("sem valor"), 0);
  assert.equal(parseAmount(-10), 0);
});

test("reconhece mensagens de gasto", () => {
  assert.equal(detectExpenseIntent("Gastei 45 no mercado no pix"), true);
  assert.equal(detectExpenseIntent("paguei a conta de luz"), true);
  assert.equal(detectExpenseIntent("/gasto 32,50 almoço"), true);
  assert.equal(detectExpenseIntent("uber R$ 23,40"), true);
  assert.equal(detectExpenseIntent("almoço 35 reais"), true);
});

test("não confunde compromissos com gastos", () => {
  assert.equal(detectExpenseIntent("Reunião amanhã às 10h"), false);
  assert.equal(detectExpenseIntent("reunião sobre orçamento de R$ 5 mil amanhã"), false);
  assert.equal(detectExpenseIntent("dentista sexta 15:30"), false);
  assert.equal(detectExpenseIntent("/gastos"), false);
});

test("remove o comando /gasto", () => {
  assert.equal(stripExpenseCommand("/gasto 32,50 almoço"), "32,50 almoço");
});

test("entende pedidos de resumo por mês", () => {
  assert.deepEqual(detectExpenseQuery("/gastos", today), {
    month: "2026-10", start: "2026-10-01", end: "2026-10-31", label: "outubro/2026",
  });
  assert.equal(detectExpenseQuery("Quanto gastei mês passado?", today)?.month, "2026-09");
  assert.equal(detectExpenseQuery("meus gastos de março", today)?.month, "2026-03");
  assert.equal(detectExpenseQuery("quanto gastei em dezembro", today)?.month, "2025-12");
  assert.equal(detectExpenseQuery("/gastos 2026-02", today)?.end, "2026-02-28");
  assert.equal(detectExpenseQuery("gastei 30 no uber", today), null);
});

test("normaliza a resposta da IA", () => {
  const expense = normalizeExpense({
    amount: "R$ 89,90",
    date: "2026-12-01",
    merchant: "Supermercado",
    category: "mercado",
    paymentMethod: "Cartão de Crédito",
    items: [{ name: "Café", quantity: 2, total: "19,80" }, { name: "" }],
    confidence: 3,
  }, today, "nota");
  assert.equal(expense.amount, 89.9);
  assert.equal(expense.date, today, "data futura vira hoje");
  assert.equal(expense.category, "Mercado");
  assert.equal(expense.paymentMethod, "crédito");
  assert.deepEqual(expense.items, [{ name: "Café", quantity: 2, total: 19.8 }]);
  assert.equal(expense.confidence, 1);
  assert.equal(normalizeExpense({ category: "Viagem espacial" }, today, "").category, "Outros");
});

test("monta o resumo do mês", () => {
  const message = summaryMessage(
    { month: "2026-10", start: "2026-10-01", end: "2026-10-31", label: "outubro/2026" },
    [{ category: "Mercado", total: 300, count: 3 }, { category: "Transporte", total: 100, count: 4 }],
    [{ merchant: "Andreazza", description: "", amount: 150, date: "2026-10-05" }],
    { previousTotal: 500, untilDay: 13 },
  );
  assert.match(message, /Total: R\$\s400,00 em 7 lançamentos/);
  assert.match(message, /▼ 20% em relação ao mês anterior até o dia 13/);
  assert.match(message, /Mercado: R\$\s300,00 \(75%\)/);
});

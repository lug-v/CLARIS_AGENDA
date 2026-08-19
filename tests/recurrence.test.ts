import assert from "node:assert/strict";
import test from "node:test";
import { expandRecurrence } from "../lib/recurrence.ts";

test("preserva um compromisso comum", () => {
  assert.deepEqual(expandRecurrence({
    date: "2026-08-18", endDate: "2026-08-18", recurrence: "none",
    recurrenceInterval: 1, recurrenceWeekdays: [], recurrenceUntil: "", recurrenceCount: 1,
  }), [{ date: "2026-08-18", endDate: "2026-08-18", occurrenceIndex: 0 }]);
});

test("expande uma recorrência semanal sem perder a duração", () => {
  assert.deepEqual(expandRecurrence({
    date: "2026-08-17", endDate: "2026-08-18", recurrence: "weekly",
    recurrenceInterval: 1, recurrenceWeekdays: [1], recurrenceUntil: "", recurrenceCount: 3,
  }), [
    { date: "2026-08-17", endDate: "2026-08-18", occurrenceIndex: 0 },
    { date: "2026-08-24", endDate: "2026-08-25", occurrenceIndex: 1 },
    { date: "2026-08-31", endDate: "2026-09-01", occurrenceIndex: 2 },
  ]);
});

test("aceita mais de um dia da semana", () => {
  const dates = expandRecurrence({
    date: "2026-08-17", endDate: "2026-08-17", recurrence: "weekly",
    recurrenceInterval: 1, recurrenceWeekdays: [1, 3], recurrenceUntil: "", recurrenceCount: 4,
  }).map((event) => event.date);
  assert.deepEqual(dates, ["2026-08-17", "2026-08-19", "2026-08-24", "2026-08-26"]);
});

test("limita a série pela data final", () => {
  const dates = expandRecurrence({
    date: "2026-08-18", endDate: "2026-08-18", recurrence: "daily",
    recurrenceInterval: 1, recurrenceWeekdays: [], recurrenceUntil: "2026-08-20", recurrenceCount: 1,
  }).map((event) => event.date);
  assert.deepEqual(dates, ["2026-08-18", "2026-08-19", "2026-08-20"]);
});

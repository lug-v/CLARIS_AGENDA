import assert from "node:assert/strict";
import test from "node:test";
import { detectAgendaQuery } from "../lib/agenda-query.ts";

const today = "2026-08-18";

test("entende uma pergunta sobre amanhã", () => {
  assert.deepEqual(detectAgendaQuery("O que tenho amanhã?", today), {
    start: "2026-08-19", end: "2026-08-19", label: "de amanhã",
  });
});

test("entende a próxima semana brasileira", () => {
  assert.deepEqual(detectAgendaQuery("Quais meus compromissos da semana que vem?", today), {
    start: "2026-08-23", end: "2026-08-29", label: "da próxima semana",
  });
});

test("mantém criação de compromisso separada de consulta", () => {
  assert.equal(detectAgendaQuery("Agendar reunião amanhã às 10h", today), null);
});

test("mantém o comando agenda compatível", () => {
  assert.deepEqual(detectAgendaQuery("/agenda", today), {
    start: today, end: today, label: "de hoje",
  });
});

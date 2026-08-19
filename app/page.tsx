"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Mode = "voice" | "photo" | "text";
type EventDraft = {
  title: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
  confidence: number;
  sourceText: string;
};
type AgendaEvent = {
  id: string;
  title: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
};
type TelegramStatus = {
  configured: boolean;
  connected: boolean;
  username: string;
};

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00`);
}

async function requestEvents(date: string): Promise<AgendaEvent[]> {
  const response = await fetch(`/api/events?month=${encodeURIComponent(date)}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível carregar a agenda.");
  return data.events;
}

export default function Home() {
  const today = useMemo(() => localDateKey(new Date()), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [visibleMonth, setVisibleMonth] = useState(today.slice(0, 7));
  const [mode, setMode] = useState<Mode>("voice");
  const [monthEvents, setMonthEvents] = useState<AgendaEvent[]>([]);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflictPending, setConflictPending] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");
  const [databaseMessage, setDatabaseMessage] = useState("");
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [telegramLink, setTelegramLink] = useState("");
  const [telegramLoading, setTelegramLoading] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const visibleDate = useMemo(() => dateFromKey(selectedDate), [selectedDate]);
  const events = useMemo(
    () => monthEvents.filter((event) => event.date <= selectedDate && (event.endDate || event.date) >= selectedDate),
    [monthEvents, selectedDate],
  );
  const calendarDays = useMemo(() => {
    const [year, month] = visibleMonth.split("-").map(Number);
    const firstDay = new Date(year, month - 1, 1, 12);
    const gridStart = new Date(firstDay);
    gridStart.setDate(firstDay.getDate() - firstDay.getDay());
    const eventsByDate = new Map<string, AgendaEvent[]>();
    monthEvents.forEach((event) => {
      const lastDate = event.endDate || event.date;
      const cursor = dateFromKey(event.date);
      for (let dayOffset = 0; dayOffset < 370 && localDateKey(cursor) <= lastDate; dayOffset += 1) {
        const key = localDateKey(cursor);
        const dayEvents = eventsByDate.get(key) || [];
        dayEvents.push(event);
        eventsByDate.set(key, dayEvents);
        cursor.setDate(cursor.getDate() + 1);
      }
    });
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      const key = localDateKey(date);
      return {
        key,
        day: date.getDate(),
        currentMonth: date.getMonth() === month - 1,
        events: eventsByDate.get(key) || [],
      };
    });
  }, [monthEvents, visibleMonth]);
  const weekdayLabel = visibleDate
    .toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })
    .toUpperCase();
  const monthLabel = visibleDate
    .toLocaleDateString("pt-BR", { month: "short" })
    .replace(".", "")
    .toUpperCase();
  const rawCalendarMonthLabel = dateFromKey(`${visibleMonth}-01`).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  const calendarMonthLabel = rawCalendarMonthLabel.charAt(0).toUpperCase() + rawCalendarMonthLabel.slice(1);

  const loadEvents = useCallback(async (month: string) => {
    setEventsLoading(true);
    setDatabaseMessage("");
    try {
      setMonthEvents(await requestEvents(month));
    } catch (error) {
      setMonthEvents([]);
      setDatabaseMessage(error instanceof Error ? error.message : "Não foi possível carregar a agenda.");
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    requestEvents(visibleMonth)
      .then((loadedEvents) => {
        if (!active) return;
        setMonthEvents(loadedEvents);
        setDatabaseMessage("");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMonthEvents([]);
        setDatabaseMessage(error instanceof Error ? error.message : "Não foi possível carregar a agenda.");
      })
      .finally(() => {
        if (active) setEventsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [visibleMonth]);

  const refreshTelegramStatus = useCallback(async () => {
    const response = await fetch("/api/telegram/status", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível consultar o Telegram.");
    setTelegramStatus(data);
    if (data.connected) setTelegramLink("");
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/telegram/status", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error();
        return data as TelegramStatus;
      })
      .then((status) => {
        if (active) setTelegramStatus(status);
      })
      .catch(() => {
        if (active) setTelegramStatus(null);
      });
    return () => {
      active = false;
    };
  }, []);

  function replaceDraft(nextDraft: EventDraft | null) {
    setConflictPending(false);
    setDraft(nextDraft);
  }

  async function analyze(payload: BodyInit, headers?: HeadersInit) {
    setLoading(true);
    setMessage("");
    replaceDraft(null);
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers, body: payload });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível interpretar.");
      replaceDraft(data.event);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível interpretar.");
    } finally {
      setLoading(false);
    }
  }

  function analyzeText() {
    if (!text.trim()) {
      setMessage("Escreva o compromisso antes de enviar.");
      return;
    }
    void analyze(JSON.stringify({ type: "text", text }), { "Content-Type": "application/json" });
  }

  async function analyzePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setMessage("A imagem deve ter até 10 MB.");
      return;
    }
    const image = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    void analyze(JSON.stringify({ type: "image", image }), { "Content-Type": "application/json" });
  }

  async function toggleRecording() {
    if (listening && recorder.current) {
      recorder.current.stop();
      setListening(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      recorder.current = mediaRecorder;
      chunks.current = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" });
        const form = new FormData();
        form.append("file", blob, "compromisso.webm");
        stream.getTracks().forEach((track) => track.stop());
        void analyze(form);
      };
      mediaRecorder.start();
      setListening(true);
      setMessage("");
    } catch {
      setMessage("Permita o acesso ao microfone para gravar o compromisso.");
    }
  }

  async function confirmEvent() {
    if (!draft || saving) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, allowConflict: conflictPending }),
      });
      const data = await response.json();
      if (response.status === 409 && data.code === "EVENT_CONFLICT") {
        const names = Array.isArray(data.conflicts)
          ? data.conflicts.map((conflict: { title?: string }) => conflict.title).filter(Boolean).join(", ")
          : "";
        setConflictPending(true);
        setMessage(`${data.error}${names ? ` Conflito com: ${names}.` : ""} Revise ou clique em “Agendar mesmo assim”.`);
        return;
      }
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar o compromisso.");
      replaceDraft(null);
      setText("");
      setSelectedDate(data.event.date);
      setVisibleMonth(data.event.date.slice(0, 7));
      await loadEvents(data.event.date.slice(0, 7));
      setMessage("Compromisso salvo na sua agenda.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar o compromisso.");
    } finally {
      setSaving(false);
    }
  }

  function changeMode(next: Mode) {
    setMode(next);
    replaceDraft(null);
    setMessage("");
  }

  function moveSelectedDate(days: number) {
    const nextDate = dateFromKey(selectedDate);
    nextDate.setDate(nextDate.getDate() + days);
    const nextKey = localDateKey(nextDate);
    if (nextKey.slice(0, 7) !== visibleMonth) {
      setEventsLoading(true);
      setVisibleMonth(nextKey.slice(0, 7));
    }
    setSelectedDate(nextKey);
  }

  function moveVisibleMonth(months: number) {
    const [year, month] = visibleMonth.split("-").map(Number);
    const nextMonthDate = new Date(year, month - 1 + months, 1, 12);
    const nextMonth = localDateKey(nextMonthDate).slice(0, 7);
    setEventsLoading(true);
    setVisibleMonth(nextMonth);
    setSelectedDate(today.startsWith(nextMonth) ? today : `${nextMonth}-01`);
  }

  function selectCalendarDate(date: string) {
    setSelectedDate(date);
    const month = date.slice(0, 7);
    if (month !== visibleMonth) {
      setEventsLoading(true);
      setVisibleMonth(month);
    }
  }

  async function createTelegramLink() {
    setTelegramLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/telegram/link", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível conectar o Telegram.");
      setTelegramLink(data.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível conectar o Telegram.");
    } finally {
      setTelegramLoading(false);
    }
  }

  async function disconnectTelegram() {
    setTelegramLoading(true);
    try {
      const response = await fetch("/api/telegram/disconnect", { method: "POST" });
      if (!response.ok) throw new Error();
      setTelegramStatus((current) => current ? { ...current, connected: false, username: "" } : current);
      setTelegramLink("");
    } catch {
      setMessage("Não foi possível desconectar o Telegram.");
    } finally {
      setTelegramLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="logo"><span>✦</span> clari</div>
        <nav>
          <button className="nav-active">▦ <span>Minha agenda</span></button>
          <button>◎ <span>Caixa de entrada</span><b>2</b></button>
          <button>⌁ <span>Integrações</span></button>
        </nav>
        <div className="profile"><div className="avatar">LM</div><p><strong>Lucas Mendes</strong><small>Plano gratuito</small></p><span>⋮</span></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p>{weekdayLabel}</p><h1>Bom dia, Lucas <span>☀</span></h1></div>
          <button className="outline-button" onClick={() => { setEventsLoading(true); setVisibleMonth(today.slice(0, 7)); setSelectedDate(today); }}>Hoje</button>
          <button className="icon-button" aria-label="Notificações">♢</button>
        </header>

        <section className="smart-input">
          <div className="input-heading">
            <div className="sparkle">✦</div>
            <div><h2>O que vamos agendar?</h2><p>Conte, mostre ou escreva. A Groq organiza para você.</p></div>
            <span className="safe">● Chaves protegidas no servidor</span>
          </div>
          <div className="tabs">
            <button className={mode === "voice" ? "selected" : ""} onClick={() => changeMode("voice")}>◉ Por voz</button>
            <button className={mode === "photo" ? "selected" : ""} onClick={() => changeMode("photo")}>▣ Por foto</button>
            <button className={mode === "text" ? "selected" : ""} onClick={() => changeMode("text")}>⌨ Por texto</button>
          </div>
          <div className={`capture-box ${loading ? "is-loading" : ""}`}>
            {loading && <div className="loading"><span>✦</span><div><strong>Analisando com a Groq...</strong><p>Identificando data, horário e compromisso</p></div></div>}
            {!loading && mode === "voice" && <><button className={`mic ${listening ? "listening" : ""}`} onClick={toggleRecording} aria-label={listening ? "Parar gravação" : "Gravar compromisso"}>●</button><div><strong>{listening ? "Gravando — toque para terminar" : "Toque para começar a falar"}</strong><p>{listening ? "Fale naturalmente" : "Ex: “Dentista amanhã às três da tarde”"}</p></div></>}
            {!loading && mode === "photo" && <label className="upload"><input type="file" accept="image/*" onChange={analyzePhoto} /><span>▣</span><div><strong>Escolha uma foto da agenda</strong><p>Foto, print ou página escrita à mão · até 10 MB</p></div></label>}
            {!loading && mode === "text" && <><textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) analyzeText(); }} aria-label="Descreva o compromisso" placeholder="Ex: Reunião com a Ana sexta às 10h, por uma hora..." /><button className="send" onClick={analyzeText} aria-label="Interpretar compromisso">➜</button></>}
          </div>
          {message && <p className={message.startsWith("Compromisso salvo") ? "notice success" : "notice"}>{message}</p>}
          {draft && <section className="review-card">
            <div className="review-title"><span>✓</span><div><h3>Confira antes de agendar</h3><p>{Math.round((draft.confidence || 0.8) * 100)}% de confiança na interpretação</p></div></div>
            <div className="review-grid">
              <label>Título<input value={draft.title} onChange={(event) => replaceDraft({ ...draft, title: event.target.value })} /></label>
              <label>Data<input type="date" value={draft.date} onChange={(event) => replaceDraft({ ...draft, date: event.target.value })} /></label>
              <label>Data final<input type="date" min={draft.date} value={draft.endDate || draft.date} onChange={(event) => replaceDraft({ ...draft, endDate: event.target.value })} /></label>
              <label>Início<input type="time" value={draft.startTime} onChange={(event) => replaceDraft({ ...draft, startTime: event.target.value })} /></label>
              <label>Término<input type="time" value={draft.endTime} onChange={(event) => replaceDraft({ ...draft, endTime: event.target.value })} /></label>
              <label className="location">Local<input value={draft.location} placeholder="Opcional" onChange={(event) => replaceDraft({ ...draft, location: event.target.value })} /></label>
            </div>
            <div className="review-actions"><button onClick={() => replaceDraft(null)}>Cancelar</button><button className="confirm" disabled={saving} onClick={confirmEvent}>{saving ? "Salvando..." : conflictPending ? "Agendar mesmo assim" : "✓ Confirmar e agendar"}</button></div>
          </section>}
        </section>

        <section className="integration-card" id="integrations">
          <div className="telegram-icon">➤</div>
          <div className="integration-copy">
            <h2>Telegram</h2>
            <p>
              {telegramStatus?.connected
                ? `Conectado${telegramStatus.username ? ` a @${telegramStatus.username}` : ""}. Envie texto, áudio ou foto ao bot.`
                : "Envie compromissos ao bot e confirme antes de salvar na Clari."}
            </p>
          </div>
          <div className="integration-actions">
            {telegramStatus?.connected ? <>
              <span className="connected-badge">● Conectado</span>
              <button disabled={telegramLoading} onClick={disconnectTelegram}>Desconectar</button>
            </> : <>
              {!telegramLink && <button className="telegram-connect" disabled={telegramLoading || telegramStatus?.configured === false} onClick={createTelegramLink}>
                {telegramLoading ? "Gerando link..." : telegramStatus?.configured === false ? "Aguardando configuração" : "Conectar Telegram"}
              </button>}
              {telegramLink && <a className="telegram-connect" href={telegramLink} target="_blank" rel="noreferrer">Abrir bot no Telegram</a>}
              {telegramLink && <button disabled={telegramLoading} onClick={() => void refreshTelegramStatus()}>Atualizar status</button>}
            </>}
          </div>
        </section>

        <div className="agenda-heading">
          <div><h2><span className="calendar-heading-prefix">Calendário de </span>{calendarMonthLabel}</h2><p>{monthEvents.length} {monthEvents.length === 1 ? "compromisso" : "compromissos"} neste mês</p></div>
          <div className="calendar-nav">
            <button onClick={() => moveVisibleMonth(-1)} aria-label="Mês anterior">‹</button>
            <strong>{calendarMonthLabel}</strong>
            <button onClick={() => moveVisibleMonth(1)} aria-label="Próximo mês">›</button>
          </div>
        </div>
        <section className={`month-calendar ${eventsLoading ? "is-loading" : ""}`} aria-label={`Calendário de ${calendarMonthLabel}`}>
          <div className="calendar-weekdays" aria-hidden="true">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className="calendar-grid">
            {calendarDays.map((day) => (
              <button
                key={day.key}
                className={`calendar-day${day.currentMonth ? "" : " other-month"}${day.key === selectedDate ? " selected" : ""}${day.key === today ? " today" : ""}${day.events.length ? " has-events" : ""}`}
                onClick={() => selectCalendarDate(day.key)}
                aria-label={`${dateFromKey(day.key).toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}, ${day.events.length} compromissos`}
                aria-pressed={day.key === selectedDate}
              >
                <span className="calendar-day-number">{day.day}</span>
                <span className="calendar-day-events">
                  {day.events.slice(0, 3).map((event) => (
                    <span className="calendar-event" key={event.id}><time>{event.startTime}</time>{event.title}</span>
                  ))}
                  {day.events.length > 3 && <span className="calendar-more">+{day.events.length - 3} compromisso{day.events.length - 3 === 1 ? "" : "s"}</span>}
                </span>
                {day.events.length > 0 && <span className="calendar-event-count" aria-hidden="true">{day.events.length}</span>}
              </button>
            ))}
          </div>
        </section>
        <div className="selected-day-heading">
          <div><h3>{weekdayLabel}</h3><p>{events.length} {events.length === 1 ? "compromisso" : "compromissos"} nesta data</p></div>
          <div className="day-nav">
            <button onClick={() => moveSelectedDate(-1)} aria-label="Dia anterior">‹</button>
            <button onClick={() => moveSelectedDate(1)} aria-label="Próximo dia">›</button>
          </div>
        </div>
        <section className="day-schedule">
          <div className="date"><strong>{visibleDate.getDate()}</strong><span>{monthLabel}</span></div>
          <div className="event-list">
            {eventsLoading && <p className="empty-agenda">Carregando compromissos...</p>}
            {!eventsLoading && databaseMessage && <p className="empty-agenda error">{databaseMessage}</p>}
            {!eventsLoading && !databaseMessage && events.length === 0 && <p className="empty-agenda">Nenhum compromisso para esta data.</p>}
            {!eventsLoading && events.map((event) => {
              const period = event.endDate && event.endDate !== event.date
                ? `${dateFromKey(event.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}–${dateFromKey(event.endDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`
                : "";
              const detail = [event.location, period, event.endTime ? `${event.startTime}–${event.endTime}` : ""].filter(Boolean).join(" · ");
              return <article key={event.id}><time>{event.startTime}</time><i className="green" /><div className="event green"><div><strong>{event.title}</strong><p>{detail || event.notes || "Compromisso salvo"}</p></div><button aria-label={`Opções de ${event.title}`}>•••</button></div></article>;
            })}
          </div>
        </section>
      </section>
    </main>
  );
}

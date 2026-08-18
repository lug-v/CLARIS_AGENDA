"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Mode = "voice" | "photo" | "text";
type EventDraft = {
  title: string;
  date: string;
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
  const response = await fetch(`/api/events?date=${encodeURIComponent(date)}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível carregar a agenda.");
  return data.events;
}

export default function Home() {
  const today = useMemo(() => localDateKey(new Date()), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [mode, setMode] = useState<Mode>("voice");
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
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
  const weekdayLabel = visibleDate
    .toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })
    .toUpperCase();
  const monthLabel = visibleDate
    .toLocaleDateString("pt-BR", { month: "short" })
    .replace(".", "")
    .toUpperCase();

  const loadEvents = useCallback(async (date: string) => {
    setEventsLoading(true);
    setDatabaseMessage("");
    try {
      setEvents(await requestEvents(date));
    } catch (error) {
      setEvents([]);
      setDatabaseMessage(error instanceof Error ? error.message : "Não foi possível carregar a agenda.");
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    requestEvents(selectedDate)
      .then((loadedEvents) => {
        if (!active) return;
        setEvents(loadedEvents);
        setDatabaseMessage("");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setEvents([]);
        setDatabaseMessage(error instanceof Error ? error.message : "Não foi possível carregar a agenda.");
      })
      .finally(() => {
        if (active) setEventsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedDate]);

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

  async function analyze(payload: BodyInit, headers?: HeadersInit) {
    setLoading(true);
    setMessage("");
    setDraft(null);
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers, body: payload });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível interpretar.");
      setDraft(data.event);
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
        body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar o compromisso.");
      setDraft(null);
      setText("");
      setSelectedDate(data.event.date);
      await loadEvents(data.event.date);
      setMessage("Compromisso salvo na sua agenda.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar o compromisso.");
    } finally {
      setSaving(false);
    }
  }

  function changeMode(next: Mode) {
    setMode(next);
    setDraft(null);
    setMessage("");
  }

  function moveSelectedDate(days: number) {
    const nextDate = dateFromKey(selectedDate);
    nextDate.setDate(nextDate.getDate() + days);
    setEventsLoading(true);
    setSelectedDate(localDateKey(nextDate));
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
          <button className="outline-button" onClick={() => { setEventsLoading(true); setSelectedDate(today); }}>Hoje</button>
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
              <label>Título<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
              <label>Data<input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
              <label>Início<input type="time" value={draft.startTime} onChange={(event) => setDraft({ ...draft, startTime: event.target.value })} /></label>
              <label>Término<input type="time" value={draft.endTime} onChange={(event) => setDraft({ ...draft, endTime: event.target.value })} /></label>
              <label className="location">Local<input value={draft.location} placeholder="Opcional" onChange={(event) => setDraft({ ...draft, location: event.target.value })} /></label>
            </div>
            <div className="review-actions"><button onClick={() => setDraft(null)}>Cancelar</button><button className="confirm" disabled={saving} onClick={confirmEvent}>{saving ? "Salvando..." : "✓ Confirmar e agendar"}</button></div>
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
          <div><h2>Sua agenda</h2><p>{events.length} {events.length === 1 ? "compromisso" : "compromissos"} nesta data</p></div>
          <div className="calendar-nav">
            <button onClick={() => moveSelectedDate(-1)} aria-label="Dia anterior">‹</button>
            <input type="date" aria-label="Data da agenda" value={selectedDate} onChange={(event) => { setEventsLoading(true); setSelectedDate(event.target.value); }} />
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
              const detail = [event.location, event.endTime ? `${event.startTime}–${event.endTime}` : ""].filter(Boolean).join(" · ");
              return <article key={event.id}><time>{event.startTime}</time><i className="green" /><div className="event green"><div><strong>{event.title}</strong><p>{detail || event.notes || "Compromisso salvo"}</p></div><button aria-label={`Opções de ${event.title}`}>•••</button></div></article>;
            })}
          </div>
        </section>
      </section>
    </main>
  );
}

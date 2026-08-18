"use client";

import { ChangeEvent, useRef, useState } from "react";

type Mode = "voice" | "photo" | "text";
type EventDraft = { title: string; date: string; startTime: string; endTime: string; location: string; notes: string; confidence: number; sourceText: string };
type AgendaEvent = { time: string; title: string; detail: string; color: string };

const initialEvents: AgendaEvent[] = [
  { time: "09:00", title: "Reunião de projeto", detail: "Equipe Produto · Google Meet", color: "blue" },
  { time: "12:30", title: "Almoço com Marina", detail: "Bistrô da Praça", color: "orange" },
  { time: "15:00", title: "Consulta no dentista", detail: "Clínica Central · 1 hora", color: "purple" },
];

export default function Home() {
  const [mode, setMode] = useState<Mode>("voice");
  const [events, setEvents] = useState(initialEvents);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  async function analyze(payload: BodyInit, headers?: HeadersInit) {
    setLoading(true); setMessage(""); setDraft(null);
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers, body: payload });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível interpretar.");
      setDraft(data.event);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível interpretar.");
    } finally { setLoading(false); }
  }

  function analyzeText() {
    if (!text.trim()) { setMessage("Escreva o compromisso antes de enviar."); return; }
    analyze(JSON.stringify({ type: "text", text }), { "Content-Type": "application/json" });
  }

  async function analyzePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setMessage("A imagem deve ter até 10 MB."); return; }
    const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
    analyze(JSON.stringify({ type: "image", image }), { "Content-Type": "application/json" });
  }

  async function toggleRecording() {
    if (listening && recorder.current) { recorder.current.stop(); setListening(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream); recorder.current = mediaRecorder; chunks.current = [];
      mediaRecorder.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      mediaRecorder.onstop = () => { const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" }); const form = new FormData(); form.append("file", blob, "compromisso.webm"); stream.getTracks().forEach(track => track.stop()); analyze(form); };
      mediaRecorder.start(); setListening(true); setMessage("");
    } catch { setMessage("Permita o acesso ao microfone para gravar o compromisso."); }
  }

  function confirmEvent() {
    if (!draft) return;
    setEvents(current => [...current, { time: draft.startTime, title: draft.title, detail: [draft.location, `${draft.startTime}–${draft.endTime}`].filter(Boolean).join(" · "), color: "green" }].sort((a, b) => a.time.localeCompare(b.time)));
    setDraft(null); setText(""); setMessage("Compromisso adicionado à sua agenda.");
  }

  function changeMode(next: Mode) { setMode(next); setDraft(null); setMessage(""); }

  return <main className="app-shell">
    <aside className="sidebar"><div className="logo"><span>✦</span> clari</div><nav><button className="nav-active">▦ <span>Minha agenda</span></button><button>◎ <span>Caixa de entrada</span><b>2</b></button><button>⌁ <span>Integrações</span></button></nav><div className="profile"><div className="avatar">LM</div><p><strong>Lucas Mendes</strong><small>Plano gratuito</small></p><span>⋮</span></div></aside>
    <section className="workspace">
      <header className="topbar"><div><p>SEGUNDA-FEIRA, 17 DE AGOSTO</p><h1>Bom dia, Lucas <span>☀</span></h1></div><button className="outline-button">Hoje</button><button className="icon-button" aria-label="Notificações">♢</button></header>
      <section className="smart-input">
        <div className="input-heading"><div className="sparkle">✦</div><div><h2>O que vamos agendar?</h2><p>Conte, mostre ou escreva. A Groq organiza para você.</p></div><span className="safe">● Chave protegida no servidor</span></div>
        <div className="tabs"><button className={mode === "voice" ? "selected" : ""} onClick={() => changeMode("voice")}>◉ Por voz</button><button className={mode === "photo" ? "selected" : ""} onClick={() => changeMode("photo")}>▣ Por foto</button><button className={mode === "text" ? "selected" : ""} onClick={() => changeMode("text")}>⌨ Por texto</button></div>
        <div className={`capture-box ${loading ? "is-loading" : ""}`}>
          {loading && <div className="loading"><span>✦</span><div><strong>Analisando com a Groq...</strong><p>Identificando data, horário e compromisso</p></div></div>}
          {!loading && mode === "voice" && <><button className={`mic ${listening ? "listening" : ""}`} onClick={toggleRecording} aria-label={listening ? "Parar gravação" : "Gravar compromisso"}>●</button><div><strong>{listening ? "Gravando — toque para terminar" : "Toque para começar a falar"}</strong><p>{listening ? "Fale naturalmente" : "Ex: “Dentista amanhã às três da tarde”"}</p></div></>}
          {!loading && mode === "photo" && <label className="upload"><input type="file" accept="image/*" onChange={analyzePhoto}/><span>▣</span><div><strong>Escolha uma foto da agenda</strong><p>Foto, print ou página escrita à mão · até 10 MB</p></div></label>}
          {!loading && mode === "text" && <><textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) analyzeText(); }} aria-label="Descreva o compromisso" placeholder="Ex: Reunião com a Ana sexta às 10h, por uma hora..."/><button className="send" onClick={analyzeText} aria-label="Interpretar compromisso">➜</button></>}
        </div>
        {message && <p className={message.startsWith("Compromisso") ? "notice success" : "notice"}>{message}</p>}
        {draft && <section className="review-card"><div className="review-title"><span>✓</span><div><h3>Confira antes de agendar</h3><p>{Math.round((draft.confidence || .8) * 100)}% de confiança na interpretação</p></div></div><div className="review-grid"><label>Título<input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}/></label><label>Data<input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })}/></label><label>Início<input type="time" value={draft.startTime} onChange={e => setDraft({ ...draft, startTime: e.target.value })}/></label><label>Término<input type="time" value={draft.endTime} onChange={e => setDraft({ ...draft, endTime: e.target.value })}/></label><label className="location">Local<input value={draft.location} placeholder="Opcional" onChange={e => setDraft({ ...draft, location: e.target.value })}/></label></div><div className="review-actions"><button onClick={() => setDraft(null)}>Cancelar</button><button className="confirm" onClick={confirmEvent}>✓ Confirmar e agendar</button></div></section>}
      </section>
      <div className="agenda-heading"><div><h2>Sua agenda</h2><p>{events.length} compromissos hoje</p></div><div className="views"><button className="active">Dia</button><button>Semana</button><button>Mês</button></div></div>
      <section className="day-schedule"><div className="date"><strong>17</strong><span>AGO</span></div><div className="event-list">{events.map((event, index) => <article key={`${event.time}-${index}`}><time>{event.time}</time><i className={event.color}/><div className={`event ${event.color}`}><div><strong>{event.title}</strong><p>{event.detail}</p></div><button aria-label={`Opções de ${event.title}`}>•••</button></div></article>)}</div></section>
    </section>
  </main>;
}

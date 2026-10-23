"use client";

import { useState, useRef, useEffect } from "react";

type Msg = { role: "user" | "assistant"; text: string };

const SUGGESTIONS = [
  "Why does the price come as a range, not one number?",
  "What is Heston parameter non-identifiability?",
  "How does the Random Forest give a confidence interval for free?",
  "What does the live SPY comparison actually prove?",
];

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      text: "Hi — I can explain anything on this page: the Heston model, why calibration gives a range, or the live market comparison. Ask away.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    const nextMessages: Msg[] = [...messages, { role: "user", text: question }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          history: nextMessages.slice(0, -1).map((m) => ({ role: m.role, text: m.text })),
        }),
      });
      const json = await res.json();
      setMessages((m) => [
        ...m,
        { role: "assistant", text: json.answer ?? `Error: ${json.error ?? "unknown"}` },
      ]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Network error — try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105"
        style={{ background: "#16161c", border: "1px solid #C9A227" }}
        aria-label="Open project assistant"
      >
        <span className="text-xl" style={{ color: "#e3bb3a" }}>
          {open ? "✕" : "?"}
        </span>
      </button>

      {open && (
        <div
          className="fixed bottom-24 right-5 z-50 flex h-[28rem] w-[22rem] max-w-[90vw] flex-col overflow-hidden rounded-xl border shadow-2xl"
          style={{ background: "#121216", borderColor: "#26262e" }}
        >
          <div className="px-4 py-3" style={{ background: "#16161c", borderBottom: "1px solid #26262e" }}>
            <div className="text-sm font-semibold" style={{ color: "#e3bb3a" }}>
              Project Assistant
            </div>
            <div className="text-xs" style={{ color: "#9a9aa5" }}>
              Ask about this project&apos;s methodology
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className="max-w-[85%] rounded-lg px-3 py-2 text-sm leading-snug"
                style={
                  m.role === "user"
                    ? { marginLeft: "auto", background: "#C9A227", color: "#0a0a0d" }
                    : { background: "#1c1c23", color: "#e8e8ec" }
                }
              >
                {m.text}
              </div>
            ))}
            {loading && (
              <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm" style={{ background: "#1c1c23", color: "#9a9aa5" }}>
                Thinking…
              </div>
            )}
          </div>

          {messages.length <= 1 && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="rounded-full border px-2.5 py-1 text-[11px] transition-colors hover:border-neutral-500"
                  style={{ borderColor: "#26262e", color: "#9a9aa5" }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="flex gap-2 p-2.5"
            style={{ borderTop: "1px solid #26262e" }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              className="flex-1 rounded-md border px-2.5 py-1.5 text-sm outline-none"
              style={{ background: "#0a0a0d", borderColor: "#26262e", color: "#e8e8ec" }}
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
              style={{ background: "#C9A227", color: "#0a0a0d" }}
            >
              Ask
            </button>
          </form>
        </div>
      )}
    </>
  );
}

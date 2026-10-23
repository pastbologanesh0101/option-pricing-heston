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
        style={{ background: "#1E2761" }}
        aria-label="Open project assistant"
      >
        <span className="text-xl" style={{ color: "#C9A227" }}>
          {open ? "✕" : "?"}
        </span>
      </button>

      {open && (
        <div className="fixed bottom-24 right-5 z-50 flex h-[28rem] w-[22rem] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl">
          <div className="px-4 py-3 text-white" style={{ background: "#1E2761" }}>
            <div className="text-sm font-semibold" style={{ color: "#C9A227" }}>
              Project Assistant
            </div>
            <div className="text-xs text-neutral-300">Ask about this project&apos;s methodology</div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-snug ${
                  m.role === "user"
                    ? "ml-auto bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-800"
                }`}
              >
                {m.text}
              </div>
            ))}
            {loading && (
              <div className="max-w-[85%] rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-500">
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
                  className="rounded-full border border-neutral-200 px-2.5 py-1 text-[11px] text-neutral-600 hover:border-neutral-400"
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
            className="flex gap-2 border-t border-neutral-200 p-2.5"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              className="flex-1 rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-400"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "#1E2761" }}
            >
              Ask
            </button>
          </form>
        </div>
      )}
    </>
  );
}

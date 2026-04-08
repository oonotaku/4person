"use client";

import { useState, useRef, useEffect } from "react";
import { createSession, getSessions, getSession, getMessages, saveMessage } from "@/lib/db";
import type { Session as DbSession } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import AuthGuard from "@/components/AuthGuard";

// ─── 型定義 ───────────────────────────────────────────────
type Persona = "affirmer" | "critic" | "observer" | "synthesizer";
type Speaker = "taku" | Persona;
type Language = "ja" | "en";

interface Message {
  id: string;
  speaker: Speaker;
  content: string;
  target: Persona[] | "all";
  timestamp: Date;
}

// ─── 人格メタデータ ───────────────────────────────────────
const PERSONAS: Record<
  Persona,
  { emoji: string; colorClass: string; bgClass: string; borderClass: string; name: { ja: string; en: string } }
> = {
  affirmer: {
    emoji: "🟢",
    colorClass: "text-emerald-700",
    bgClass: "bg-emerald-50",
    borderClass: "border-emerald-300",
    name: { ja: "肯定者", en: "Affirmer" },
  },
  critic: {
    emoji: "🔴",
    colorClass: "text-red-700",
    bgClass: "bg-red-50",
    borderClass: "border-red-300",
    name: { ja: "批判者", en: "Critic" },
  },
  observer: {
    emoji: "🔵",
    colorClass: "text-blue-700",
    bgClass: "bg-blue-50",
    borderClass: "border-blue-300",
    name: { ja: "俯瞰者", en: "Observer" },
  },
  synthesizer: {
    emoji: "⚖️",
    colorClass: "text-purple-700",
    bgClass: "bg-purple-50",
    borderClass: "border-purple-300",
    name: { ja: "統合者", en: "Synthesizer" },
  },
};

// ─── APIレスポンス型 ──────────────────────────────────────
interface Summary {
  conclusion: string;
  main_points: string[];
  next_actions: string[];
}

interface DebateResponse {
  responses: {
    persona: Persona;
    content: string;
    isMain: boolean;
  }[];
}

// ─── メインコンポーネント ──────────────────────────────────
function HomeContent() {
  const { user, signOut } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [lang, setLang] = useState<Language>("ja");
  const [targets, setTargets] = useState<Set<Persona>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pastSessions, setPastSessions] = useState<DbSession[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 過去のセッション一覧を取得（ログイン中のユーザーのみ）
  useEffect(() => {
    if (!user) return;
    getSessions(user.id)
      .then((data) => setPastSessions((data as DbSession[]) ?? []))
      .catch((e) => console.error("[getSessions error]", e));
  }, [user]);

  // ターゲットトグル
  function toggleTarget(p: Persona) {
    setTargets((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  // 過去セッションを読み込んで再開
  async function loadSession(id: string) {
    try {
      const msgs = await getMessages(id);
      if (!msgs) return;
      const loaded: Message[] = (msgs as { id: string; speaker: Speaker; content: string; target: string | null; created_at: string }[]).map((m) => ({
        id: m.id,
        speaker: m.speaker,
        content: m.content,
        target: m.target ? (m.target.split(",") as Persona[]) : "all",
        timestamp: new Date(m.created_at),
      }));
      setMessages(loaded);
      setSessionId(id);

      // 完了済みセッションはDBのsummaryカラムから読んで表示
      const sessionData = pastSessions.find((s) => s.id === id);
      if (sessionData?.is_completed) {
        try {
          const session = await getSession(id);
          if (session?.summary) {
            setSummary(session.summary as Summary);
          }
        } catch (e) {
          console.error("[loadSession summary error]", e);
        }
      }
    } catch (e) {
      console.error("[loadSession error]", e);
    }
  }

  // 新しい壁打ちを開始
  function startNewChat() {
    setMessages([]);
    setSessionId(null);
    setInput("");
    setTargets(new Set());
    setSummary(null);
  }

  // 送信処理（API連携）
  async function handleSubmit() {
    const text = input.trim();
    if (!text || isLoading) return;

    const target: Persona[] | "all" = targets.size === 0 ? "all" : Array.from(targets);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      speaker: "taku",
      content: text,
      target,
      timestamp: new Date(),
    };

    const isFirstMessage = messages.length === 0;
    const theme = isFirstMessage ? text : (messages.find((m) => m.speaker === "taku")?.content ?? text);

    const historyForApi = messages
      .filter((m) => m.speaker !== "taku")
      .map((m) => ({
        role: "assistant" as const,
        content: `[${m.speaker}] ${m.content}`,
      }));

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    // セッションIDを確定（初回のみ作成）
    let currentSessionId = sessionId;
    if (isFirstMessage) {
      try {
        const session = await createSession(theme, lang, user?.id);
        currentSessionId = session.id;
        setSessionId(session.id);
      } catch (e) {
        console.error("[createSession error]", e);
      }
    }

    // Takuの発言をDBに保存
    if (currentSessionId) {
      const targetStr = target === "all" ? undefined : target.join(",");
      saveMessage(currentSessionId, "taku", text, targetStr).catch((e) =>
        console.error("[saveMessage taku error]", e)
      );
    }

    try {
      const apiTarget = target === "all" ? null : target;
      console.log("[page.tsx] target state:", target, "→ API target:", apiTarget);

      const res = await fetch("/api/debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme,
          messages: historyForApi,
          target: apiTarget,
          userMessage: isFirstMessage ? null : text,
          language: lang,
          sessionId: currentSessionId,
        }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data = await res.json();

      // done 送信時はサマリーを表示してスキップ
      if (data.isDone) {
        setSummary(data.summary as Summary);
        setIsLoading(false);
        return;
      }

      const typed = data as DebateResponse;

      // 順番に表示（300ms間隔）
      for (let i = 0; i < typed.responses.length; i++) {
        const r = typed.responses[i];
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                speaker: r.persona,
                content: r.content,
                target: "all",
                timestamp: new Date(),
              },
            ]);
            resolve();
          }, 300 * (i + 1));
        });
      }

      // 過去セッション一覧を更新
      if (isFirstMessage && user) {
        getSessions(user.id)
          .then((data) => setPastSessions((data as DbSession[]) ?? []))
          .catch(() => {});
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          speaker: "observer",
          content:
            lang === "ja"
              ? "エラーが発生しました。ANTHROPIC_API_KEY が設定されているか確認してください。"
              : "An error occurred. Please check that ANTHROPIC_API_KEY is set.",
          target: "all",
          timestamp: new Date(),
        },
      ]);
    }

    setIsLoading(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  // ─── ラベル ────────────────────────────────────────────
  const L = {
    title: lang === "ja" ? "4人格 壁打ちAI" : "4-Persona Debate AI",
    placeholder:
      lang === "ja"
        ? "テーマを入力してください（例：SaaSプロダクトをB2Cに転換する）"
        : "Enter a topic (e.g., Pivoting a SaaS product to B2C)",
    send: lang === "ja" ? "送信" : "Send",
    sendHint: lang === "ja" ? "Ctrl+Enter" : "Ctrl+Enter",
    targetLabel: lang === "ja" ? "発言先：" : "Target:",
    all: lang === "ja" ? "全員" : "All",
    you: lang === "ja" ? "あなた" : "You",
    loading: lang === "ja" ? "考え中..." : "Thinking...",
    newChat: lang === "ja" ? "新しい壁打ち" : "New Chat",
    backToList: lang === "ja" ? "← 一覧に戻る" : "← Back to list",
    pastSessions: lang === "ja" ? "過去の壁打ち" : "Past Sessions",
    resume: lang === "ja" ? "続きから" : "Resume",
    noHistory: lang === "ja" ? "まだ履歴がありません" : "No history yet",
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 shadow-sm">
        <h1 className="text-lg font-bold text-gray-800 tracking-tight">{L.title}</h1>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={startNewChat}
              className="text-sm px-3 py-1.5 rounded-full border border-indigo-300 bg-white hover:bg-indigo-50 transition-colors font-medium text-indigo-600"
            >
              {L.backToList}
            </button>
          )}
          {/* 言語トグル */}
          <button
            onClick={() => setLang((l) => (l === "ja" ? "en" : "ja"))}
            className="text-sm px-3 py-1.5 rounded-full border border-gray-300 bg-white hover:bg-gray-100 transition-colors font-medium text-gray-600"
          >
            {lang === "ja" ? "EN" : "JA"}
          </button>
          {/* ログアウト */}
          <button
            onClick={signOut}
            className="text-sm px-3 py-1.5 rounded-full border border-gray-300 bg-white hover:bg-gray-100 transition-colors font-medium text-gray-500"
            title={user?.email ?? ""}
          >
            {lang === "ja" ? "ログアウト" : "Sign out"}
          </button>
        </div>
      </header>

      {/* チャットエリア */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-3 max-w-3xl w-full mx-auto">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center min-h-full text-center text-gray-400 py-12">
            <div className="text-5xl mb-4">💬</div>
            <p className="text-base font-medium">
              {lang === "ja"
                ? "テーマを入力して、4人格の議論を始めましょう"
                : "Enter a topic to start the 4-persona debate"}
            </p>
            <p className="text-sm mt-1">
              {lang === "ja"
                ? "🟢肯定者 → 🔴批判者 → 🔵俯瞰者 → ⚖️統合者 の順で発言します"
                : "🟢Affirmer → 🔴Critic → 🔵Observer → ⚖️Synthesizer"}
            </p>

            {/* 過去セッション一覧 */}
            <div className="w-full max-w-md mt-10">
              <p className="text-sm font-semibold text-gray-500 mb-3 text-left">
                {L.pastSessions}
              </p>
              {pastSessions.length === 0 ? (
                <p className="text-sm text-gray-400 text-left">{L.noHistory}</p>
              ) : (
                <div className="space-y-2">
                  {pastSessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => loadSession(s.id)}
                      className="w-full text-left px-4 py-3 bg-white rounded-xl border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors shadow-sm group"
                    >
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-800 truncate">{s.theme}</p>
                        {s.is_completed && (
                          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                            {lang === "ja" ? "完了" : "Done"}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <p className="text-xs text-gray-400">
                          {new Date(s.created_at).toLocaleDateString(
                            lang === "ja" ? "ja-JP" : "en-US",
                            { year: "numeric", month: "short", day: "numeric" }
                          )}
                        </p>
                        <span className="text-xs text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity">
                          {L.resume} →
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.speaker === "taku") {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[80%] sm:max-w-[65%]">
                  <p className="text-xs text-right text-gray-400 mb-1 mr-1">{L.you}</p>
                  <div className="bg-indigo-600 text-white px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed shadow-sm">
                    {msg.content}
                    {msg.target !== "all" && (
                      <div className="mt-2 pt-2 border-t border-indigo-400 text-xs text-indigo-200 flex flex-wrap gap-1">
                        {(msg.target as Persona[]).map((p) => (
                          <span key={p}>
                            {PERSONAS[p].emoji} {PERSONAS[p].name[lang]}
                          </span>
                        ))}
                        {lang === "ja" ? " 宛" : " ←"}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          const meta = PERSONAS[msg.speaker as Persona];
          return (
            <div key={msg.id} className="flex justify-start">
              <div className="max-w-[80%] sm:max-w-[65%]">
                <p className={`text-xs mb-1 ml-1 font-semibold ${meta.colorClass}`}>
                  {meta.emoji} {meta.name[lang]}
                </p>
                <div
                  className={`${meta.bgClass} border ${meta.borderClass} px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed shadow-sm text-gray-800`}
                >
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 px-4 py-3 rounded-2xl rounded-tl-sm text-sm text-gray-400 shadow-sm flex items-center gap-2">
              <span className="flex gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </span>
              {L.loading}
            </div>
          </div>
        )}

        {summary && (
          <div className="mt-2 rounded-2xl border border-indigo-200 bg-white shadow-md overflow-hidden">
            <div className="px-5 py-3 bg-indigo-600">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <span aria-hidden="true">📋</span>
                {lang === "ja" ? "議論のまとめ" : "Discussion Summary"}
              </h3>
            </div>
            <div className="px-5 py-4 space-y-4">
              <section>
                <p className="text-xs font-bold text-indigo-600 uppercase tracking-wide mb-2">
                  💡 {lang === "ja" ? "結論" : "Conclusion"}
                </p>
                <p className="text-sm text-gray-800 leading-relaxed bg-indigo-50 rounded-xl px-4 py-3 border border-indigo-100">
                  {summary.conclusion}
                </p>
              </section>
              <div className="border-t border-gray-100" />
              <section>
                <p className="text-xs font-bold text-indigo-600 uppercase tracking-wide mb-2">
                  📌 {lang === "ja" ? "主な論点" : "Main Points"}
                </p>
                <ul className="space-y-2">
                  {summary.main_points.map((point, i) => (
                    <li key={i} className="flex gap-2.5 text-sm text-gray-800">
                      <span className="mt-0.5 w-4 h-4 shrink-0 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-bold">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{point}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <div className="border-t border-gray-100" />
              <section>
                <p className="text-xs font-bold text-indigo-600 uppercase tracking-wide mb-2">
                  🚀 {lang === "ja" ? "次のアクション" : "Next Actions"}
                </p>
                <ol className="space-y-2">
                  {summary.next_actions.map((action, i) => (
                    <li key={i} className="flex gap-2.5 text-sm text-gray-800 p-3 rounded-xl border border-gray-100 bg-gray-50">
                      <span className="shrink-0 text-xs font-bold text-indigo-500 mt-0.5 w-4 text-right">
                        {i + 1}.
                      </span>
                      <span className="leading-relaxed">{action}</span>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      {/* 入力エリア */}
      <div className="bg-white border-t border-gray-200 px-4 pt-3 pb-4 max-w-3xl w-full mx-auto">
        {/* 発言先トグル */}
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <span className="text-xs text-gray-500 shrink-0">{L.targetLabel}</span>
          <button
            onClick={() => setTargets(new Set())}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors font-medium ${
              targets.size === 0
                ? "bg-gray-800 text-white border-gray-800"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-100"
            }`}
          >
            {L.all}
          </button>
          {(["affirmer", "critic", "observer", "synthesizer"] as Persona[]).map((p) => {
            const meta = PERSONAS[p];
            const active = targets.has(p);
            return (
              <button
                key={p}
                onClick={() => toggleTarget(p)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors font-medium ${
                  active
                    ? `${meta.bgClass} ${meta.colorClass} ${meta.borderClass}`
                    : "bg-white text-gray-500 border-gray-300 hover:bg-gray-100"
                }`}
              >
                {meta.emoji} {meta.name[lang]}
              </button>
            );
          })}
        </div>

        {/* テキストエリア + 送信ボタン */}
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={L.placeholder}
            disabled={isLoading}
            className="flex-1 resize-none border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent disabled:opacity-50 leading-relaxed"
          />
          <button
            onClick={handleSubmit}
            disabled={isLoading || !input.trim()}
            className="shrink-0 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors flex flex-col items-center gap-0.5 h-[60px] justify-center"
          >
            <span>{L.send}</span>
            <span className="text-[10px] font-normal opacity-75">{L.sendHint}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <AuthGuard>
      <HomeContent />
    </AuthGuard>
  );
}

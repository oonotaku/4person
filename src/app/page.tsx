"use client";

import { useState, useRef, useEffect } from "react";
import { createSession, getSessions, getSession, getMessages, saveMessage, updateSessionPhase } from "@/lib/db";
import type { Session as DbSession } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import AuthGuard from "@/components/AuthGuard";

// ─── 型定義 ───────────────────────────────────────────────
type Persona = "proposer" | "researcher" | "affirmer" | "critic" | "observer" | "synthesizer";
type Speaker = "taku" | Persona;
type Language = "ja" | "en";
type Phase = 1 | 2 | 3;

const PHASE_META: Record<Phase, { label: { ja: string; en: string }; personas: Persona[] }> = {
  1: { label: { ja: "発案", en: "Propose" }, personas: ["proposer", "researcher"] },
  2: { label: { ja: "検証", en: "Verify" }, personas: ["affirmer", "critic"] },
  3: { label: { ja: "統合", en: "Integrate" }, personas: ["observer", "synthesizer"] },
};

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
  proposer: {
    emoji: "💡",
    colorClass: "text-yellow-700",
    bgClass: "bg-yellow-50",
    borderClass: "border-yellow-300",
    name: { ja: "発案者", en: "Proposer" },
  },
  researcher: {
    emoji: "🔍",
    colorClass: "text-teal-700",
    bgClass: "bg-teal-50",
    borderClass: "border-teal-300",
    name: { ja: "調査者", en: "Researcher" },
  },
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
    colorClass: "text-blue-800",
    bgClass: "bg-blue-50",
    borderClass: "border-blue-400",
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
  phaseCompleted?: boolean;
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
  const [currentPhase, setCurrentPhase] = useState<Phase>(1);
  const [theme, setTheme] = useState<string>("");
  const [showNextPhaseButton, setShowNextPhaseButton] = useState(false);
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
    setCurrentPhase(1);
    setTheme("");
    setShowNextPhaseButton(false);
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
    const currentTheme = isFirstMessage ? text : theme;

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
      setTheme(text);
      try {
        const session = await createSession(currentTheme, lang, user?.id);
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

      const res = await fetch("/api/debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme: currentTheme,
          messages: historyForApi,
          target: apiTarget,
          userMessage: isFirstMessage ? null : text,
          language: lang,
          sessionId: currentSessionId,
          phase: currentPhase,
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
      if (typed.phaseCompleted) setShowNextPhaseButton(true);

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

  // 「フェーズ1に戻る」ボタン処理
  function handleResetPhase() {
    setCurrentPhase(1);
    setTargets(new Set());
    setShowNextPhaseButton(false);
    if (sessionId) {
      updateSessionPhase(sessionId, 1).catch((e) =>
        console.error("[updateSessionPhase error]", e)
      );
    }
  }

  // 「次のフェーズへ」ボタン処理
  async function handleNextPhase() {
    const nextPhase = (currentPhase + 1) as Phase;
    setCurrentPhase(nextPhase);
    setShowNextPhaseButton(false);
    setIsLoading(true);

    if (sessionId) {
      updateSessionPhase(sessionId, nextPhase).catch((e) =>
        console.error("[updateSessionPhase error]", e)
      );
    }

    const historyForApi = messages
      .filter((m) => m.speaker !== "taku")
      .map((m) => ({
        role: "assistant" as const,
        content: `[${m.speaker}] ${m.content}`,
      }));

    try {
      const res = await fetch("/api/debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme,
          messages: historyForApi,
          target: null,
          userMessage: null,
          language: lang,
          sessionId,
          phase: nextPhase,
          isPhaseTransition: true,
        }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data = (await res.json()) as DebateResponse;
      if (data.phaseCompleted) setShowNextPhaseButton(true);

      for (let i = 0; i < data.responses.length; i++) {
        const r = data.responses[i];
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                speaker: r.persona,
                content: r.content,
                target: "all" as const,
                timestamp: new Date(),
              },
            ]);
            resolve();
          }, 300 * (i + 1));
        });
      }
    } catch (err) {
      console.error("[handleNextPhase error]", err);
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
    title: "FRICTION",
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
    nextPhaseLabel: (nextPhase: Phase) =>
      lang === "ja"
        ? `次のフェーズへ（Phase ${nextPhase}：${PHASE_META[nextPhase].label.ja}）`
        : `Next Phase (Phase ${nextPhase}: ${PHASE_META[nextPhase].label.en})`,
  };

  const nextPhase = (currentPhase < 3 ? currentPhase + 1 : 3) as Phase;

  const isBeforeSession = messages.length === 0;

  return (
    <div
      className="flex flex-col h-screen"
      style={{ background: "#F9FAFB" }}
    >
      {/* ─── ヘッダー ─────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ background: "linear-gradient(135deg, #1E3A8A 0%, #0F172A 100%)" }}
      >
        <h1 className="text-xl font-black text-white tracking-tight">{L.title}</h1>
        <div className="flex items-center gap-2">
          {!isBeforeSession && (
            <button
              onClick={startNewChat}
              className="text-sm px-3 py-1.5 rounded-full border border-white/30 hover:bg-white/15 transition-colors font-medium text-white/90"
            >
              {L.backToList}
            </button>
          )}
          <button
            onClick={() => setLang((l) => (l === "ja" ? "en" : "ja"))}
            className="text-sm px-3 py-1.5 rounded-full border border-white/30 hover:bg-white/15 transition-colors font-medium text-white/80"
          >
            {lang === "ja" ? "EN" : "JA"}
          </button>
          <button
            onClick={signOut}
            className="text-sm px-3 py-1.5 rounded-full border border-white/30 hover:bg-white/15 transition-colors font-medium text-white/80"
            title={user?.email ?? ""}
          >
            {lang === "ja" ? "ログアウト" : "Sign out"}
          </button>
        </div>
      </header>

      {isBeforeSession ? (
        /* ─── ランディング画面（セッション未開始） ─────────── */
        <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-4 py-10">
          {/* キャッチコピー */}
          <p className="text-gray-400 text-xs font-semibold tracking-widest uppercase mb-4">
            AI Multi-Agent Debate
          </p>
          <h2 className="text-gray-900 text-2xl sm:text-3xl font-black text-center mb-10 leading-snug">
            {lang === "ja"
              ? <>本当に強いアイデアは、<br />反論に耐えたものだけだ。</>
              : <>Only ideas that survive friction<br />are truly strong.</>}
          </h2>

          {/* フェーズステッパー（大） */}
          <div className="flex items-center mb-10">
            {([1, 2, 3] as Phase[]).map((p, idx) => (
              <div key={p} className="flex items-center">
                {idx > 0 && (
                  <div className="flex items-center px-2">
                    <span className="text-gray-300 text-lg font-light">→</span>
                  </div>
                )}
                <div className={`flex flex-col items-center px-5 py-3 rounded-2xl border transition-all ${
                  p === 1
                    ? "bg-blue-700 border-blue-600 shadow-lg shadow-blue-300"
                    : "bg-white border-gray-200"
                }`}>
                  <span className={`text-[10px] font-bold tracking-wider uppercase mb-1 ${p === 1 ? "text-blue-300" : "text-gray-300"}`}>
                    Phase {p}
                  </span>
                  <span className={`text-sm font-bold ${p === 1 ? "text-white" : "text-gray-300"}`}>
                    {PHASE_META[p].label[lang]}
                  </span>
                  <span className="text-base mt-1.5">
                    {PHASE_META[p].personas.map((pe) => PERSONAS[pe].emoji).join(" ")}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* 入力エリア（中央・大） */}
          <div className="w-full max-w-lg">
            <p className="text-gray-500 text-sm font-medium text-center mb-3">
              {lang === "ja" ? "何について壁打ちしますか？" : "What would you like to debate?"}
            </p>
            <textarea
              ref={textareaRef}
              rows={3}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={lang === "ja" ? "あなたのアイデアを入力してください" : "Enter your idea here"}
              disabled={isLoading}
              className="w-full bg-white border border-gray-300 text-gray-800 placeholder-gray-400 rounded-2xl px-4 py-3.5 text-sm resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 leading-relaxed shadow-sm"
            />
            <button
              onClick={handleSubmit}
              disabled={isLoading || !input.trim()}
              className="w-full mt-3 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white font-bold py-3 rounded-2xl text-sm transition-colors shadow-md"
            >
              {isLoading ? L.loading : (lang === "ja" ? "壁打ちを始める →" : "Start Debate →")}
            </button>
            <p className="text-center text-gray-400 text-xs mt-2">{L.sendHint}</p>
          </div>

          {/* 過去セッション一覧（コンパクト） */}
          {pastSessions.length > 0 && (
            <div className="w-full max-w-lg mt-10 border-t border-gray-200 pt-6">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">
                {L.pastSessions}
              </p>
              <div className="space-y-1.5">
                {pastSessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => loadSession(s.id)}
                    className="w-full text-left px-4 py-2.5 rounded-xl bg-white hover:bg-blue-50 border border-gray-200 transition-all group shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-gray-600 group-hover:text-gray-900 truncate transition-colors">
                        {s.theme}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {s.is_completed && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">
                            {lang === "ja" ? "完了" : "Done"}
                          </span>
                        )}
                        <span className="text-xs text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                          {L.resume} →
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(s.created_at).toLocaleDateString(
                        lang === "ja" ? "ja-JP" : "en-US",
                        { year: "numeric", month: "short", day: "numeric" }
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ─── チャット画面（セッション中） ─────────────────── */
        <>
          {/* フェーズステッパー（小・常時表示） */}
          <div className="flex items-center justify-center gap-0 px-4 py-2.5 bg-white border-b border-gray-100 shadow-sm relative shrink-0">
            {([1, 2, 3] as Phase[]).map((p, idx) => {
              const active = currentPhase === p;
              const done = currentPhase > p;
              return (
                <div key={p} className="flex items-center">
                  {idx > 0 && (
                    <div className={`w-10 h-0.5 mx-1 ${done ? "bg-blue-500" : "bg-gray-200"}`} />
                  )}
                  <div className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs transition-all ${
                    active
                      ? "bg-white shadow border border-blue-400 text-blue-800 font-bold"
                      : done
                      ? "bg-blue-50 text-blue-500 border border-blue-100 font-medium"
                      : "bg-gray-50 text-gray-300 border border-gray-100"
                  }`}>
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      active ? "bg-blue-700 text-white" : done ? "bg-blue-400 text-white" : "bg-gray-200 text-gray-400"
                    }`}>{p}</span>
                    <span>{PHASE_META[p].label[lang]}</span>
                  </div>
                </div>
              );
            })}
            {currentPhase > 1 && (
              <button
                onClick={handleResetPhase}
                className="absolute left-4 text-xs text-gray-400 hover:text-blue-700 transition-colors font-medium"
              >
                ← {lang === "ja" ? "フェーズ1に戻る" : "Back to Phase 1"}
              </button>
            )}
          </div>

          {/* メッセージエリア */}
          <main className="flex-1 overflow-y-auto px-4 py-4 space-y-3 max-w-3xl w-full mx-auto">
            {messages.map((msg) => {
              if (msg.speaker === "taku") {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="max-w-[80%] sm:max-w-[65%]">
                      <p className="text-xs text-right text-gray-400 mb-1 mr-1">{L.you}</p>
                      <div className="bg-blue-700 text-white px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed shadow-sm">
                        {msg.content}
                        {msg.target !== "all" && (
                          <div className="mt-2 pt-2 border-t border-blue-500 text-xs text-blue-300 flex flex-wrap gap-1">
                            {(msg.target as Persona[]).map((p) => (
                              <span key={p}>{PERSONAS[p].emoji} {PERSONAS[p].name[lang]}</span>
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
                    <div className={`${meta.bgClass} border ${meta.borderClass} px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed shadow-sm text-gray-800`}>
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* 次のフェーズへボタン */}
            {showNextPhaseButton && currentPhase < 3 && !isLoading && !summary && (
              <div className="flex justify-center py-2">
                <button
                  onClick={handleNextPhase}
                  className="px-6 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm flex items-center gap-2"
                >
                  {L.nextPhaseLabel(nextPhase)}<span>→</span>
                </button>
              </div>
            )}

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
              <div className="mt-2 rounded-2xl border border-blue-300 bg-white shadow-md overflow-hidden">
                <div className="px-5 py-3 bg-blue-700">
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <span aria-hidden="true">📋</span>
                    {lang === "ja" ? "議論のまとめ" : "Discussion Summary"}
                  </h3>
                </div>
                <div className="px-5 py-4 space-y-4">
                  <section>
                    <p className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-2">
                      💡 {lang === "ja" ? "結論" : "Conclusion"}
                    </p>
                    <p className="text-sm text-gray-800 leading-relaxed bg-blue-50 rounded-xl px-4 py-3 border border-blue-100">
                      {summary.conclusion}
                    </p>
                  </section>
                  <div className="border-t border-gray-100" />
                  <section>
                    <p className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-2">
                      📌 {lang === "ja" ? "主な論点" : "Main Points"}
                    </p>
                    <ul className="space-y-2">
                      {summary.main_points.map((point, i) => (
                        <li key={i} className="flex gap-2.5 text-sm text-gray-800">
                          <span className="mt-0.5 w-4 h-4 shrink-0 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold">{i + 1}</span>
                          <span className="leading-relaxed">{point}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <div className="border-t border-gray-100" />
                  <section>
                    <p className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-2">
                      🚀 {lang === "ja" ? "次のアクション" : "Next Actions"}
                    </p>
                    <ol className="space-y-2">
                      {summary.next_actions.map((action, i) => (
                        <li key={i} className="flex gap-2.5 text-sm text-gray-800 p-3 rounded-xl border border-gray-100 bg-gray-50">
                          <span className="shrink-0 text-xs font-bold text-blue-600 mt-0.5 w-4 text-right">{i + 1}.</span>
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
          <div className="bg-white border-t border-gray-200 px-4 pt-3 pb-4 max-w-3xl w-full mx-auto shrink-0">
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
              {PHASE_META[currentPhase].personas.map((p) => {
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
                className="flex-1 resize-none border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 leading-relaxed"
              />
              <button
                onClick={handleSubmit}
                disabled={isLoading || !input.trim()}
                className="shrink-0 bg-blue-700 hover:bg-blue-800 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors flex flex-col items-center gap-0.5 h-[60px] justify-center"
              >
                <span>{L.send}</span>
                <span className="text-[10px] font-normal opacity-75">{L.sendHint}</span>
              </button>
            </div>
          </div>
        </>
      )}
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

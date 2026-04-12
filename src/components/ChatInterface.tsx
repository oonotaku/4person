"use client";

import { useState, useRef, useEffect } from "react";
import { createSession, getSessions, getSession, getMessages, saveMessage, updateSessionPhase } from "@/lib/db";
import { isDoneMessage } from "@/lib/utils/messageHandler";
import type { Session as DbSession } from "@/lib/supabase";
import type { Summary } from "@/types/discussion";
import DiscussionSummary from "@/components/DiscussionSummary";

// ─── 型定義 ───────────────────────────────────────────────
type Persona = "proposer" | "researcher" | "affirmer" | "critic" | "observer" | "synthesizer";
type Speaker = "taku" | Persona;
type Language = "ja" | "en";
type Phase = 1 | 2 | 3;

interface Message {
  id: string;
  speaker: Speaker;
  content: string;
  target: Persona[] | "all";
  timestamp: Date;
  isIntervention?: boolean;
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

// ─── フェーズメタデータ ───────────────────────────────────
const PHASE_META: Record<Phase, { label: { ja: string; en: string }; personas: Persona[] }> = {
  1: { label: { ja: "発案", en: "Propose" }, personas: ["proposer", "researcher"] },
  2: { label: { ja: "検証", en: "Verify" }, personas: ["affirmer", "critic"] },
  3: { label: { ja: "統合", en: "Integrate" }, personas: ["observer", "synthesizer"] },
};

// ─── APIレスポンス型 ──────────────────────────────────────
interface DebateResponse {
  responses: {
    persona: Persona;
    content: string;
    isMain: boolean;
    isIntervention?: boolean;
  }[];
  interventionOccurred?: boolean;
  needsClarification?: boolean;
  phaseCompleted?: boolean;
}

// ─── フェーズ推定（過去セッション用） ────────────────────
function inferPhase(speakers: string[]): Phase {
  if (speakers.includes("observer") || speakers.includes("synthesizer")) return 3;
  if (speakers.includes("affirmer") || speakers.includes("critic")) return 3;
  if (speakers.includes("proposer") || speakers.includes("researcher")) return 2;
  return 1;
}

// ─── メインコンポーネント ──────────────────────────────────
export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [lang, setLang] = useState<Language>("ja");
  const [targets, setTargets] = useState<Set<Persona>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pastSessions, setPastSessions] = useState<DbSession[]>([]);
  const [prevIntervened, setPrevIntervened] = useState(false);

  // フェーズ管理
  const [currentPhase, setCurrentPhase] = useState<Phase>(1);
  const [theme, setTheme] = useState<string>("");
  const [showNextPhaseButton, setShowNextPhaseButton] = useState(false);
  const [needsClarification, setNeedsClarification] = useState(false);

  // 議論終了フロー
  const [showDoneConfirm, setShowDoneConfirm] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, summary, showNextPhaseButton, needsClarification]);

  useEffect(() => {
    getSessions()
      .then((data) => setPastSessions((data as DbSession[]) ?? []))
      .catch((e) => console.error("[getSessions error]", e));
  }, []);

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
      const [msgs, sessionData] = await Promise.all([
        getMessages(id),
        getSession(id),
      ]);
      if (!msgs) return;

      const loaded: Message[] = (
        msgs as {
          id: string;
          speaker: Speaker;
          content: string;
          target: string | null;
          created_at: string;
        }[]
      ).map((m) => ({
        id: m.id,
        speaker: m.speaker,
        content: m.content,
        target: m.target ? (m.target.split(",") as Persona[]) : "all",
        timestamp: new Date(m.created_at),
      }));

      setMessages(loaded);
      setSessionId(id);
      setSummary(null);
      setSummaryError(null);
      setPrevIntervened(false);
      setShowNextPhaseButton(false);
      setNeedsClarification(false);

      // テーマを設定
      const s = sessionData as DbSession | null;
      if (s?.theme) setTheme(s.theme);

      // フェーズをDBから取得。なければメッセージから推定
      const dbPhase = s?.current_phase as Phase | undefined;
      if (dbPhase) {
        setCurrentPhase(dbPhase);
      } else {
        const speakers = loaded.map((m) => m.speaker);
        setCurrentPhase(inferPhase(speakers));
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
    setSummaryError(null);
    setShowDoneConfirm(false);
    setPrevIntervened(false);
    setCurrentPhase(1);
    setTheme("");
    setShowNextPhaseButton(false);
    setNeedsClarification(false);
  }

  // サマリー生成
  async function generateSummary() {
    if (!sessionId) return;
    setSummaryError(null);
    setIsSummarizing(true);
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errData.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { summary: Summary };
      setSummary(data.summary);
    } catch (err) {
      console.error("[summary error]", err);
      setSummaryError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSummarizing(false);
    }
  }

  async function handleConfirmDone() {
    setShowDoneConfirm(false);
    await generateSummary();
  }

  // APIレスポンスを順番に表示する共通処理
  async function displayResponses(responses: DebateResponse["responses"]) {
    for (let i = 0; i < responses.length; i++) {
      const r = responses[i];
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
              isIntervention: r.isIntervention,
            },
          ]);
          resolve();
        }, 300 * (i + 1));
      });
    }
  }

  // 「次のフェーズへ」ボタン処理
  async function handleNextPhase() {
    const nextPhase = (currentPhase + 1) as Phase;
    setCurrentPhase(nextPhase);
    setShowNextPhaseButton(false);
    setNeedsClarification(false);
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

      await displayResponses(data.responses);
    } catch (err) {
      console.error("[handleNextPhase error]", err);
    }

    setIsLoading(false);
  }

  // 送信処理
  async function handleSubmit() {
    const text = input.trim();
    if (!text || isLoading) return;

    // "done" チェック
    if (isDoneMessage(text) && sessionId) {
      setShowDoneConfirm(true);
      return;
    }

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
    setNeedsClarification(false);
    setIsLoading(true);

    // セッションIDを確定（初回のみ作成）
    let currentSessionId = sessionId;
    if (isFirstMessage) {
      setTheme(text);
      try {
        const session = await createSession(currentTheme, lang);
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
          wasInterventionPrevious: prevIntervened,
          phase: currentPhase,
        }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data = (await res.json()) as DebateResponse;

      setPrevIntervened(!!data.interventionOccurred);
      if (data.needsClarification) setNeedsClarification(true);
      if (data.phaseCompleted) setShowNextPhaseButton(true);

      await displayResponses(data.responses);

      if (isFirstMessage) {
        getSessions()
          .then((d) => setPastSessions((d as DbSession[]) ?? []))
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
    pastSessions: lang === "ja" ? "過去の壁打ち" : "Past Sessions",
    resume: lang === "ja" ? "続きから" : "Resume",
    noHistory: lang === "ja" ? "まだ履歴がありません" : "No history yet",
    doneConfirmTitle: lang === "ja" ? "議論を終了しますか？" : "End the discussion?",
    doneConfirmBody:
      lang === "ja"
        ? "6人格がこれまでの議論をまとめたサマリーを生成します。"
        : "The 6 personas will generate a summary of this discussion.",
    doneConfirmOk: lang === "ja" ? "終了してサマリーを生成" : "End & Generate Summary",
    doneConfirmCancel: lang === "ja" ? "キャンセル" : "Cancel",
    discussionEnded: lang === "ja" ? "この議論は終了しました" : "This discussion has ended",
    nextPhaseLabel: (nextPhase: Phase) =>
      lang === "ja"
        ? `次のフェーズへ（Phase ${nextPhase}：${PHASE_META[nextPhase].label.ja}）`
        : `Next Phase (Phase ${nextPhase}: ${PHASE_META[nextPhase].label.en})`,
    clarificationBanner:
      lang === "ja"
        ? "⚠️ 競合・参入障壁が見つかりました。どうしますか？差別化案や方針をテキストで入力してください。"
        : "⚠️ Competitors or barriers found. How would you like to proceed? Type your response or a pivot idea.",
  };

  const nextPhase = (currentPhase < 3 ? currentPhase + 1 : 3) as Phase;

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* 確認ダイアログ */}
      {showDoneConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-base font-bold text-gray-800 mb-2">{L.doneConfirmTitle}</h2>
            <p className="text-sm text-gray-500 mb-6">{L.doneConfirmBody}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowDoneConfirm(false);
                  setInput("");
                }}
                className="text-sm px-4 py-2 rounded-xl border border-gray-300 bg-white hover:bg-gray-100 text-gray-600 font-medium transition-colors"
              >
                {L.doneConfirmCancel}
              </button>
              <button
                onClick={handleConfirmDone}
                className="text-sm px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-medium transition-colors"
              >
                {L.doneConfirmOk}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ヘッダー */}
      <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 shadow-sm">
        <h1 className="text-lg font-bold text-gray-800 tracking-tight">{L.title}</h1>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={startNewChat}
              className="text-sm px-3 py-1.5 rounded-full border border-blue-400 bg-white hover:bg-blue-50 transition-colors font-medium text-blue-700"
            >
              {L.newChat}
            </button>
          )}
          <button
            onClick={() => setLang((l) => (l === "ja" ? "en" : "ja"))}
            className="text-sm px-3 py-1.5 rounded-full border border-gray-300 bg-white hover:bg-gray-100 transition-colors font-medium text-gray-600"
          >
            {lang === "ja" ? "EN" : "JA"}
          </button>
        </div>
      </header>

      {/* フェーズステッパー（議論開始後に表示） */}
      {messages.length > 0 && (
        <div className="flex items-center justify-center gap-0 py-2.5 px-4 bg-white border-b border-gray-100">
          {([1, 2, 3] as Phase[]).map((p, idx) => {
            const active = currentPhase === p;
            const done = currentPhase > p;
            return (
              <div key={p} className="flex items-center">
                {idx > 0 && (
                  <div className={`w-8 h-0.5 ${done ? "bg-blue-500" : "bg-gray-200"}`} />
                )}
                <div
                  className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    active
                      ? "bg-blue-700 text-white"
                      : done
                      ? "bg-blue-100 text-blue-700"
                      : "bg-gray-100 text-gray-400"
                  }`}
                >
                  <span>{p}</span>
                  <span>{PHASE_META[p].label[lang]}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* チャットエリア */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-3 max-w-3xl w-full mx-auto">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center min-h-full text-center text-gray-400 py-12">
            <div className="text-5xl mb-4">💬</div>
            <p className="text-base font-medium text-gray-600">
              {lang === "ja"
                ? "テーマを入力して、6人格の議論を始めましょう"
                : "Enter a topic to start the 6-persona debate"}
            </p>
            <p className="text-sm mt-2 text-gray-400 leading-relaxed">
              {lang === "ja"
                ? "💡発案者 → 🔍調査者 → 🟢肯定者 → 🔴批判者 → 🔵俯瞰者 → ⚖️統合者"
                : "💡Proposer → 🔍Researcher → 🟢Affirmer → 🔴Critic → 🔵Observer → ⚖️Synthesizer"}
            </p>
            <p className="text-xs mt-1 text-gray-400">
              {lang === "ja"
                ? "Phase 1（発案）→ Phase 2（検証）→ Phase 3（統合）の3フェーズで進行"
                : "Proceeds in 3 phases: Propose → Verify → Integrate"}
            </p>

            {/* 過去セッション一覧 */}
            <div className="w-full max-w-md mt-10">
              <p className="text-sm font-semibold text-gray-500 mb-3 text-left">{L.pastSessions}</p>
              {pastSessions.length === 0 ? (
                <p className="text-sm text-gray-400 text-left">{L.noHistory}</p>
              ) : (
                <div className="space-y-2">
                  {pastSessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => loadSession(s.id)}
                      className="w-full text-left px-4 py-3 bg-white rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors shadow-sm group"
                    >
                      <p className="text-sm font-medium text-gray-800 truncate">{s.theme}</p>
                      <div className="flex items-center justify-between mt-0.5">
                        <p className="text-xs text-gray-400">
                          {new Date(s.created_at).toLocaleDateString(
                            lang === "ja" ? "ja-JP" : "en-US",
                            { year: "numeric", month: "short", day: "numeric" }
                          )}
                        </p>
                        <span className="text-xs text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
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
                  <div className="bg-blue-700 text-white px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed shadow-sm">
                    {msg.content}
                    {msg.target !== "all" && (
                      <div className="mt-2 pt-2 border-t border-blue-500 text-xs text-blue-300 flex flex-wrap gap-1">
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
          if (!meta) return null;
          return (
            <div key={msg.id} className="flex justify-start">
              <div className="max-w-[80%] sm:max-w-[65%]">
                <p className={`text-xs mb-1 ml-1 font-semibold ${meta.colorClass} flex items-center gap-1`}>
                  {meta.emoji} {meta.name[lang]}
                  {msg.isIntervention && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-300">
                      ⚡ {lang === "ja" ? "介入" : "Intervened"}
                    </span>
                  )}
                </p>
                <div
                  className={`${meta.bgClass} border ${
                    msg.isIntervention ? "border-amber-400 ring-1 ring-amber-300" : meta.borderClass
                  } px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed shadow-sm text-gray-800`}
                >
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}

        {/* 障壁バナー */}
        {needsClarification && !isLoading && (
          <div className="flex justify-center px-2">
            <div className="w-full max-w-lg px-4 py-3 bg-amber-50 border border-amber-300 rounded-xl text-sm text-amber-800 text-center leading-relaxed">
              {L.clarificationBanner}
            </div>
          </div>
        )}

        {/* 次のフェーズへボタン */}
        {showNextPhaseButton && currentPhase < 3 && !isLoading && !summary && (
          <div className="flex justify-center py-2">
            <button
              onClick={handleNextPhase}
              className="px-6 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm flex items-center gap-2"
            >
              {L.nextPhaseLabel(nextPhase)}
              <span>→</span>
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

        {/* サマリー */}
        {(isSummarizing || summaryError || summary) && (
          <DiscussionSummary
            summary={summary}
            lang={lang}
            isLoading={isSummarizing}
            error={summaryError}
            onRetry={generateSummary}
          />
        )}

        <div ref={bottomRef} />
      </main>

      {/* 入力エリア */}
      <div className="bg-white border-t border-gray-200 px-4 pt-3 pb-4 max-w-3xl w-full mx-auto">
        {/* 議論終了バナー */}
        {summary && (
          <div className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-gray-100 border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-500">
            <span aria-hidden="true">🔒</span>
            {L.discussionEnded}
          </div>
        )}

        {/* 発言先トグル（6人格） */}
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
          {(["proposer", "researcher", "affirmer", "critic", "observer", "synthesizer"] as Persona[]).map((p) => {
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
            disabled={isLoading || isSummarizing || !!summary}
            className="flex-1 resize-none border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 leading-relaxed"
          />
          <button
            onClick={handleSubmit}
            disabled={isLoading || isSummarizing || !!summary || !input.trim()}
            className="shrink-0 bg-blue-700 hover:bg-blue-800 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors flex flex-col items-center gap-0.5 h-[60px] justify-center"
          >
            <span>{L.send}</span>
            <span className="text-[10px] font-normal opacity-75">{L.sendHint}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

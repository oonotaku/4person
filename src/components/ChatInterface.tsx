"use client";

import React, { useState, useRef, useEffect } from "react";
import { createSession, getSessions, getSession, getMessages, saveMessage, updateSessionPhase, updateDecidedIdeaTitle } from "@/lib/db";
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
  isSeparator?: boolean;
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
  phaseCompleted?: boolean;
  needsChoice?: boolean;
  proposals?: string[];
}

// ─── フェーズ推定（過去セッション用） ────────────────────
function inferPhase(speakers: string[]): Phase {
  if (speakers.includes("observer") || speakers.includes("synthesizer")) return 3;
  if (speakers.includes("affirmer") || speakers.includes("critic")) return 3;
  if (speakers.includes("proposer") || speakers.includes("researcher")) return 2;
  return 1;
}

// 調査者の選択肢テキストを除去
function stripResearcherChoiceText(content: string): string {
  return content.replace(/この結果を踏まえて、どうしますか？[\s\S]*$/, "").trim();
}

// 調査者の最終判定テキストを抽出
function extractResearcherVerdict(messages: { speaker: string; content: string }[]): string {
  const msgs = messages.filter((m) => m.speaker === "researcher");
  const last = msgs[msgs.length - 1];
  if (!last) return "";
  if (last.content.includes("勝てる余地あり")) return "勝てる余地あり";
  if (last.content.includes("勝てる余地は限定的")) return "勝てる余地は限定的";
  if (last.content.includes("参入障壁が高く厳しい")) return "参入障壁が高く厳しい";
  return "";
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
  const [needsChoice, setNeedsChoice] = useState(false);
  const [proposalTitles, setProposalTitles] = useState<string[]>([]);

  // Phase 1 決定アイデア管理
  const [decidedIdeaTitle, setDecidedIdeaTitle] = useState<string | null>(null);
  const [showDecideModal, setShowDecideModal] = useState(false);
  const [decideTitleInput, setDecideTitleInput] = useState("");
  const [showPhase1Summary, setShowPhase1Summary] = useState(false);

  // 調査者の折りたたみ状態（現在開いているメッセージのindexを1つだけ管理）
  const [openResearcherIndex, setOpenResearcherIndex] = useState<number | null>(null);

  // 議論終了フロー
  const [showDoneConfirm, setShowDoneConfirm] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, summary, showNextPhaseButton]);

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
      setNeedsChoice(false);
      setProposalTitles([]);
      setShowDecideModal(false);
      setShowPhase1Summary(false);


      // テーマを設定
      const s = sessionData as DbSession | null;
      if (s?.theme) setTheme(s.theme);

      // decided_idea_title を復元
      if (s?.decided_idea_title) setDecidedIdeaTitle(s.decided_idea_title);

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
    setNeedsChoice(false);
    setProposalTitles([]);
    setDecidedIdeaTitle(null);
    setDecideTitleInput("");
    setShowDecideModal(false);
    setShowPhase1Summary(false);
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

      // フェーズ開始セパレーターを挿入
      const separatorContent =
        nextPhase === 2
          ? lang === "ja"
            ? `✅ 検証フェーズ開始：${decidedIdeaTitle ?? theme}`
            : `✅ Verification Phase Start: ${decidedIdeaTitle ?? theme}`
          : lang === "ja"
            ? `✅ 統合フェーズ開始`
            : `✅ Integration Phase Start`;
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          speaker: "taku" as Speaker,
          content: separatorContent,
          target: "all" as const,
          timestamp: new Date(),
          isSeparator: true,
        },
      ]);

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
      if (data.phaseCompleted) setShowNextPhaseButton(true);
      if (data.needsChoice) setNeedsChoice(true);
      if (data.proposals && data.proposals.length > 0) setProposalTitles(data.proposals);

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

  // 調査者の3択ボタン処理
  async function handleChoice(choice: 1 | 2 | 3) {
    setNeedsChoice(false);

    if (choice === 3) {
      // タイトル入力モーダルを表示（APIは呼ばない）
      setDecideTitleInput("");
      setShowDecideModal(true);
      return;
    }

    const choiceText =
      choice === 1
        ? lang === "ja" ? "① この案をブラッシュアップする" : "① Brush up this idea"
        : lang === "ja" ? "② 全く新しい案を出してもらう" : "② Give me a completely new idea";

    const userMsg: Message = {
      id: crypto.randomUUID(),
      speaker: "taku",
      content: choiceText,
      target: ["proposer"],
      timestamp: new Date(),
    };

    const historyForApi = messages
      .filter((m) => m.speaker !== "taku")
      .map((m) => ({
        role: "assistant" as const,
        content: `[${m.speaker}] ${m.content}`,
      }));

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    if (sessionId) {
      saveMessage(sessionId, "taku", choiceText, "proposer").catch((e) =>
        console.error("[saveMessage choice error]", e)
      );
    }

    try {
      const res = await fetch("/api/debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme,
          messages: historyForApi,
          target: ["proposer"],
          userMessage: choiceText,
          language: lang,
          sessionId,
          wasInterventionPrevious: prevIntervened,
          phase: currentPhase,
        }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data = (await res.json()) as DebateResponse;
      setPrevIntervened(!!data.interventionOccurred);
      if (data.phaseCompleted) setShowNextPhaseButton(true);
      if (data.needsChoice) setNeedsChoice(true);
      if (data.proposals && data.proposals.length > 0) setProposalTitles(data.proposals);

      await displayResponses(data.responses);
    } catch (err) {
      console.error("[handleChoice error]", err);
    }

    setIsLoading(false);
  }

  // 発案者の4択ボタン処理（案選択 or 新案依頼）
  async function handleProposerChoice(idx: number) {
    setNeedsChoice(false);
    setProposalTitles([]);

    const isNewProposals = idx === 3;
    const selectedTitle = !isNewProposals ? proposalTitles[idx] : "";
    const choiceText = isNewProposals
      ? (lang === "ja" ? "④ 全く新しい案を出してもらう" : "④ Give me completely new proposals")
      : (lang === "ja"
          ? `「${selectedTitle}」を深掘りしてください`
          : `Please deep-dive into "${selectedTitle}"`);
    const targetPersona: Persona = isNewProposals ? "proposer" : "researcher";

    const userMsg: Message = {
      id: crypto.randomUUID(),
      speaker: "taku",
      content: choiceText,
      target: [targetPersona],
      timestamp: new Date(),
    };

    const historyForApi = messages
      .filter((m) => m.speaker !== "taku")
      .map((m) => ({
        role: "assistant" as const,
        content: `[${m.speaker}] ${m.content}`,
      }));

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    if (sessionId) {
      saveMessage(sessionId, "taku", choiceText, targetPersona).catch((e) =>
        console.error("[saveMessage proposerChoice error]", e)
      );
    }

    try {
      const res = await fetch("/api/debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme,
          messages: historyForApi,
          target: [targetPersona],
          userMessage: choiceText,
          language: lang,
          sessionId,
          wasInterventionPrevious: prevIntervened,
          phase: currentPhase,
          isNewProposal: isNewProposals,
        }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data = (await res.json()) as DebateResponse;
      setPrevIntervened(!!data.interventionOccurred);
      if (data.phaseCompleted) setShowNextPhaseButton(true);
      if (data.needsChoice) setNeedsChoice(true);
      if (data.proposals && data.proposals.length > 0) setProposalTitles(data.proposals);

      await displayResponses(data.responses);
    } catch (err) {
      console.error("[handleProposerChoice error]", err);
    }

    setIsLoading(false);
  }

  // タイトル入力モーダルの確定処理
  async function handleConfirmDecide() {
    const title = decideTitleInput.trim() || (lang === "ja" ? "（未入力）" : "(Untitled)");
    setDecidedIdeaTitle(title);
    setShowDecideModal(false);
    if (sessionId) {
      updateDecidedIdeaTitle(sessionId, title).catch((e) =>
        console.error("[updateDecidedIdeaTitle error]", e)
      );
    }
    setShowNextPhaseButton(true);
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
  };

  const nextPhase = (currentPhase < 3 ? currentPhase + 1 : 3) as Phase;

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* タイトル入力モーダル（③ボタン押下時） */}
      {showDecideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-bold text-gray-800">
              {lang === "ja" ? "決定した案のタイトルを入力してください" : "Enter the title of your chosen idea"}
            </h2>
            <input
              type="text"
              value={decideTitleInput}
              onChange={(e) => setDecideTitleInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirmDecide(); }}
              autoFocus
              placeholder={lang === "ja" ? "例：日本市場向けSaaS × 中小企業" : "e.g., SaaS for SMBs in Japan"}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={handleConfirmDecide}
              className="w-full bg-blue-700 hover:bg-blue-800 text-white text-sm font-bold py-2.5 rounded-xl transition-colors"
            >
              {lang === "ja" ? "決定してPhase 2へ進む →" : "Confirm & Proceed to Phase 2 →"}
            </button>
          </div>
        </div>
      )}

      {/* Phase 1サマリーポップアップ */}
      {showPhase1Summary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-4 bg-blue-700">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                📋 {lang === "ja" ? "Phase 1 決定アイデア" : "Phase 1 Chosen Idea"}
              </h3>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div>
                <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider mb-1">
                  {lang === "ja" ? "決定案" : "Chosen Idea"}
                </p>
                <p className="text-base font-bold text-gray-900 flex items-start gap-1.5">
                  <span>🎯</span>
                  <span>{decidedIdeaTitle}</span>
                </p>
              </div>
              <div className="border-t border-gray-100" />
              <div>
                <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider mb-1">
                  {lang === "ja" ? "調査者の最終判定" : "Researcher's Verdict"}
                </p>
                <p className="text-sm text-gray-800 flex items-center gap-1.5">
                  <span>✅</span>
                  <span>{extractResearcherVerdict(messages) || "—"}</span>
                </p>
              </div>
            </div>
            <div className="px-5 pb-5">
              <button
                onClick={() => setShowPhase1Summary(false)}
                className="w-full border border-gray-300 rounded-xl py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors font-medium"
              >
                {lang === "ja" ? "閉じる" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* お題バー（議論開始後） */}
      {messages.length > 0 && theme && (
        <div className="flex items-center justify-between px-4 py-2 bg-blue-50 border-b border-blue-100 shrink-0 gap-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs shrink-0">📌</span>
            <span className="text-xs font-medium text-gray-700 truncate">
              {lang === "ja" ? "お題：" : "Topic: "}{theme}
            </span>
          </div>
          {currentPhase >= 2 && decidedIdeaTitle && (
            <button
              onClick={() => setShowPhase1Summary(true)}
              className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-lg bg-white border border-blue-300 text-blue-700 hover:bg-blue-100 transition-colors"
            >
              📋 {lang === "ja" ? "Phase1サマリーを見る" : "View Phase 1 Summary"}
            </button>
          )}
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

        {messages.map((msg, msgIndex) => {
          // フェーズ開始セパレーター
          if (msg.isSeparator) {
            return (
              <div key={msg.id} className="flex items-center gap-3 py-3">
                <div className="flex-1 h-px bg-blue-200" />
                <span className="shrink-0 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-3 py-1 rounded-full">
                  {msg.content}
                </span>
                <div className="flex-1 h-px bg-blue-200" />
              </div>
            );
          }
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

          if (msg.speaker === "researcher") {
            const lines = stripResearcherChoiceText(msg.content).split("\n").filter(l => l.trim() !== "");
            const summaryLines = lines.slice(0, 3);
            const detailLines = lines.slice(3);
            const isExpanded = openResearcherIndex === msgIndex;
            return (
              <div key={msg.id} className="flex justify-start">
                <div className="max-w-[80%] sm:max-w-[65%]">
                  <p className={`text-xs mb-1 ml-1 font-semibold ${meta.colorClass} flex items-center gap-1`}>
                    {meta.emoji} {meta.name[lang]}
                  </p>
                  <div
                    className={`${meta.bgClass} border ${meta.borderClass} px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed shadow-sm text-gray-800`}
                  >
                    <div className="whitespace-pre-wrap">{summaryLines.join("\n")}</div>
                    {detailLines.length > 0 && (
                      <>
                        {isExpanded && (
                          <div className="mt-3 pt-3 border-t border-teal-200 whitespace-pre-wrap text-gray-700">
                            {detailLines.join("\n")}
                          </div>
                        )}
                        <button
                          onClick={() => setOpenResearcherIndex(isExpanded ? null : msgIndex)}
                          className="mt-2 text-xs font-semibold text-teal-600 hover:text-teal-800 transition-colors"
                        >
                          {isExpanded
                            ? lang === "ja" ? "閉じる ▲" : "Close ▲"
                            : lang === "ja" ? "詳細を見る ▼" : "View details ▼"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          }

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
                  style={msg.speaker === "proposer" ? { whiteSpace: "pre-wrap" } : undefined}
                >
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
            theme={theme}
            decidedIdeaTitle={decidedIdeaTitle}
            researcherVerdict={extractResearcherVerdict(messages)}
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

        {needsChoice && !isLoading && !summary ? (
          proposalTitles.length > 0 ? (
            /* 発案者の4択ボタン（どの案を調査するか選択） */
            <div className="space-y-2">
              <p className="text-xs text-yellow-700 font-semibold flex items-center gap-1">
                💡 {lang === "ja" ? "発案者からの提案：調査する案を選んでください" : "Proposer's proposals: choose one to investigate"}
              </p>
              {proposalTitles.map((title, idx) => (
                <button
                  key={idx}
                  onClick={() => handleProposerChoice(idx)}
                  className="w-full text-left px-4 py-3 bg-white border border-yellow-300 rounded-xl text-sm text-gray-800 hover:bg-yellow-50 transition-colors font-medium"
                >
                  {["①", "②", "③"][idx]} {lang === "ja" ? `「${title}」を深掘りする` : `Deep-dive into "${title}"`}
                </button>
              ))}
              <button
                onClick={() => handleProposerChoice(3)}
                className="w-full text-left px-4 py-3 bg-white border border-gray-300 rounded-xl text-sm text-gray-800 hover:bg-gray-50 transition-colors font-medium"
              >
                {lang === "ja" ? "④ 全く新しい案を出してもらう" : "④ Give me completely new proposals"}
              </button>
            </div>
          ) : (
            /* 調査者の3択ボタン（現状通り） */
            <div className="space-y-2">
              <p className="text-xs text-teal-700 font-semibold flex items-center gap-1">
                🔍 {lang === "ja" ? "調査者からの提案：選択してください" : "Researcher's proposal: choose an option"}
              </p>
              <button
                onClick={() => handleChoice(1)}
                className="w-full text-left px-4 py-3 bg-white border border-teal-300 rounded-xl text-sm text-gray-800 hover:bg-teal-50 transition-colors font-medium"
              >
                {lang === "ja" ? "① この案をブラッシュアップする" : "① Brush up this idea"}
              </button>
              <button
                onClick={() => handleChoice(2)}
                className="w-full text-left px-4 py-3 bg-white border border-teal-300 rounded-xl text-sm text-gray-800 hover:bg-teal-50 transition-colors font-medium"
              >
                {lang === "ja" ? "② 全く新しい案を出してもらう" : "② Give me a completely new idea"}
              </button>
              <button
                onClick={() => handleChoice(3)}
                className="w-full text-left px-4 py-3 bg-white border border-blue-300 rounded-xl text-sm text-gray-800 hover:bg-blue-50 transition-colors font-medium"
              >
                {lang === "ja" ? "③ この案で次のフェーズに進む" : "③ Proceed to next phase with this idea"}
              </button>
            </div>
          )
        ) : (
          <>
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
            {/* 議論終了ボタン */}
            {!summary && !isLoading && !isSummarizing && (
              <div className="mt-2 flex justify-end">
                <button
                  onClick={() => setShowDoneConfirm(true)}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors font-medium px-2 py-1 rounded-lg hover:bg-red-50"
                >
                  🏁 {lang === "ja" ? "議論を終了する" : "End discussion"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

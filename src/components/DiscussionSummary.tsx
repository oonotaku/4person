"use client";

import { useState } from "react";
import type { Summary } from "@/types/discussion";

type Language = "ja" | "en";

interface Props {
  summary?: Summary | null;
  lang?: Language;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const LABELS = {
  ja: {
    title: "議論サマリー",
    conclusion: "結論",
    mainPoints: "主要ポイント",
    nextActions: "次のアクション",
    copy: "コピー",
    copied: "コピー済み",
    print: "印刷",
    loading: "サマリーを生成中...",
    loadingDetail: "4人格が議論内容を分析しています",
    error: "サマリーの生成に失敗しました",
    retry: "リトライ",
  },
  en: {
    title: "Discussion Summary",
    conclusion: "Conclusion",
    mainPoints: "Main Points",
    nextActions: "Next Actions",
    copy: "Copy",
    copied: "Copied",
    print: "Print",
    loading: "Generating summary...",
    loadingDetail: "The 4 personas are analyzing the discussion",
    error: "Failed to generate summary",
    retry: "Retry",
  },
} as const;

function buildPlainText(summary: Summary, lang: Language): string {
  const L = LABELS[lang];
  const lines: string[] = [
    `=== ${L.title} ===`,
    "",
    `【${L.conclusion}】`,
    summary.conclusion,
    "",
    `【${L.mainPoints}】`,
    ...summary.main_points.map((p) => `• ${p}`),
    "",
    `【${L.nextActions}】`,
    ...summary.next_actions.map((a, i) => `${i + 1}. ${a}`),
  ];
  return lines.join("\n");
}

export default function DiscussionSummary({ summary, lang = "ja", isLoading, error, onRetry }: Props) {
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const L = LABELS[lang];

  // ローディング表示
  if (isLoading) {
    return (
      <div className="mt-4 rounded-2xl border border-indigo-200 bg-white shadow-md overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 bg-indigo-600">
          <span className="flex gap-1">
            <span className="w-2 h-2 bg-white/70 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 bg-white/70 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-2 h-2 bg-white/70 rounded-full animate-bounce [animation-delay:300ms]" />
          </span>
          <h3 className="text-sm font-bold text-white">{L.loading}</h3>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-indigo-500">{L.loadingDetail}</p>
          <div className="space-y-2">
            <div className="h-4 bg-indigo-50 rounded-lg animate-pulse w-full" />
            <div className="h-4 bg-indigo-50 rounded-lg animate-pulse w-4/5" />
            <div className="h-4 bg-indigo-50 rounded-lg animate-pulse w-3/4" />
          </div>
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <div className="h-3 bg-gray-100 rounded-lg animate-pulse w-full" />
            <div className="h-3 bg-gray-100 rounded-lg animate-pulse w-5/6" />
            <div className="h-3 bg-gray-100 rounded-lg animate-pulse w-2/3" />
          </div>
        </div>
      </div>
    );
  }

  // エラー表示
  if (error && !summary) {
    return (
      <div className="mt-4 rounded-2xl border border-red-200 bg-white shadow-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 bg-red-50 border-b border-red-100">
          <h3 className="text-sm font-bold text-red-700 flex items-center gap-1.5">
            <span aria-hidden="true">⚠️</span>
            {L.title}
          </h3>
        </div>
        <div className="px-5 py-5 flex flex-col items-center gap-4 text-center">
          <p className="text-sm text-red-600 font-medium">{L.error}</p>
          <p className="text-xs text-gray-400">{error}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
            >
              <RetryIcon />
              {L.retry}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildPlainText(summary, lang));
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      // フォールバック: 選択範囲を使ったコピー
      const el = document.createElement("textarea");
      el.value = buildPlainText(summary, lang);
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    }
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div className="mt-4 rounded-2xl border border-indigo-200 bg-white shadow-md overflow-hidden print:shadow-none print:border-gray-300">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-5 py-3 bg-indigo-600 print:bg-white print:border-b print:border-gray-300">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5 print:text-gray-900">
          <span aria-hidden="true">📋</span>
          {L.title}
        </h3>
        <div className="flex items-center gap-2 print:hidden">
          <button
            onClick={handleCopy}
            aria-label={L.copy}
            className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors"
          >
            {copyState === "copied" ? (
              <>
                <CheckIcon />
                {L.copied}
              </>
            ) : (
              <>
                <CopyIcon />
                {L.copy}
              </>
            )}
          </button>
          <button
            onClick={handlePrint}
            aria-label={L.print}
            className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors"
          >
            <PrintIcon />
            {L.print}
          </button>
        </div>
      </div>

      {/* カード本文 */}
      <div className="px-5 py-4 space-y-4">
        {/* 結論 */}
        <section>
          <SectionLabel text={L.conclusion} icon="💡" />
          <p className="mt-2 text-sm text-gray-800 leading-relaxed bg-indigo-50 rounded-xl px-4 py-3 border border-indigo-100">
            {summary.conclusion}
          </p>
        </section>

        <div className="border-t border-gray-100" />

        {/* 主要ポイント */}
        <section>
          <SectionLabel text={L.mainPoints} icon="📌" />
          <ul className="mt-2 space-y-2">
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

        {/* 次のアクション */}
        <section>
          <SectionLabel text={L.nextActions} icon="🚀" />
          <ol className="mt-2 space-y-2">
            {summary.next_actions.map((action, i) => (
              <li
                key={i}
                className="flex gap-2.5 text-sm text-gray-800 p-3 rounded-xl border border-gray-100 bg-gray-50 hover:bg-indigo-50 hover:border-indigo-100 transition-colors"
              >
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
  );
}

// ─── 小コンポーネント ──────────────────────────────────────

function SectionLabel({ text, icon }: { text: string; icon: string }) {
  return (
    <p className="text-xs font-bold text-indigo-600 flex items-center gap-1.5 uppercase tracking-wide">
      <span aria-hidden="true">{icon}</span>
      {text}
    </p>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6z" />
      <path d="M2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h-1v1H2V6h1V5H2z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
    </svg>
  );
}

function PrintIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2.5 8a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z" />
      <path d="M5 1a2 2 0 0 0-2 2v2H2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1v1a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1V3a2 2 0 0 0-2-2H5zM4 3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2H4V3zm1 5a2 2 0 0 0-2 2v1H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v-1a2 2 0 0 0-2-2H5zm7 2v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1z" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z" />
      <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z" />
    </svg>
  );
}

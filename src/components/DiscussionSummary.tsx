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
  theme?: string;
  decidedIdeaTitle?: string | null;
  researcherVerdict?: string;
}

const LABELS = {
  ja: {
    title: "実行判断サマリー",
    theme: "お題",
    decidedIdea: "決定アイデア",
    researcherVerdict: "調査者の判定",
    verdict: "実行判断",
    verdictReason: "判断理由",
    conditions: "実行に値する条件",
    firstStep: "最初の一手",
    copy: "コピー",
    copied: "コピー済み",
    print: "印刷",
    pdf: "PDFで保存",
    loading: "サマリーを生成中...",
    loadingDetail: "4人格が議論内容を分析しています",
    error: "サマリーの生成に失敗しました",
    retry: "リトライ",
  },
  en: {
    title: "Execution Verdict",
    theme: "Topic",
    decidedIdea: "Chosen Idea",
    researcherVerdict: "Researcher's Verdict",
    verdict: "Verdict",
    verdictReason: "Reason",
    conditions: "Conditions for Execution",
    firstStep: "First Step",
    copy: "Copy",
    copied: "Copied",
    print: "Print",
    pdf: "Save as PDF",
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
    `【${L.verdict}】`,
    summary.verdict,
    summary.verdict_reason,
    "",
    `【${L.conditions}】`,
    ...summary.conditions.map((c) => `• ${c}`),
    "",
    `【${L.firstStep}】`,
    summary.first_step,
  ];
  return lines.join("\n");
}

export default function DiscussionSummary({ summary, lang = "ja", isLoading, error, onRetry, theme, decidedIdeaTitle, researcherVerdict }: Props) {
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const L = LABELS[lang];

  // ローディング表示
  if (isLoading) {
    return (
      <div className="mt-4 rounded-2xl border border-blue-300 bg-white shadow-md overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 bg-blue-700">
          <span className="flex gap-1">
            <span className="w-2 h-2 bg-white/70 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 bg-white/70 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-2 h-2 bg-white/70 rounded-full animate-bounce [animation-delay:300ms]" />
          </span>
          <h3 className="text-sm font-bold text-white">{L.loading}</h3>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-blue-600">{L.loadingDetail}</p>
          <div className="space-y-2">
            <div className="h-4 bg-blue-50 rounded-lg animate-pulse w-full" />
            <div className="h-4 bg-blue-50 rounded-lg animate-pulse w-4/5" />
            <div className="h-4 bg-blue-50 rounded-lg animate-pulse w-3/4" />
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
              className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white transition-colors"
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

  function handleDownloadPdf() {
    if (!summary) return;

    const v = summary.verdict as string;
    const verdictClass =
      v === "実行すべき" || v === "Should execute"
        ? "verdict-execute"
        : v === "条件付きで実行すべき" || v === "Execute with conditions"
        ? "verdict-conditional"
        : "verdict-pass";

    const conditionsHtml = summary.conditions
      .map((c, i) => `<li><span class="cnum">${i + 1}</span><span>${c}</span></li>`)
      .join("");

    const themeBlock = theme
      ? `<div class="section">
          <div class="label">🎯 ${L.theme}</div>
          <div class="val bold">${theme}</div>
        </div><hr class="div">`
      : "";

    const ideaBlock = decidedIdeaTitle
      ? `<div class="section">
          <div class="label">💡 ${L.decidedIdea}</div>
          <div class="val bold">${decidedIdeaTitle}</div>
          ${researcherVerdict ? `<div class="researcher">🔍 ${L.researcherVerdict}：${researcherVerdict}</div>` : ""}
        </div><hr class="div">`
      : "";

    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<title>FRICTION サマリー${theme ? ` - ${theme}` : ""}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,"Helvetica Neue",sans-serif;color:#1f2937;background:#fff;padding:24px}
@media print{body{padding:0}@page{margin:15mm}}
.card{border:1px solid #93c5fd;border-radius:12px;overflow:hidden;max-width:680px;margin:0 auto}
.header{background:#1d4ed8;padding:12px 20px}
.header-title{color:#fff;font-size:14px;font-weight:700}
.body{padding:20px;display:flex;flex-direction:column;gap:0}
.section{margin-bottom:0}
.label{font-size:11px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.val{font-size:14px;color:#1f2937;line-height:1.6}
.val.bold{font-weight:700}
.div{border:none;border-top:1px solid #f3f4f6;margin:14px 0}
.verdict-badge{display:inline-block;padding:3px 12px;border-radius:999px;font-size:14px;font-weight:700;border:1px solid;margin-bottom:6px}
.verdict-execute{background:#f0fdf4;color:#15803d;border-color:#86efac}
.verdict-conditional{background:#fffbeb;color:#b45309;border-color:#fcd34d}
.verdict-pass{background:#fef2f2;color:#b91c1c;border-color:#fca5a5}
.reason{margin-top:6px;font-size:14px;color:#374151;line-height:1.6}
.clist{list-style:none;display:flex;flex-direction:column;gap:8px}
.clist li{display:flex;gap:10px;font-size:14px;color:#1f2937;line-height:1.6}
.cnum{width:18px;height:18px;min-width:18px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:3px}
.first-step{background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px;font-size:14px;color:#1f2937;line-height:1.6;font-weight:500}
.researcher{font-size:12px;color:#0f766e;margin-top:4px}
</style>
</head>
<body>
<div class="card">
  <div class="header"><span class="header-title">📋 ${L.title}</span></div>
  <div class="body">
    ${themeBlock}
    ${ideaBlock}
    <div class="section">
      <div class="label">⚖️ ${L.verdict}</div>
      <span class="verdict-badge ${verdictClass}">${summary.verdict}</span>
      <div class="reason">${summary.verdict_reason}</div>
    </div>
    <hr class="div">
    <div class="section">
      <div class="label">📋 ${L.conditions}</div>
      <ul class="clist">${conditionsHtml}</ul>
    </div>
    <hr class="div">
    <div class="section">
      <div class="label">🚀 ${L.firstStep}</div>
      <div class="first-step">${summary.first_step}</div>
    </div>
  </div>
</div>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.onafterprint = () => win.close();
    setTimeout(() => win.print(), 400);
  }

  return (
    <div className="mt-4 rounded-2xl border border-blue-300 bg-white shadow-md overflow-hidden print:shadow-none print:border-gray-300">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-5 py-3 bg-blue-700 print:bg-white print:border-b print:border-gray-300">
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
          <button
            onClick={handleDownloadPdf}
            aria-label={L.pdf}
            className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors"
          >
            📄 {L.pdf}
          </button>
        </div>
      </div>

      {/* カード本文 */}
      <div className="px-5 py-4 space-y-4">
        {/* お題 */}
        {theme && (
          <section>
            <SectionLabel text={L.theme} icon="🎯" />
            <p className="mt-2 text-sm text-gray-800 leading-relaxed font-medium">{theme}</p>
          </section>
        )}

        {/* 決定アイデア */}
        {decidedIdeaTitle && (
          <>
            <div className="border-t border-gray-100" />
            <section>
              <SectionLabel text={L.decidedIdea} icon="💡" />
              <p className="mt-2 text-sm text-gray-900 font-bold leading-relaxed">{decidedIdeaTitle}</p>
              {researcherVerdict && (
                <p className="mt-1 text-xs text-teal-700 flex items-center gap-1">
                  <span>🔍</span>
                  <span>{L.researcherVerdict}：{researcherVerdict}</span>
                </p>
              )}
            </section>
          </>
        )}

        {(theme || decidedIdeaTitle) && <div className="border-t border-gray-100" />}

        {/* 実行判断 */}
        <section>
          <SectionLabel text={L.verdict} icon="⚖️" />
          <div className="mt-2">
            <VerdictBadge verdict={summary.verdict} />
            <p className="mt-2 text-sm text-gray-700 leading-relaxed">
              {summary.verdict_reason}
            </p>
          </div>
        </section>

        <div className="border-t border-gray-100" />

        {/* 実行に値する条件 */}
        <section>
          <SectionLabel text={L.conditions} icon="📋" />
          <ul className="mt-2 space-y-2">
            {summary.conditions.map((condition, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-gray-800">
                <span className="mt-0.5 w-4 h-4 shrink-0 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{condition}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="border-t border-gray-100" />

        {/* 最初の一手 */}
        <section>
          <SectionLabel text={L.firstStep} icon="🚀" />
          <p className="mt-2 text-sm text-gray-800 leading-relaxed p-3 rounded-xl border border-blue-100 bg-blue-50 font-medium">
            {summary.first_step}
          </p>
        </section>
      </div>
    </div>
  );
}

// ─── 小コンポーネント ──────────────────────────────────────

function VerdictBadge({ verdict }: { verdict: string }) {
  const map: Record<string, { bg: string; text: string; border: string }> = {
    "実行すべき":         { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-300" },
    "条件付きで実行すべき": { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-300"   },
    "見送るべき":         { bg: "bg-red-50",     text: "text-red-700",     border: "border-red-300"     },
    "Should execute":          { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-300" },
    "Execute with conditions": { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-300"   },
    "Pass for now":            { bg: "bg-red-50",     text: "text-red-700",     border: "border-red-300"     },
  };
  const style = map[verdict] ?? { bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-300" };
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold border ${style.bg} ${style.text} ${style.border}`}>
      {verdict}
    </span>
  );
}

function SectionLabel({ text, icon }: { text: string; icon: string }) {
  return (
    <p className="text-xs font-bold text-blue-700 flex items-center gap-1.5 uppercase tracking-wide">
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

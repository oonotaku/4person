import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";
import { getSession, getMessages } from "@/lib/db";
import type { Summary } from "@/types/discussion";
import type { Language } from "@/types/database";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() });
const MODEL = "claude-sonnet-4-20250514";

type Persona = "affirmer" | "critic" | "observer" | "synthesizer";

const PERSONAS: Persona[] = ["affirmer", "critic", "observer", "synthesizer"];

const SPEAKER_LABELS: Record<string, Record<Language, string>> = {
  taku:        { ja: "Taku",    en: "Taku"        },
  affirmer:    { ja: "肯定者",   en: "Affirmer"    },
  critic:      { ja: "批判者",   en: "Critic"      },
  observer:    { ja: "俯瞰者",   en: "Observer"    },
  synthesizer: { ja: "統合者",   en: "Synthesizer" },
};

const PERSONA_SUMMARY_PROMPTS: Record<Persona, Record<Language, string>> = {
  affirmer: {
    ja: "あなたは「肯定者」です。この議論から見えるチャンスと可能性を2〜3点、端的にまとめてください。必ず日本語で回答すること。",
    en: "You are the Affirmer. Summarize 2-3 key opportunities and possibilities revealed by this discussion. Always respond in English.",
  },
  critic: {
    ja: "あなたは「批判者」です。この議論で浮き彫りになったリスクと未解決の課題を2〜3点、端的にまとめてください。必ず日本語で回答すること。",
    en: "You are the Critic. Summarize 2-3 key risks and unresolved challenges identified in this discussion. Always respond in English.",
  },
  observer: {
    ja: "あなたは「俯瞰者」です。この議論の構造的な本質と核心的な問いを2〜3点、端的にまとめてください。必ず日本語で回答すること。",
    en: "You are the Observer. Summarize 2-3 structural insights and essential questions from this discussion. Always respond in English.",
  },
  synthesizer: {
    ja: "あなたは「統合者」です。この議論の最終結論と具体的な次のアクションを2〜3点、端的にまとめてください。必ず日本語で回答すること。",
    en: "You are the Synthesizer. Summarize the final conclusion and 2-3 concrete next actions from this discussion. Always respond in English.",
  },
};

const PERSONA_LABELS: Record<Persona, Record<Language, string>> = {
  affirmer:    { ja: "肯定者の視点", en: "Affirmer's perspective"    },
  critic:      { ja: "批判者の視点", en: "Critic's perspective"      },
  observer:    { ja: "俯瞰者の視点", en: "Observer's perspective"    },
  synthesizer: { ja: "統合者の視点", en: "Synthesizer's perspective" },
};

// ─── ユーティリティ ─────────────────────────────────────────────

function buildTranscript(
  messages: Array<{ speaker: string; content: string }>,
  language: Language
): string {
  return messages
    .map(m => `${SPEAKER_LABELS[m.speaker]?.[language] ?? m.speaker}: ${m.content}`)
    .join("\n\n");
}

/** Claude が Markdown コードブロックで包んで返した場合にも対応 */
function extractJson(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return match ? match[1].trim() : text.trim();
}

// ─── Claude 呼び出し ────────────────────────────────────────────

async function callPersonaForSummary(
  persona: Persona,
  transcript: string,
  theme: string,
  language: Language
): Promise<string> {
  const topicPrefix =
    language === "ja" ? `テーマ：${theme}\n\n議論の記録：\n` : `Topic: ${theme}\n\nDiscussion transcript:\n`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: PERSONA_SUMMARY_PROMPTS[persona][language],
    messages: [{ role: "user", content: `${topicPrefix}${transcript}` }],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error(`Unexpected response type from ${persona}`);
  return block.text;
}

async function synthesizeSummary(
  perspectives: Record<Persona, string>,
  theme: string,
  language: Language
): Promise<Summary> {
  const perspectiveText = PERSONAS.map(
    p => `## ${PERSONA_LABELS[p][language]}\n${perspectives[p]}`
  ).join("\n\n");

  const systemPrompt =
    language === "ja"
      ? `あなたは議論のまとめ役です。4人格それぞれの視点をもとに、このビジネスアイデアへの実行判断をJSON形式で出力してください。
説明文や前置きは一切不要です。以下のJSON構造のみを返してください。

verdictは必ず「実行すべき」「条件付きで実行すべき」「見送るべき」の3択から1つを選ぶこと。

{
  "verdict": "実行すべき" | "条件付きで実行すべき" | "見送るべき",
  "verdict_reason": "判断の理由（2〜3文）",
  "conditions": ["このアイデアが実行に値する条件1", "条件2", "条件3"],
  "first_step": "今週中にできる具体的なアクション1つ（動詞始まりで1文）"
}`
      : `You are a discussion summarizer. Based on each of the 4 persona perspectives, output an execution verdict for this business idea in JSON format.
Return ONLY the following JSON structure — no explanation, no preamble.

verdict must be exactly one of: "Should execute" | "Execute with conditions" | "Pass for now"

{
  "verdict": "Should execute" | "Execute with conditions" | "Pass for now",
  "verdict_reason": "Reason for the verdict (2-3 sentences)",
  "conditions": ["Condition 1 for this idea to be worth executing", "Condition 2", "Condition 3"],
  "first_step": "One concrete action doable this week (start with a verb, 1 sentence)"
}`;

  const topicPrefix =
    language === "ja" ? `テーマ：${theme}\n\n` : `Topic: ${theme}\n\n`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: `${topicPrefix}${perspectiveText}` }],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from synthesizer");

  const parsed = JSON.parse(extractJson(block.text)) as Summary;

  if (
    typeof parsed.verdict !== "string" ||
    typeof parsed.verdict_reason !== "string" ||
    !Array.isArray(parsed.conditions) ||
    typeof parsed.first_step !== "string"
  ) {
    throw new Error("Invalid summary structure returned by Claude");
  }

  return parsed;
}

// ─── 公開 API ───────────────────────────────────────────────────

/**
 * 議論履歴を取得し、4人格それぞれの視点でサマリー要素を生成させた後、
 * 統合された Summary オブジェクトを返します。
 * 生成されたサマリーは discussions テーブルに保存され、ステータスが
 * "completed" に更新されます。
 *
 * @param sessionId - サマリーを生成するセッション ID
 * @returns 統合サマリー { conclusion, main_points, next_actions }
 */
export async function generateDiscussionSummary(sessionId: string): Promise<Summary> {
  // セッションメタデータとメッセージ履歴を並行取得
  const [session, messages] = await Promise.all([
    getSession(sessionId),
    getMessages(sessionId),
  ]);

  if (!messages || messages.length === 0) {
    throw new Error(`No messages found for session: ${sessionId}`);
  }

  const language: Language = session.language ?? "ja";
  const transcript = buildTranscript(messages, language);

  // 4人格のサマリー視点を並行生成
  const perspectiveEntries = await Promise.all(
    PERSONAS.map(async (persona): Promise<[Persona, string]> => {
      const content = await callPersonaForSummary(
        persona,
        transcript,
        session.theme,
        language
      );
      return [persona, content];
    })
  );

  const perspectives = Object.fromEntries(perspectiveEntries) as Record<Persona, string>;

  // 4視点を統合して最終サマリーを生成
  const summary = await synthesizeSummary(perspectives, session.theme, language);

  // セッションを完了済みとしてマーク＆サマリーを保存（失敗しても返却は続行）
  await supabase
    .from("sessions")
    .update({ is_completed: true, summary })
    .eq("id", sessionId);

  return summary;
}

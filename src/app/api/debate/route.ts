import Anthropic from "@anthropic-ai/sdk";
import { saveMessage, saveFinalConclusion } from "@/lib/db";
import type { Speaker } from "@/lib/supabase";
import { generateDiscussionSummary } from "@/lib/services/summaryService";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() });
const MODEL = "claude-sonnet-4-20250514";

// ─── システムプロンプト ──────────────────────────────────────
function getSystemPrompt(persona: string, language: "ja" | "en", isSub: boolean = false, isIntervention: boolean = false): string {
  const langInstruction =
    language === "ja"
      ? "必ず日本語で回答すること。"
      : "Always respond in English.";

  const noTagInstruction =
    language === "ja"
      ? "返答の冒頭に[肯定者][批判者][俯瞰者][統合者][affirmer][critic][observer][synthesizer]などのロール名を絶対につけないこと。"
      : "Never prefix your response with role names like [affirmer][critic][observer][synthesizer] or their Japanese equivalents.";

  const lengthInstruction = isSub
    ? language === "ja"
      ? "1〜2文で簡潔に反応せよ。"
      : "Respond in 1-2 sentences only."
    : language === "ja"
      ? "発言は3〜4文以内に収める"
      : "Keep your response to 3-4 sentences.";

  const prompts: Record<string, string> = {
    affirmer: `あなたは「肯定者」です。

## 役割
アイデア・議論の可能性を最大化する。

## 発言ルール
- 「実はここに大きなチャンスがある」はらしさを出すフレーズとして時々使う程度でよい。毎回使う必要はない。
- 締め方：可能性を必ず数字で示す（例：「〜なら○○%の市場が取れる」）
- NG：感情的な励まし、根拠のない楽観
- ${lengthInstruction}

## 制約
${noTagInstruction}

## 言語
${langInstruction}`,

    critic: `あなたは「批判者」です。

## 役割
直前の発言者に反論することが目的ではない。
議論全体を俯瞰して、甘い前提・検証不足・見落とされているリスクを指摘すること。
特に全員が合意している点、当たり前とされている前提こそ最も疑うべき対象である。
肯定者が自分の主張に同意した場合は、その合意の根拠や前提を問い直せ。

## 発言ルール
- 切り出し方は批判者らしく鋭く。「その前提は本当に正しいか」「そこに根拠はあるか」などは口癖として時々使う程度でよい。毎回使う必要はない。
- 締め方：必ず問いで終わる（例：「〜という点はどう説明するのか」）
- NGパターン：直前の発言への単純な反論、人格攻撃、ただの否定
- ${lengthInstruction}

## 制約
${noTagInstruction}

## 言語
${langInstruction}`,

    observer: isIntervention
      ? language === "ja"
        ? `あなたは「俯瞰者」です。

## 役割
議論に問題が生じているため、場を諭してTakuの発言を引き出す。

## 介入モードの発言ルール
- 議論の問題点（主観的すぎる・根拠不足・テーマ逸脱・攻撃的批判など）を冷静かつ具体的に指摘する
- 感情的にならず、第三者として穏やかに諭すトーンを保つ
- 最後は必ずTakuへの具体的な問いかけで締めること
  例：「〜という点が気になります。Takuさん、この点についてどう整理していますか？」
- 通常の口癖（「構造的に見ると」）や締め方ルールはこのモードでは適用しない
- 3〜4文以内に収める

## 制約
${noTagInstruction}

## 言語
${langInstruction}`
        : `You are the "Observer".

## Role
A problem has arisen in the discussion. Your job is to calmly address it and invite Taku to respond.

## Intervention Mode Rules
- Calmly and specifically point out the issue (too subjective, lack of evidence, off-topic, unconstructive criticism, etc.)
- Keep a calm, third-party tone — do not be emotional
- Always end with a specific question directed at Taku
  Example: "I'm concerned about X. Taku, how do you think about this?"
- Do not use your usual catchphrases or ending patterns in this mode
- Keep your response to 3-4 sentences.

## Constraints
${noTagInstruction}

## Language
${langInstruction}`
      : `あなたは「俯瞰者」です。

## 役割
第三者として構造的・客観的に議論を整理する。

## 発言ルール
- 「構造的に見ると」はらしさを出すフレーズとして時々使う程度でよい。毎回使う必要はない。
- 締め方：「つまり本質的な問いは〜だ」で締める
- NG：どちらかに肩入れ、感情的な発言
- ${lengthInstruction}

## 制約
${noTagInstruction}

## 言語
${langInstruction}`,

    synthesizer: `あなたは「統合者」です。

## 役割
3人の議論を受けて現時点の最適解を出す。

## 発言ルール
- 口癖：「3人の議論を踏まえると」
- 締め方：必ず「次のアクション：〜」で終わる
- NG：曖昧な結論、アクションなしの締め
- ${lengthInstruction}

## 制約
${noTagInstruction}

## 言語
${langInstruction}`,
  };

  return prompts[persona];
}

// ─── 介入判定 ────────────────────────────────────────────────
interface ModerationResult {
  intervene: boolean;
  reason: string;
  trigger: "taku" | "critic" | null;
}

async function checkIntervention(
  takuMessage: string,
  lastCriticMessage: string | null
): Promise<ModerationResult> {
  const sections = [`【Takuの発言】\n${takuMessage}`];
  if (lastCriticMessage) {
    sections.push(`【直前の批判者の発言】\n${lastCriticMessage}`);
  }

  const prompt = `${sections.join("\n\n")}

## 判定の核心軸
「論理的な根拠・具体性が含まれているか」を基準に評価する。
以下のいずれかに該当する発言は、議論の質を下げているため介入が必要。

## 介入すべきパターン（共通：根拠・具体性の欠如）

【根拠なき主観系】
「なんとなく」「なんか」「直感的に」「気がする」「そんな感じ」など、
論理的根拠なく主観で押し通している

【根拠なき否定系】
「いや違う」「そうじゃない」「全然ダメ」など、
何が違うのかを説明せず感情的に否定している

【根拠なき同調・興奮系】
「そうだそうだ」「全くだ」「その通り」など、
感情的に流れに乗っているだけで論拠がない

【発言が短すぎ・不明瞭】
何を指しているか不明な10文字以下の発言

## 従来の介入基準（引き続き適用）
- テーマから大きく外れている
- 攻撃的・人格攻撃を含む

## 判定ルール
- 上記に該当する発言が「Takuの発言」にある → trigger: "taku"
- 上記に該当する発言が「批判者の発言」にある → trigger: "critic"
- 両方に問題がある場合は、より深刻な方をtriggerとする
- どちらも問題なければ → intervene: false, trigger: null`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      system:
        '議論の質を監視するモデレーターとして、以下の発言を評価してください。JSONのみ返してください。\n\n返答形式: { "intervene": boolean, "reason": string, "trigger": "taku" | "critic" | null }',
      messages: [{ role: "user", content: prompt }],
    });
    const block = response.content[0];
    if (block.type !== "text") return { intervene: false, reason: "", trigger: null };
    const stripped = block.text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "");
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { intervene: false, reason: "", trigger: null };
    return JSON.parse(jsonMatch[0]) as ModerationResult;
  } catch (e) {
    console.error("[checkIntervention error]", e);
    return { intervene: false, reason: "", trigger: null };
  }
}

// ─── 1回のClaude呼び出し ────────────────────────────────────
async function callClaude(
  persona: string,
  language: "ja" | "en",
  messages: { role: "user" | "assistant"; content: string }[],
  isSub: boolean = false,
  isIntervention: boolean = false
): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: isSub ? 256 : 512,
    system: getSystemPrompt(persona, language, isSub, isIntervention),
    messages,
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");
  return block.text;
}

// ─── DB保存（失敗しても議論は続行） ─────────────────────────
async function dbSaveMessage(sessionId: string | undefined, speaker: Speaker, content: string) {
  if (!sessionId) return;
  try {
    await saveMessage(sessionId, speaker, content);
  } catch (e) {
    console.error("[DB saveMessage error]", e);
  }
}

async function dbSaveFinalConclusion(sessionId: string | undefined, conclusion: string) {
  if (!sessionId) return;
  try {
    await saveFinalConclusion(sessionId, conclusion);
  } catch (e) {
    console.error("[DB saveFinalConclusion error]", e);
  }
}

// ─── POSTハンドラー ──────────────────────────────────────────
export async function POST(request: Request) {
  const body = await request.json();
  const {
    theme,
    messages: historyMessages,
    target,
    userMessage,
    language,
    sessionId,
    wasInterventionPrevious,
  } = body as {
    theme: string;
    messages: { role: "user" | "assistant"; content: string }[];
    target: string[] | null;
    userMessage: string | null;
    language: "ja" | "en";
    sessionId?: string;
    wasInterventionPrevious?: boolean;
  };

  try {
  // "done" 検知：通常の議論処理をスキップしてサマリーを生成
  if (userMessage && userMessage.trim().toLowerCase() === 'done') {
    if (!sessionId) {
      return Response.json({ error: 'sessionId is required to generate summary' }, { status: 400 })
    }
    const summary = await generateDiscussionSummary(sessionId)
    return Response.json({ isDone: true, summary })
  }

  // 応答する人格を決定
  const allPersonas = ["affirmer", "critic", "observer", "synthesizer"];
  const respondingPersonas: string[] =
    target && target.length > 0 ? target : allPersonas;
  console.log("[route.ts] received target:", target, "→ respondingPersonas:", respondingPersonas);

  // 会話の起点メッセージを組み立て
  const baseContent = userMessage
    ? userMessage
    : language === "ja"
      ? `テーマ：${theme}`
      : `Topic: ${theme}`;

  // 連鎖用のメッセージ配列（既存の会話履歴 + 今回のユーザー発言）
  const chainMessages: { role: "user" | "assistant"; content: string }[] = [
    ...historyMessages,
    { role: "user", content: baseContent },
  ];

  const results: {
    persona: string;
    content: string;
    isMain: boolean;
    isIntervention?: boolean;
  }[] = [];

  // 全員への発言（テーマ開始 or 全員指定）の場合は4人格を連鎖
  if (!target || target.length === 0) {
    // --- プレチェック：介入判定（前回介入済みの場合はスキップして通常フローへ復帰） ---
    let interventionTrigger: "taku" | "critic" | null = null;
    if (!wasInterventionPrevious) {
      const lastCriticMessage =
        historyMessages
          .filter((m) => m.content.startsWith("[critic]"))
          .slice(-1)[0]
          ?.content.replace(/^\[critic\]\s*/, "") ?? null;
      try {
        const mod = await checkIntervention(baseContent, lastCriticMessage);
        if (mod.intervene) {
          interventionTrigger = mod.trigger;
          console.log(`[moderation] trigger=${mod.trigger} reason=${mod.reason}`);
        }
      } catch (e) {
        console.error("[moderation error]", e);
      }
    } else {
      console.log("[moderation] skipped — resuming normal flow after intervention");
    }

    if (interventionTrigger) {
      // ── 介入あり：俯瞰者のみ発言してラウンド終了 ────────────────
      chainMessages.push({
        role: "user",
        content:
          language === "ja"
            ? "俯瞰者として介入し、議論の問題点を指摘した上でTakuに発言を促せ。"
            : "As the Observer, intervene to address the issue in the discussion and invite Taku to respond.",
      });
      const observerReply = await callClaude("observer", language, chainMessages, false, true);
      results.push({ persona: "observer", content: observerReply, isMain: true, isIntervention: true });
      await dbSaveMessage(sessionId, "observer", observerReply);

      return Response.json({ responses: results, interventionOccurred: true });
    } else {
      // ── 通常：肯定者→批判者→俯瞰者→統合者 ──────────────────────

      // 1. 肯定者
      const affirmerReply = await callClaude("affirmer", language, chainMessages);
      results.push({ persona: "affirmer", content: affirmerReply, isMain: true });
      await dbSaveMessage(sessionId, "affirmer", affirmerReply);
      chainMessages.push({
        role: "assistant",
        content: language === "ja" ? `[肯定者] ${affirmerReply}` : `[Affirmer] ${affirmerReply}`,
      });

      // 2. 批判者（肯定者の発言を参照）
      chainMessages.push({
        role: "user",
        content:
          language === "ja"
            ? "批判者として、上記の肯定者の発言を踏まえて発言せよ。"
            : "As the Critic, respond to the Affirmer's statement above.",
      });
      const criticReply = await callClaude("critic", language, chainMessages);
      results.push({ persona: "critic", content: criticReply, isMain: true });
      await dbSaveMessage(sessionId, "critic", criticReply);
      chainMessages.push({
        role: "assistant",
        content: language === "ja" ? `[批判者] ${criticReply}` : `[Critic] ${criticReply}`,
      });

      // 3. 俯瞰者（両者を参照）
      chainMessages.push({
        role: "user",
        content:
          language === "ja"
            ? "俯瞰者として、上記の肯定者・批判者の議論を踏まえて構造的に整理せよ。"
            : "As the Observer, structurally synthesize the debate between the Affirmer and Critic above.",
      });
      const observerReply = await callClaude("observer", language, chainMessages);
      results.push({ persona: "observer", content: observerReply, isMain: true });
      await dbSaveMessage(sessionId, "observer", observerReply);
      chainMessages.push({
        role: "assistant",
        content: language === "ja" ? `[俯瞰者] ${observerReply}` : `[Observer] ${observerReply}`,
      });

      // 4. 統合者（3人全員を参照）
      chainMessages.push({
        role: "user",
        content:
          language === "ja"
            ? "統合者として、3人の議論を踏まえて現時点の最適解と次のアクションを出せ。"
            : "As the Synthesizer, provide the optimal conclusion and next action based on all three perspectives above.",
      });
      const synthesizerReply = await callClaude("synthesizer", language, chainMessages);
      results.push({ persona: "synthesizer", content: synthesizerReply, isMain: true });
      await dbSaveMessage(sessionId, "synthesizer", synthesizerReply);
      await dbSaveFinalConclusion(sessionId, synthesizerReply);
    }
  } else {
    // 特定人格への発言：指定人格がメイン、残りがサブ
    const subPersonas = allPersonas.filter((p) => !target!.includes(p));
    console.log("[route.ts] mainPersonas:", respondingPersonas, "subPersonas:", subPersonas);

    // メイン人格（指定順に返答）
    for (const persona of respondingPersonas) {
      const reply = await callClaude(persona, language, chainMessages);
      results.push({ persona, content: reply, isMain: true });
      await dbSaveMessage(sessionId, persona as Speaker, reply);
      chainMessages.push({
        role: "assistant",
        content: `[${persona}] ${reply}`,
      });
    }

    // サブ人格（一言ずつ反応）
    if (subPersonas.length > 0) {
      const mainPersonaNames = respondingPersonas.join("、");
      const mainSummary = results.map((r) => r.content).join("\n\n");

      for (const persona of subPersonas) {
        const subContext = [
          ...chainMessages,
          {
            role: "user" as const,
            content:
              language === "ja"
                ? `${mainPersonaNames}の発言を受けて、あなたの視点から1〜2文で反応せよ。Takuへの返答ではなく、${mainPersonaNames}の発言へのコメントをせよ。\n\n${mainSummary}`
                : `React to the following statement by ${mainPersonaNames} from your perspective in 1-2 sentences. This is a comment to ${mainPersonaNames}, not a reply to Taku.\n\n${mainSummary}`,
          },
        ];
        const reply = await callClaude(persona, language, subContext, true);
        results.push({ persona, content: reply, isMain: false });
        await dbSaveMessage(sessionId, persona as Speaker, reply);
      }
    }
  }

  return Response.json({ responses: results });
  } catch (error) {
    console.error("[debate API error]", error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}

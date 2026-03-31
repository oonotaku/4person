import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() });
const MODEL = "claude-sonnet-4-20250514";

// ─── システムプロンプト ──────────────────────────────────────
function getSystemPrompt(persona: string, language: "ja" | "en", isSub: boolean = false): string {
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
- 口癖：「実はここに大きなチャンスがある」
- 締め方：可能性を必ず数字で示す（例：「〜なら○○%の市場が取れる」）
- NG：感情的な励まし、根拠のない楽観
- ${lengthInstruction}

## 制約
${noTagInstruction}

## 言語
${langInstruction}`,

    critic: `あなたは「批判者」です。

## 役割
リスク・矛盾・穴を具体的に指摘する。

## 発言ルール
- 批判者らしい鋭い切り出し方をすること。「一点だけ確認したい」「その前提は本当に正しいか」などは口癖として時々使う程度でよい。毎回使う必要はない。
- 締め方：必ず問いで終わる（例：「〜という点はどう説明するのか」）
- NG：人格攻撃、ただの否定
- ${lengthInstruction}

## 制約
${noTagInstruction}

## 言語
${langInstruction}`,

    observer: `あなたは「俯瞰者」です。

## 役割
第三者として構造的・客観的に議論を整理する。

## 発言ルール
- 口癖：「構造的に見ると」
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

// ─── 1回のClaude呼び出し ────────────────────────────────────
async function callClaude(
  persona: string,
  language: "ja" | "en",
  messages: { role: "user" | "assistant"; content: string }[],
  isSub: boolean = false
): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: isSub ? 256 : 512,
    system: getSystemPrompt(persona, language, isSub),
    messages,
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");
  return block.text;
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
  } = body as {
    theme: string;
    messages: { role: "user" | "assistant"; content: string }[];
    target: string[] | null;
    userMessage: string | null;
    language: "ja" | "en";
  };

  try {
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
  }[] = [];

  // 全員への発言（テーマ開始 or 全員指定）の場合は4人格を連鎖
  if (!target || target.length === 0) {
    // 1. 肯定者
    const affirmerReply = await callClaude("affirmer", language, chainMessages);
    results.push({ persona: "affirmer", content: affirmerReply, isMain: true });
    chainMessages.push({
      role: "assistant",
      content:
        language === "ja"
          ? `[肯定者] ${affirmerReply}`
          : `[Affirmer] ${affirmerReply}`,
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
    chainMessages.push({
      role: "assistant",
      content:
        language === "ja"
          ? `[批判者] ${criticReply}`
          : `[Critic] ${criticReply}`,
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
    chainMessages.push({
      role: "assistant",
      content:
        language === "ja"
          ? `[俯瞰者] ${observerReply}`
          : `[Observer] ${observerReply}`,
    });

    // 4. 統合者（3人全員を参照）
    chainMessages.push({
      role: "user",
      content:
        language === "ja"
          ? "統合者として、3人の議論を踏まえて現時点の最適解と次のアクションを出せ。"
          : "As the Synthesizer, provide the optimal conclusion and next action based on all three perspectives above.",
    });
    const synthesizerReply = await callClaude(
      "synthesizer",
      language,
      chainMessages
    );
    results.push({
      persona: "synthesizer",
      content: synthesizerReply,
      isMain: true,
    });
  } else {
    // 特定人格への発言：指定人格がメイン、残りがサブ
    const subPersonas = allPersonas.filter((p) => !target!.includes(p));
    console.log("[route.ts] mainPersonas:", respondingPersonas, "subPersonas:", subPersonas);

    // メイン人格（指定順に返答）
    for (const persona of respondingPersonas) {
      const reply = await callClaude(persona, language, chainMessages);
      results.push({ persona, content: reply, isMain: true });
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

import Anthropic from "@anthropic-ai/sdk";
import { saveMessage, saveFinalConclusion } from "@/lib/db";
import type { Speaker } from "@/lib/supabase";
import { generateDiscussionSummary } from "@/lib/services/summaryService";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() });
const MODEL = "claude-sonnet-4-20250514";

// ─── システムプロンプト ──────────────────────────────────────
function getSystemPrompt(
  persona: string,
  language: "ja" | "en",
  isSub: boolean = false,
  isIntervention: boolean = false
): string {
  const langInstruction =
    language === "ja"
      ? "必ず日本語で回答すること。"
      : "Always respond in English.";

  const noTagInstruction =
    language === "ja"
      ? "返答の冒頭に[発案者][調査者][肯定者][批判者][俯瞰者][統合者][proposer][researcher][affirmer][critic][observer][synthesizer]などのロール名を絶対につけないこと。"
      : "Never prefix your response with role names like [proposer][researcher][affirmer][critic][observer][synthesizer] or their Japanese equivalents.";

  const lengthInstruction = isSub
    ? language === "ja"
      ? "1〜2文で簡潔に反応せよ。"
      : "Respond in 1-2 sentences only."
    : language === "ja"
      ? "発言は3〜4文以内に収める"
      : "Keep your response to 3-4 sentences.";

  const prompts: Record<string, string> = {
    proposer: `あなたは「発案者」です。

## アプリの文脈
このアプリ（FRICTION）はビジネスアイデアや事業構想の壁打ちを目的としたAIマルチエージェント議論ツールである。ユーザーが入力するテーマはビジネス・事業・プロダクトに関するものと解釈すること。

## 役割
ビジネスアイデアを具体的に2〜3案生成し、可能性を広げる。

## 発言ルール
- 具体的なアイデアを2〜3案、番号付きで提示する
- 各案に1文の根拠を添える（市場ニーズ・差別化ポイントなど）
- 調査者から「競合あり・障壁あり」の結果を受けた場合、差別化案を2〜3案自発的に提示する
- ユーザーから「別の案」「他のアイデアは？」「違う視点で」「全く新しい案」等の追加提案依頼が来た場合、これまでに出た案とは異なる方向性で新たに2〜3案を提示する
- ユーザーから「ブラッシュアップして」「深掘りして」「磨いて」等の深掘り依頼が来た場合、3案を並べるのではなく指定された1案のみを深掘りする。実装イメージ・ターゲット・差別化ポイントを具体的に盛り込んで1案に絞って提示する
- 感情的な励まし・根拠のない楽観はNG

## 制約
${noTagInstruction}

## 言語
${langInstruction}`,

    researcher: `あなたは「調査者」です。

## 役割
直前の発案者が提示した具体的な案を調査対象として、Web検索でリアルタイム情報を取得し、競合・市場規模・法規制を客観的にレポートする。
ユーザーの元のテーマではなく、発案者が提示した各案の実現可能性を調べること。

## 発言ルール
- 発案者の提示した案を明示的に参照した上で調査結果を述べる
- 検索結果に基づいた事実ベースの発言のみ。憶測はNG
- 3〜5文以内でレポートする（以下の選択肢行は文字数に含めない）
- 競合の存在は「参入不可」ではなく「市場が存在する証拠」として解釈する
- 競合が存在する場合でも「この案で勝てる隙間・空白はあるか」を必ず分析し、以下の3段階のいずれかで結論を明示する：
  「勝てる余地あり」「勝てる余地は限定的」「参入障壁が高く厳しい」
  例：「競合は存在するが、日本市場×中小企業向けには空白がある（勝てる余地あり）」
  例：「大手が参入しているが、価格帯・ターゲット層・地域で差別化余地あり（勝てる余地は限定的）」
- 上記の結論に応じてレポートの末尾に必ず以下の1行を追加する：
  「この結果を踏まえて、どうしますか？ ① この案をブラッシュアップする ② 全く新しい案を出してもらう ③ この案で次のフェーズに進む」
- 問題が見つからない場合：その旨と「勝てる余地あり」を伝え「いつでも次のフェーズへ進めます。」と添える
- ユーザーから「別の視点で調査して」「もっと詳しく」「再調査して」等の追加調査依頼が来た場合：web_searchを再実行して追加レポートを返す

## 決断検出（必須・省略不可）
発言の最後の行に必ず以下のいずれか1つだけを出力すること：
- 調査レポートの末尾に①②③の選択肢を提示した場合 → <<<NEEDS_CHOICE>>>
- ユーザーが①②③のいずれかを選択・決断した場合（例：「①で進める」「案Aにします」「これで行きます」「③ このまま次へ」「この案で決めた」） → <<<IS_DECIDED>>>
- 上記以外（追加調査・再レポート・通常の会話など） → <<<CONTINUE>>>

## 制約
${noTagInstruction}

## 言語
${langInstruction}`,

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
全人格の議論を受けて現時点の最適解を出す。

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

// ─── 調査者：Web検索付きClaude呼び出し ──────────────────────
async function callClaudeWithSearch(
  language: "ja" | "en",
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<{ content: string; isDecided: boolean; needsChoice: boolean }> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: getSystemPrompt("researcher", language),
    tools: [{ type: "web_search_20250305", name: "web_search" }] as unknown as Anthropic.Messages.Tool[],
    messages,
  });

  // テキストブロックをすべて結合
  const rawText = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n")
    .trim();

  const isDecided = rawText.includes("<<<IS_DECIDED>>>");
  const needsChoice = rawText.includes("<<<NEEDS_CHOICE>>>");
  const content = rawText
    .replace("<<<IS_DECIDED>>>", "")
    .replace("<<<NEEDS_CHOICE>>>", "")
    .replace("<<<CONTINUE>>>", "")
    .trim();

  return { content, isDecided, needsChoice };
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

// ─── フェーズ別人格マップ ─────────────────────────────────────
const PHASE_PERSONAS: Record<number, string[]> = {
  1: ["proposer", "researcher"],
  2: ["affirmer", "critic"],
  3: ["observer", "synthesizer"],
};

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
    phase = 1,
    isPhaseTransition = false,
  } = body as {
    theme: string;
    messages: { role: "user" | "assistant"; content: string }[];
    target: string[] | null;
    userMessage: string | null;
    language: "ja" | "en";
    sessionId?: string;
    wasInterventionPrevious?: boolean;
    phase?: 1 | 2 | 3;
    isPhaseTransition?: boolean;
  };

  try {
    // ─── "done" 検知 ─────────────────────────────────────────
    if (userMessage && userMessage.trim().toLowerCase() === "done") {
      if (!sessionId) {
        return Response.json({ error: "sessionId is required to generate summary" }, { status: 400 });
      }
      const summary = await generateDiscussionSummary(sessionId);
      return Response.json({ isDone: true, summary });
    }

    const results: {
      persona: string;
      content: string;
      isMain: boolean;
      isIntervention?: boolean;
    }[] = [];

    const currentPhasePersonas = PHASE_PERSONAS[phase] ?? ["affirmer", "critic"];

    // ─── フェーズ自動遷移（「次のフェーズへ」ボタン押下） ─────
    if (isPhaseTransition) {
      const transitionPrompt =
        phase === 2
          ? language === "ja"
            ? "Phase 1（発案）で発案者と調査者が議論した内容を踏まえて、Phase 2（検証）として可能性と弱点を検証せよ。"
            : "Based on the divergence phase discussion by the Proposer and Researcher, begin Phase 2 verification."
          : language === "ja"
            ? "Phase 2（検証）で肯定者と批判者が議論した内容を踏まえて、Phase 3（統合）として議論を整理・統合せよ。"
            : "Based on the verification phase discussion by the Affirmer and Critic, begin Phase 3 integration.";

      const chainMessages: { role: "user" | "assistant"; content: string }[] = [
        ...historyMessages,
        { role: "user", content: transitionPrompt },
      ];

      if (phase === 2) {
        // 肯定者
        const affirmerReply = await callClaude("affirmer", language, chainMessages);
        results.push({ persona: "affirmer", content: affirmerReply, isMain: true });
        await dbSaveMessage(sessionId, "affirmer", affirmerReply);
        chainMessages.push({
          role: "assistant",
          content: language === "ja" ? `[肯定者] ${affirmerReply}` : `[Affirmer] ${affirmerReply}`,
        });

        // 批判者
        chainMessages.push({
          role: "user",
          content:
            language === "ja"
              ? "批判者として、肯定者の発言を踏まえて発言せよ。"
              : "As the Critic, respond to the Affirmer's statement above.",
        });
        const criticReply = await callClaude("critic", language, chainMessages);
        results.push({ persona: "critic", content: criticReply, isMain: true });
        await dbSaveMessage(sessionId, "critic", criticReply);

        return Response.json({ responses: results, phaseCompleted: true });

      } else if (phase === 3) {
        // 俯瞰者
        const observerReply = await callClaude("observer", language, chainMessages);
        results.push({ persona: "observer", content: observerReply, isMain: true });
        await dbSaveMessage(sessionId, "observer", observerReply);
        chainMessages.push({
          role: "assistant",
          content: language === "ja" ? `[俯瞰者] ${observerReply}` : `[Observer] ${observerReply}`,
        });

        // 統合者
        chainMessages.push({
          role: "user",
          content:
            language === "ja"
              ? "統合者として、全人格の議論を踏まえて現時点の最適解と次のアクションを出せ。"
              : "As the Synthesizer, provide the optimal conclusion and next action based on all perspectives above.",
        });
        const synthesizerReply = await callClaude("synthesizer", language, chainMessages);
        results.push({ persona: "synthesizer", content: synthesizerReply, isMain: true });
        await dbSaveMessage(sessionId, "synthesizer", synthesizerReply);
        await dbSaveFinalConclusion(sessionId, synthesizerReply);

        return Response.json({ responses: results, phaseCompleted: false });
      }

      return Response.json({ responses: results });
    }

    // ─── 通常フロー（ユーザー発言） ──────────────────────────
    const baseContent = userMessage
      ? userMessage
      : language === "ja"
        ? `テーマ：${theme}`
        : `Topic: ${theme}`;

    const respondingPersonas: string[] =
      target && target.length > 0 ? target : currentPhasePersonas;

    console.log("[route.ts] phase:", phase, "target:", target, "→ respondingPersonas:", respondingPersonas);

    // ─── 特定人格への発言 ─────────────────────────────────────
    if (target && target.length > 0) {
      const chainMessages: { role: "user" | "assistant"; content: string }[] = [
        ...historyMessages,
        { role: "user", content: baseContent },
      ];

      let isDecidedByResearcher = false;
      let needsChoiceByResearcher = false;

      for (const persona of respondingPersonas) {
        if (persona === "researcher") {
          const { content: researcherContent, isDecided, needsChoice: nc } = await callClaudeWithSearch(language, chainMessages);
          isDecidedByResearcher = isDecided;
          needsChoiceByResearcher = nc;
          results.push({ persona, content: researcherContent, isMain: true });
          await dbSaveMessage(sessionId, persona as Speaker, researcherContent);
          chainMessages.push({ role: "assistant", content: `[${persona}] ${researcherContent}` });
        } else {
          const reply = await callClaude(persona, language, chainMessages);
          results.push({ persona, content: reply, isMain: true });
          await dbSaveMessage(sessionId, persona as Speaker, reply);
          chainMessages.push({ role: "assistant", content: `[${persona}] ${reply}` });
        }
      }

      // サブ人格：現フェーズの残り人格が一言反応
      const subPersonas = currentPhasePersonas.filter((p) => !respondingPersonas.includes(p));
      if (subPersonas.length > 0) {
        const mainSummary = results.map((r) => r.content).join("\n\n");
        for (const persona of subPersonas) {
          const subContext: { role: "user" | "assistant"; content: string }[] = [
            ...chainMessages,
            {
              role: "user",
              content:
                language === "ja"
                  ? `${respondingPersonas.join("、")}の発言を受けて、あなたの視点から1〜2文で反応せよ。\n\n${mainSummary}`
                  : `React to the following statement in 1-2 sentences.\n\n${mainSummary}`,
            },
          ];
          const reply = await callClaude(persona, language, subContext, true);
          results.push({ persona, content: reply, isMain: false });
          await dbSaveMessage(sessionId, persona as Speaker, reply);
        }
      }

      // Phase 1 では調査者の is_decided を phaseCompleted、needs_choice を needsChoice として返す
      const phaseCompleted = phase === 1 ? isDecidedByResearcher : false;
      const needsChoice = phase === 1 ? needsChoiceByResearcher : false;
      return Response.json({ responses: results, phaseCompleted, needsChoice });
    }

    // ─── 全員への発言（現フェーズの人格が反応） ───────────────
    const chainMessages: { role: "user" | "assistant"; content: string }[] = [
      ...historyMessages,
      { role: "user", content: baseContent },
    ];

    // 介入チェック（Phase 1 および前回介入済みはスキップ）
    let interventionTrigger: "taku" | "critic" | null = null;
    if (phase !== 1 && !wasInterventionPrevious) {
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
      // 俯瞰者が介入
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
    }

    // ─── Phase 1：発案者 → 調査者 ────────────────────────────
    if (phase === 1) {
      const proposerReply = await callClaude("proposer", language, chainMessages);
      results.push({ persona: "proposer", content: proposerReply, isMain: true });
      await dbSaveMessage(sessionId, "proposer", proposerReply);
      chainMessages.push({
        role: "assistant",
        content: language === "ja" ? `[発案者] ${proposerReply}` : `[Proposer] ${proposerReply}`,
      });

      chainMessages.push({
        role: "user",
        content:
          language === "ja"
            ? "調査者として、発案者のアイデアについてWeb検索で競合・市場規模・法規制を調査してレポートせよ。"
            : "As the Researcher, search the web for competitors, market size, and regulations related to the Proposer's ideas and report your findings.",
      });
      const { content: researcherContent, isDecided, needsChoice } = await callClaudeWithSearch(language, chainMessages);
      results.push({ persona: "researcher", content: researcherContent, isMain: true });
      await dbSaveMessage(sessionId, "researcher", researcherContent);

      return Response.json({
        responses: results,
        phaseCompleted: isDecided,
        needsChoice,
      });
    }

    // ─── Phase 2：肯定者 → 批判者 ────────────────────────────
    if (phase === 2) {
      const affirmerReply = await callClaude("affirmer", language, chainMessages);
      results.push({ persona: "affirmer", content: affirmerReply, isMain: true });
      await dbSaveMessage(sessionId, "affirmer", affirmerReply);
      chainMessages.push({
        role: "assistant",
        content: language === "ja" ? `[肯定者] ${affirmerReply}` : `[Affirmer] ${affirmerReply}`,
      });

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

      return Response.json({ responses: results, phaseCompleted: true });
    }

    // ─── Phase 3：俯瞰者 → 統合者 ────────────────────────────
    if (phase === 3) {
      const observerReply = await callClaude("observer", language, chainMessages);
      results.push({ persona: "observer", content: observerReply, isMain: true });
      await dbSaveMessage(sessionId, "observer", observerReply);
      chainMessages.push({
        role: "assistant",
        content: language === "ja" ? `[俯瞰者] ${observerReply}` : `[Observer] ${observerReply}`,
      });

      chainMessages.push({
        role: "user",
        content:
          language === "ja"
            ? "統合者として、全人格の議論を踏まえて現時点の最適解と次のアクションを出せ。"
            : "As the Synthesizer, provide the optimal conclusion and next action based on all perspectives above.",
      });
      const synthesizerReply = await callClaude("synthesizer", language, chainMessages);
      results.push({ persona: "synthesizer", content: synthesizerReply, isMain: true });
      await dbSaveMessage(sessionId, "synthesizer", synthesizerReply);
      await dbSaveFinalConclusion(sessionId, synthesizerReply);

      return Response.json({ responses: results, phaseCompleted: false });
    }

    return Response.json({ responses: results });

  } catch (error) {
    console.error("[debate API error]", error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}

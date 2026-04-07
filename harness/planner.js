const Anthropic = require("@anthropic-ai/sdk");
require("dotenv").config({ path: "../.env.local" });

const client = new Anthropic.default({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function planTask(taskDescription) {
  console.log("📋 Planner: タスクを分解中...");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: `
あなたはソフトウェア開発のプランナーです。
以下のタスクを具体的な実装ステップに分解してください。

タスク: ${taskDescription}

対象プロジェクト: Next.js + Supabase + Anthropic APIを使った4人格壁打ちAIアプリ

以下のJSON形式で返してください：
{
  "summary": "タスクの概要",
  "steps": [
    {
      "id": 1,
      "description": "ステップの説明",
      "files": ["変更するファイルのパス"],
      "details": "具体的な実装内容"
    }
  ]
}
        `,
      },
    ],
  });

  const content = response.content[0].text;
  console.log("🔍 Planner: APIレスポンス全文:\n", content);

  // コードブロックを除去してJSONを抽出
  const stripped = content.replace(/```(?:json)?\s*/g, "").replace(/```/g, "");
  const jsonMatch = stripped.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Plannerがプランを生成できませんでした");

  let plan;
  try {
    plan = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(
      `JSON解析失敗: ${e.message}\n--- レスポンス全文 ---\n${content}`
    );
  }
  console.log("✅ Planner: プラン完成");
  console.log(`   ${plan.steps.length}ステップに分解しました`);

  return plan;
}

module.exports = { planTask };
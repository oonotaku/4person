const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: "../.env.local" });

const client = new Anthropic.default({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function evaluateResults(plan, results) {
  console.log("\n🔍 Evaluator: 結果を評価中...");

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  console.log(`   成功: ${successCount} / 失敗: ${failCount}`);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: `
以下の実装結果を評価してください。

元のプラン:
${JSON.stringify(plan, null, 2)}

実行結果:
${JSON.stringify(results, null, 2)}

以下のJSON形式で評価してください：
{
  "score": 0から100の評価スコア,
  "summary": "評価の概要",
  "issues": ["問題点のリスト"],
  "suggestions": ["改善提案のリスト"],
  "passed": trueまたはfalse
}
        `,
      },
    ],
  });

  const content = response.content[0].text;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Evaluatorが評価を生成できませんでした");

  const evaluation = JSON.parse(jsonMatch[0]);

  console.log(`\n📊 評価スコア: ${evaluation.score}/100`);
  console.log(`   ${evaluation.summary}`);

  if (evaluation.issues.length > 0) {
    console.log("\n⚠️  問題点:");
    evaluation.issues.forEach((issue) => console.log(`   - ${issue}`));
  }

  if (evaluation.suggestions.length > 0) {
    console.log("\n💡 改善提案:");
    evaluation.suggestions.forEach((s) => console.log(`   - ${s}`));
  }

  console.log(`\n✅ Evaluator: ${evaluation.passed ? "合格" : "不合格"}`);
  return evaluation;
}

module.exports = { evaluateResults };
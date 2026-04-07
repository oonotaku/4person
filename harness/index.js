const { planTask } = require("./planner");
const { generateCode } = require("./generator");
const { evaluateResults } = require("./evaluator");

async function runHarness(taskDescription) {
  console.log("🚀 ハーネス起動");
  console.log(`📝 タスク: ${taskDescription}`);
  console.log("=".repeat(50));

  const startTime = Date.now();

  try {
    // Step 1: プランニング
    const plan = await planTask(taskDescription);

    // Step 2: コード生成
    const results = await generateCode(plan);

    // Step 3: 評価
    const evaluation = await evaluateResults(plan, results);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log("\n" + "=".repeat(50));
    console.log("🏁 ハーネス完了");
    console.log(`⏱️  所要時間: ${elapsed}秒`);
    console.log(`📊 最終スコア: ${evaluation.score}/100`);
    console.log(`結果: ${evaluation.passed ? "✅ 合格" : "❌ 不合格"}`);

    return { plan, results, evaluation };
  } catch (error) {
    console.error("❌ ハーネスエラー:", error.message);
    throw error;
  }
}

// タスクの説明をここに書く
const task = `
4人格壁打ちAIアプリに以下の機能を追加してください：

1. ユーザーが「done」と送信したとき、議論を終了する
2. 終了時に4人格が議論のサマリーを生成する
3. サマリーには「結論」「主な論点」「次のアクション」を含める
`;

runHarness(task);
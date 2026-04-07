const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: "../.env.local" });

const client = new Anthropic.default({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const projectRoot = path.resolve(__dirname, "..");

function readExistingFiles(files) {
  const contents = {};
  for (const filePath of files) {
    const absPath = path.join(projectRoot, filePath);
    if (fs.existsSync(absPath)) {
      contents[filePath] = fs.readFileSync(absPath, "utf8");
    }
  }
  return contents;
}

function writeFile(filePath, content) {
  const absPath = path.join(projectRoot, filePath);
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(absPath, content, "utf8");
}

async function generateCode(plan) {
  console.log("⚙️  Generator: コード生成開始...");

  const results = [];

  for (const step of plan.steps) {
    console.log(`\n   ステップ ${step.id}: ${step.description}`);

    try {
      // 既存ファイルの内容を読み込む
      const existingContents = readExistingFiles(step.files);
      const existingSummary =
        Object.keys(existingContents).length > 0
          ? Object.entries(existingContents)
              .map(
                ([f, c]) =>
                  `--- 既存ファイル: ${f} (${c.split("\n").length}行) ---\n${c}`
              )
              .join("\n\n")
          : "（対象ファイルはまだ存在しない）";

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        messages: [
          {
            role: "user",
            content: `
あなたはNext.js + TypeScript + Supabaseプロジェクトのコード実装エージェントです。
以下のタスクを実装し、各ファイルの完全な内容をJSONで返してください。

## タスク
${step.details}

## 対象ファイル
${step.files.join(", ")}

## 既存ファイルの内容
${existingSummary}

## 厳守ルール
1. 既存ファイルがある場合は、その内容を保持した上で最小限の変更を加える
2. 既存の実装を削除・大幅書き換えしない
3. 新機能は可能な限り新しいファイルとして切り出す
4. 既存ファイルへの変更はimport追加・小さな修正のみに留める

## 出力形式
以下のJSON形式のみで返してください（説明文は不要）：
{
  "files": [
    {
      "path": "ファイルのパス（プロジェクトルートからの相対パス）",
      "content": "ファイルの完全な内容"
    }
  ],
  "summary": "実装内容の簡潔な説明"
}
            `.trim(),
          },
        ],
      });

      const responseText = response.content[0].text;

      // JSONを抽出
      const stripped = responseText
        .replace(/```(?:json)?\s*/g, "")
        .replace(/```/g, "");
      const jsonMatch = stripped.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error(
          `JSONが見つかりません。レスポンス: ${responseText.slice(0, 200)}`
        );
      }

      const generated = JSON.parse(jsonMatch[0]);

      // ファイルを実際に書き込む
      const writtenFiles = [];
      for (const file of generated.files) {
        writeFile(file.path, file.content);
        writtenFiles.push(file.path);
        console.log(`   📝 書き込み: ${file.path}`);
      }

      results.push({
        stepId: step.id,
        success: true,
        writtenFiles,
        summary: generated.summary,
      });

      console.log(`   ✅ ステップ ${step.id} 完了: ${generated.summary}`);
    } catch (error) {
      results.push({
        stepId: step.id,
        success: false,
        error: error.message,
      });
      console.log(`   ❌ ステップ ${step.id} 失敗: ${error.message}`);
    }
  }

  console.log("\n✅ Generator: 全ステップ完了");
  return results;
}

module.exports = { generateCode };

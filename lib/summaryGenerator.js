import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// 4人格の定義とそれぞれの担当セクション
const PERSONAS = {
  conclusion: {
    name: "結論分析者",
    role: "論理的で客観的な分析者として、議論の要点を整理し明確な結論を導く",
    instruction: "会議の内容を分析し、最も重要な結論や決定事項を3つのポイントに整理してください。各ポイントは具体的で実行可能な内容にまとめ、箇条書きで回答してください。"
  },
  mainPoints: {
    name: "論点整理者",
    role: "批判的思考を持つ議論の専門家として、複数の視点から論点を整理する",
    instruction: "会議で議論された主要な論点を特定し、賛成・反対の意見や課題点を含めて整理してください。重要度順に3-5つの論点を箇条書きで説明し、それぞれに対する異なる立場の意見も併記してください。"
  },
  nextActions: {
    name: "アクション企画者",
    role: "実行力のあるプロジェクトマネージャーとして、具体的で実現可能な次のステップを企画する",
    instruction: "会議の内容を踏まえ、次に取るべき具体的なアクションを整理してください。各アクションには担当者（役職）、期限の目安、優先度を含めて、実行可能な形で3-5つのアクションプランを箇条書きで提案してください。"
  },
  insights: {
    name: "洞察発見者",
    role: "創造的で直感的な思考を持つ戦略コンサルタントとして、隠れた機会や課題を発見する",
    instruction: "会議で直接言及されていないが重要な洞察や、将来的なリスク・機会を分析してください。業界トレンドや組織の文脈を考慮し、3つの重要な洞察を箇条書きで提示してください。"
  }
};

/**
 * 指定された人格でAnthropic APIを呼び出す
 * @param {string} content - 分析対象のコンテンツ
 * @param {Object} persona - 人格定義オブジェクト
 * @returns {Promise<string>} - APIレスポンス
 */
async function callAnthropicWithPersona(content, persona) {
  const systemPrompt = `あなたは${persona.name}です。${persona.role}。

以下の指示に従って回答してください：
${persona.instruction}`;

  const userPrompt = `以下の会議内容を分析してください：

${content}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 1000,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt
        }
      ]
    });

    return response.content[0].text;
  } catch (error) {
    console.error(`Error calling Anthropic API for ${persona.name}:`, error);
    throw new Error(`Failed to generate ${persona.name} analysis: ${error.message}`);
  }
}

/**
 * 4人格を使用してサマリーを生成する
 * @param {string} content - 分析対象のコンテンツ
 * @returns {Promise<Object>} - 構造化されたサマリーデータ
 */
export async function generateStructuredSummary(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('Content must be a non-empty string');
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const results = {};
  const errors = {};

  // 各人格で順次分析を実行
  for (const [key, persona] of Object.entries(PERSONAS)) {
    try {
      console.log(`Generating analysis with ${persona.name}...`);
      const analysis = await callAnthropicWithPersona(content, persona);
      results[key] = {
        personaName: persona.name,
        analysis: analysis.trim()
      };
      
      // API制限を考慮して少し待機
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Failed to generate analysis for ${persona.name}:`, error);
      errors[key] = error.message;
      // エラーが発生してもその人格の分析は空文字として続行
      results[key] = {
        personaName: persona.name,
        analysis: '',
        error: error.message
      };
    }
  }

  // 構造化されたサマリーデータを返す
  const structuredSummary = {
    metadata: {
      generatedAt: new Date().toISOString(),
      contentLength: content.length,
      personasUsed: Object.keys(PERSONAS).length,
      hasErrors: Object.keys(errors).length > 0
    },
    summary: {
      conclusion: {
        title: "結論・決定事項",
        content: results.conclusion?.analysis || '',
        persona: results.conclusion?.personaName || '',
        error: results.conclusion?.error || null
      },
      mainPoints: {
        title: "主要な論点",
        content: results.mainPoints?.analysis || '',
        persona: results.mainPoints?.personaName || '',
        error: results.mainPoints?.error || null
      },
      nextActions: {
        title: "次のアクション",
        content: results.nextActions?.analysis || '',
        persona: results.nextActions?.personaName || '',
        error: results.nextActions?.error || null
      },
      insights: {
        title: "重要な洞察",
        content: results.insights?.analysis || '',
        persona: results.insights?.personaName || '',
        error: results.insights?.error || null
      }
    },
    errors: Object.keys(errors).length > 0 ? errors : null
  };

  return structuredSummary;
}

/**
 * サマリーをMarkdown形式でフォーマット
 * @param {Object} structuredSummary - 構造化されたサマリーデータ
 * @returns {string} - Markdown形式の文字列
 */
export function formatSummaryAsMarkdown(structuredSummary) {
  const { summary, metadata } = structuredSummary;
  
  let markdown = `# 会議サマリー\n\n`;
  markdown += `*生成日時: ${new Date(metadata.generatedAt).toLocaleString('ja-JP')}*\n\n`;
  
  // 各セクションをMarkdownで出力
  for (const [key, section] of Object.entries(summary)) {
    markdown += `## ${section.title}\n`;
    markdown += `*担当: ${section.persona}*\n\n`;
    
    if (section.error) {
      markdown += `⚠️ **エラーが発生しました:** ${section.error}\n\n`;
    } else if (section.content) {
      markdown += `${section.content}\n\n`;
    } else {
      markdown += `*分析結果がありません*\n\n`;
    }
  }
  
  return markdown;
}

/**
 * サマリー生成の進行状況を監視するためのヘルパー
 * @param {string} content - 分析対象のコンテンツ
 * @param {Function} onProgress - 進行状況コールバック
 * @returns {Promise<Object>} - 構造化されたサマリーデータ
 */
export async function generateStructuredSummaryWithProgress(content, onProgress) {
  if (!content || typeof content !== 'string') {
    throw new Error('Content must be a non-empty string');
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const results = {};
  const errors = {};
  const totalPersonas = Object.keys(PERSONAS).length;
  let completedCount = 0;

  // 進行状況を通知
  if (onProgress) {
    onProgress({
      completed: 0,
      total: totalPersonas,
      current: null,
      percentage: 0
    });
  }

  // 各人格で順次分析を実行
  for (const [key, persona] of Object.entries(PERSONAS)) {
    try {
      // 現在の処理を通知
      if (onProgress) {
        onProgress({
          completed: completedCount,
          total: totalPersonas,
          current: persona.name,
          percentage: Math.round((completedCount / totalPersonas) * 100)
        });
      }

      const analysis = await callAnthropicWithPersona(content, persona);
      results[key] = {
        personaName: persona.name,
        analysis: analysis.trim()
      };
      
      completedCount++;
      
      // 進行状況を更新
      if (onProgress) {
        onProgress({
          completed: completedCount,
          total: totalPersonas,
          current: persona.name,
          percentage: Math.round((completedCount / totalPersonas) * 100)
        });
      }
      
      // API制限を考慮して少し待機
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Failed to generate analysis for ${persona.name}:`, error);
      errors[key] = error.message;
      results[key] = {
        personaName: persona.name,
        analysis: '',
        error: error.message
      };
      completedCount++;
    }
  }

  // 構造化されたサマリーデータを作成して返す
  const structuredSummary = {
    metadata: {
      generatedAt: new Date().toISOString(),
      contentLength: content.length,
      personasUsed: Object.keys(PERSONAS).length,
      hasErrors: Object.keys(errors).length > 0
    },
    summary: {
      conclusion: {
        title: "結論・決定事項",
        content: results.conclusion?.analysis || '',
        persona: results.conclusion?.personaName || '',
        error: results.conclusion?.error || null
      },
      mainPoints: {
        title: "主要な論点",
        content: results.mainPoints?.analysis || '',
        persona: results.mainPoints?.personaName || '',
        error: results.mainPoints?.error || null
      },
      nextActions: {
        title: "次のアクション",
        content: results.nextActions?.analysis || '',
        persona: results.nextActions?.personaName || '',
        error: results.nextActions?.error || null
      },
      insights: {
        title: "重要な洞察",
        content: results.insights?.analysis || '',
        persona: results.insights?.personaName || '',
        error: results.insights?.error || null
      }
    },
    errors: Object.keys(errors).length > 0 ? errors : null
  };

  return structuredSummary;
}
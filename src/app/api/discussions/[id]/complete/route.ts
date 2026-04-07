import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '@/lib/supabase'
import { getMessages, getSession } from '@/lib/db'
import {
  getSummarySystemPrompt,
  getSummaryUserPrompt,
  type SummaryPersona,
} from '@/lib/prompts/summaryPrompts'
import type { Summary, Discussion } from '@/types/discussion'
import type { Language } from '@/types/database'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() })
const MODEL = 'claude-sonnet-4-20250514'

// ─── サマリー生成 ─────────────────────────────────────────────

async function callSummaryPersona(
  persona: SummaryPersona,
  messages: { role: 'user' | 'assistant'; content: string }[],
  language: Language
): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: getSummarySystemPrompt(persona, language),
    messages,
  })
  const block = response.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude')
  return block.text
}

function parseSummaryJson(raw: string): Summary {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object found in summary response')
  const parsed = JSON.parse(match[0])
  if (
    typeof parsed.conclusion !== 'string' ||
    !Array.isArray(parsed.main_points) ||
    !Array.isArray(parsed.next_actions)
  ) {
    throw new Error('Invalid summary structure from Claude')
  }
  return parsed as Summary
}

async function generateSummary(
  conversationHistory: string,
  language: Language
): Promise<Summary> {
  const baseUserPrompt = getSummaryUserPrompt(conversationHistory, language)

  const [affirmerRaw, criticRaw, observerRaw] = await Promise.all([
    callSummaryPersona('affirmer', [{ role: 'user', content: baseUserPrompt }], language),
    callSummaryPersona('critic', [{ role: 'user', content: baseUserPrompt }], language),
    callSummaryPersona('observer', [{ role: 'user', content: baseUserPrompt }], language),
  ])

  const synthContext =
    language === 'ja'
      ? `${baseUserPrompt}\n\n## 各視点の分析結果\n[肯定者]\n${affirmerRaw}\n\n[批判者]\n${criticRaw}\n\n[俯瞰者]\n${observerRaw}`
      : `${baseUserPrompt}\n\n## Analysis from each perspective\n[Affirmer]\n${affirmerRaw}\n\n[Critic]\n${criticRaw}\n\n[Observer]\n${observerRaw}`

  const synthRaw = await callSummaryPersona(
    'synthesizer',
    [{ role: 'user', content: synthContext }],
    language
  )

  return parseSummaryJson(synthRaw)
}

// ─── POSTハンドラー ──────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!id) {
    return Response.json({ error: 'Invalid discussion ID' }, { status: 400 })
  }

  try {
    const { data: discussion, error: fetchError } = await supabase
      .from('discussions')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !discussion) {
      return Response.json({ error: 'Discussion not found' }, { status: 404 })
    }

    if (discussion.status === 'completed') {
      return Response.json({ error: 'Discussion is already completed' }, { status: 409 })
    }

    // 言語を取得（セッション → リクエストボディ → デフォルト ja の順）
    let language: Language = 'ja'
    try {
      const session = await getSession(id)
      if (session?.language === 'en') language = 'en'
    } catch {
      try {
        const body = await request.json()
        const bodyLang = body?.language
        if (bodyLang === 'en' || bodyLang === 'ja') language = bodyLang
      } catch {
        // bodyが空でも続行
      }
    }

    const messages = await getMessages(id)
    if (!messages || messages.length === 0) {
      return Response.json({ error: 'No messages found for this discussion' }, { status: 400 })
    }

    const conversationHistory = messages
      .map((msg) => `[${msg.speaker}] ${msg.content}`)
      .join('\n\n')

    const summary = await generateSummary(conversationHistory, language)

    const { data: updated, error: updateError } = await supabase
      .from('discussions')
      .update({ status: 'completed', summary })
      .eq('id', id)
      .select()
      .single()

    if (updateError || !updated) {
      throw new Error('Failed to update discussion in database')
    }

    return Response.json({ discussion: updated as Discussion })
  } catch (error) {
    console.error('[complete API error]', error)
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ error: message }, { status: 500 })
  }
}

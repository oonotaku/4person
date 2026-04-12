import { supabase, Speaker, Language } from './supabase'

export async function createSession(theme: string, language: Language, userId?: string) {
  const { data, error } = await supabase
    .from('sessions')
    .insert({ theme, language, user_id: userId ?? null })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getSessions(userId?: string) {
  let query = supabase
    .from('sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)
  if (userId) {
    query = query.eq('user_id', userId)
  }
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function getSession(sessionId: string) {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single()
  if (error) throw error
  return data
}

export async function saveMessage(
  sessionId: string,
  speaker: Speaker,
  content: string,
  target?: string
) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ session_id: sessionId, speaker, content, target })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getMessages(sessionId: string) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function updateSessionPhase(sessionId: string, phase: 1 | 2 | 3) {
  const { error } = await supabase
    .from('sessions')
    .update({ current_phase: phase })
    .eq('id', sessionId)
  if (error) throw error
}

export async function updateDecidedIdeaTitle(sessionId: string, title: string) {
  const { error } = await supabase
    .from('sessions')
    .update({ decided_idea_title: title })
    .eq('id', sessionId)
  if (error) throw error
}

export async function saveFinalConclusion(sessionId: string, conclusion: string) {
  const { error } = await supabase
    .from('sessions')
    .update({ final_conclusion: conclusion })
    .eq('id', sessionId)
  if (error) throw error
}

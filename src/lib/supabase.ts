import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Speaker = 'taku' | 'proposer' | 'researcher' | 'affirmer' | 'critic' | 'observer' | 'synthesizer'
export type Language = 'ja' | 'en'

export interface Session {
  id: string
  user_id?: string
  theme: string
  language: Language
  created_at: string
  final_conclusion?: string
  is_completed?: boolean
  summary?: { conclusion: string; main_points: string[]; next_actions: string[] } | null
  current_phase?: 1 | 2 | 3
}

export interface Message {
  id: string
  session_id: string
  speaker: Speaker
  content: string
  target?: string
  created_at: string
}

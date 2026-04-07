export type Speaker = 'taku' | 'affirmer' | 'critic' | 'observer' | 'synthesizer'
export type Language = 'ja' | 'en'

export interface Session {
  id: string
  user_id?: string
  theme: string
  language: Language
  created_at: string
  final_conclusion?: string
}

export interface Message {
  id: string
  session_id: string
  speaker: Speaker
  content: string
  target?: string
  created_at: string
}

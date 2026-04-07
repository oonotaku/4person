export interface Summary {
  conclusion: string
  main_points: string[]
  next_actions: string[]
}

export type DiscussionStatus = 'active' | 'completed'

export interface Discussion {
  id: string
  status: DiscussionStatus
  summary: Summary | null
  created_at: string
}

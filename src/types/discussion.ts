export interface Summary {
  verdict: "実行すべき" | "条件付きで実行すべき" | "見送るべき"
  verdict_reason: string
  conditions: string[]
  first_step: string
}

export type DiscussionStatus = 'active' | 'completed'

export interface Discussion {
  id: string
  status: DiscussionStatus
  summary: Summary | null
  created_at: string
}

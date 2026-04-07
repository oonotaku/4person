-- Migration: add status and summary columns to discussions table
-- Status: 'active' | 'completed'
-- Summary: JSONB with { conclusion, main_points, next_actions }

-- Add status column with check constraint, defaulting to 'active'
ALTER TABLE discussions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed'));

-- Add summary column as JSONB (nullable until discussion is completed)
-- Expected shape:
-- {
--   "conclusion":   "...",          -- string
--   "main_points":  ["...", ...],   -- string[]
--   "next_actions": ["...", ...]    -- string[]
-- }
ALTER TABLE discussions
  ADD COLUMN IF NOT EXISTS summary JSONB;

-- Optional index to filter by status efficiently
CREATE INDEX IF NOT EXISTS idx_discussions_status ON discussions (status);

-- Comment columns for documentation
COMMENT ON COLUMN discussions.status IS 'Discussion lifecycle state: active or completed';
COMMENT ON COLUMN discussions.summary IS 'Structured summary produced when discussion completes: { conclusion: string, main_points: string[], next_actions: string[] }';

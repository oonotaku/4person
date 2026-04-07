-- Add status column to discussions table
ALTER TABLE discussions ADD COLUMN status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed'));

-- Create discussion_summaries table
CREATE TABLE discussion_summaries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  discussion_id UUID NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  conclusion TEXT,
  main_points JSONB DEFAULT '[]'::jsonb,
  next_actions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for better query performance
CREATE INDEX idx_discussion_summaries_discussion_id ON discussion_summaries(discussion_id);

-- Add RLS policies for discussion_summaries
ALTER TABLE discussion_summaries ENABLE ROW LEVEL SECURITY;

-- Users can view summaries for discussions they have access to
CREATE POLICY "Users can view discussion summaries" ON discussion_summaries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM discussions 
      WHERE discussions.id = discussion_summaries.discussion_id 
      AND discussions.created_by = auth.uid()
    )
  );

-- Users can create summaries for discussions they own
CREATE POLICY "Users can create discussion summaries" ON discussion_summaries
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM discussions 
      WHERE discussions.id = discussion_summaries.discussion_id 
      AND discussions.created_by = auth.uid()
    )
  );

-- Users can update summaries for discussions they own
CREATE POLICY "Users can update discussion summaries" ON discussion_summaries
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM discussions 
      WHERE discussions.id = discussion_summaries.discussion_id 
      AND discussions.created_by = auth.uid()
    )
  );

-- Users can delete summaries for discussions they own
CREATE POLICY "Users can delete discussion summaries" ON discussion_summaries
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM discussions 
      WHERE discussions.id = discussion_summaries.discussion_id 
      AND discussions.created_by = auth.uid()
    )
  );
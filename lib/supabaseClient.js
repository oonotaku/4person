import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// クライアント側用
export const supabase = createClient(supabaseUrl, supabaseKey);

// サーバー側用（管理者権限）
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export default supabase;
import { createClient } from '@supabase/supabase-js';
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://imdvmlzdbmbvwkfoisgs.supabase.co';
export const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_Ug9ch67Xx6cdXJygAq0fjg_VoGOw8jj';
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

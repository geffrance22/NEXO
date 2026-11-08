import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || 'https://imdvmlzdbmbvwkfoisgs.supabase.co',
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_Ug9ch67Xx6cdXJygAq0fjg_VoGOw8jj',
);

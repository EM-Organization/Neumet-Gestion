import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// window.supabase lo aporta el UMD de supabase-js (con SRI) cargado antes en adminpanel/index.html.
export const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// This portal's own Supabase project - kept completely separate from the
// Houseago Properties Ltd tenant portal's project, since this one holds
// company/personal financial documents.
//
// This "publishable" key (the current name for what used to be called the
// "anon public" key) is safe to expose in the browser; it only works within
// the access rules set up in the database, see SETUP.md. Never put the
// "secret"/"service_role" key here.
const SUPABASE_URL = "https://icdcoexrrvqpplhxycgz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_jS8tTdnDABky_osEauSKhw_TZHIH-ue";

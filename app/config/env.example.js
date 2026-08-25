// PlanEOS · runtime config
//
// Copy this file to env.js and fill in your own Supabase project.
// Both values below are public by design: security is enforced by
// Row Level Security policies in the database, not by hiding the key.
//
//   cp app/config/env.example.js app/config/env.js
//
export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_KEY = 'YOUR-PUBLISHABLE-KEY';

// Marketing / app URLs (used for redirects, invites, checkout return)
export const APP_URL  = window.location.origin + '/planeos/app';
export const SITE_URL = window.location.origin + '/planeos/site';

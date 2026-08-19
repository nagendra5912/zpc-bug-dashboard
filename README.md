# ZPC Bug Report Console

Shared team bug tracker for Zameen Pe Charcha. One Vercel URL, one Supabase table, live updates.

## Team link (after deploy)

Share the Vercel URL with the team. No login is required for this first version.

Anyone with the URL can add, edit, and delete bugs. Keep the link internal.

## One-time Supabase setup

1. Open [Supabase SQL Editor](https://supabase.com/dashboard/project/wockvuodtrxslvegdzpr/sql/new).
2. Paste `supabase.sql` from this repo and **Run**.
3. Confirm Project URL is `https://wockvuodtrxslvegdzpr.supabase.co`.

This app is Vite. Use these names on Vercel (not `NEXT_PUBLIC_*`):

```
VITE_SUPABASE_URL=https://wockvuodtrxslvegdzpr.supabase.co
VITE_SUPABASE_ANON_KEY=<anon or publishable key>
```

The dashboard **anon/public** key or the new **publishable** key both work.

## Local

```bash
npm install
cp .env.example .env.local
# edit .env.local with the two VITE_ values
npm run dev
```

## Vercel

1. Import this GitHub repo into Vercel.
2. Framework: **Vite** · Build: `npm run build` · Output: `dist`.
3. Environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Deploy. Copy the `*.vercel.app` URL to the team.

## Security next step

Add company-email login and restrict delete to admins when you outgrow the shared-link model.

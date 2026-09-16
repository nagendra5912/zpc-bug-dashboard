# ZPC Bug Report Console

Shared team bug tracker for Zameen Pe Charcha. One Vercel URL, one Supabase table, live updates. Screenshots upload to **Supabase Storage** (not Vercel).

## Team link (after deploy)

Share the Vercel URL with the team. No login is required for this first version.

Anyone with the URL can add, edit, and delete bugs (including screenshots). Keep the link internal.

## Storage: Vercel free plan vs screenshots

**Vercel Hobby does not give you a file store for bug images.** It only hosts the static dashboard build.

Screenshots are stored in **Supabase Storage** on the free tier:

| What | Where |
|------|--------|
| App (HTML/JS) | Vercel |
| Bug rows | Supabase Postgres (`bugs`) |
| Screenshot files | Supabase Storage bucket `bug-screenshots` (~1 GB free) |

Limits used by this app: up to **5 images per bug**, **5 MB each**, types PNG / JPEG / WebP / GIF.

### Auto-prune near 1 GB

Before each screenshot upload, the dashboard checks bucket usage. If usage + the new files would go over **~900 MB**, it **deletes the oldest screenshots first** until usage is around **~800 MB**, then uploads. Bug rows are updated so removed images disappear from those bugs.

Screenshots still attached on the form you are saving are protected. This is best-effort (client-side); it keeps the free tier from filling hard, but is not a guaranteed cron job.

## One-time Supabase setup

1. Open [Supabase SQL Editor](https://supabase.com/dashboard/project/wockvuodtrxslvegdzpr/sql/new) (not a local Postgres client).
2. Paste `supabase.sql` from this repo and **Run** (creates/updates `bugs.screenshot_urls` and the `bug-screenshots` bucket + policies).
3. Confirm Project URL is `https://wockvuodtrxslvegdzpr.supabase.co`.

If you see `role "anon" does not exist`, you ran the old script against a non-Supabase Postgres connection. Use the SQL Editor link above, or re-run the updated `supabase.sql` (it no longer depends on the `anon` role).

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
5. After pull, re-run `supabase.sql` once so the storage bucket exists, then redeploy if needed.

## Security next step

Add company-email login and restrict delete to admins when you outgrow the shared-link model. The storage bucket is public-read so `<img>` tags work with the anon key; treat the dashboard URL as internal.

# 🫎 Moose Tracker

The family cabin, all in one place — a phone-first web app for the shared calendar,
work orders, supplies, opening/closing procedures, news, and a private
owner-only maintenance & cost log.

Built as a plain static web app (no build step) backed by [Supabase](https://supabase.com)
for logins and data.

## What's inside

| Tab | What it does |
| --- | --- |
| **📅 Calendar** | See who's coming and add your own stays. If your dates overlap someone else's, you get a friendly pop-up — *"Your dates conflict with (name)'s dates"* — and nothing is ever overwritten. |
| **🔧 Work** | Log what needs work around the cabin, mark it a **repair** or an **update**, and track it from *Open → In progress → Done*. |
| **📦 Supplies** | A shared shopping list — napkins, paper towels, firewood… Add what's low, tap "Got it" when it's restocked. |
| **📖 Guide** | The full opening & closing procedures. The owner can edit them any time. |
| **🔒 Private** | Owner-only maintenance log with costs and a running total. **No one else can see this tab** — it's enforced by the database, not just hidden. |
| **🔔 News** | The owner posts updates (new Wi-Fi, lock codes, new chairs…). Everyone gets a pop-up next time they open the app. |

## The look

Flat and modern, in the cabin's own colors: **forest green**, **dull red**,
**dark blue** accents, and **warm white**. Logo is a cartoon moose (`assets/moose.svg`).

---

## Getting it live (one-time setup)

The app is already wired to your Supabase project (see `js/config.js`). You just need to
(1) put the files on the web and (2) tell Supabase what the web address is.

### 1. Put it on the web

Any static host works — the app is just HTML/CSS/JS. Easiest option, since this is
already a GitHub repo:

**GitHub Pages**
1. Push this branch and merge it to your default branch (or enable Pages on this branch).
2. On GitHub: **Settings → Pages → Build and deployment**, Source = *Deploy from a branch*,
   pick the branch and `/ (root)` folder, Save.
3. After a minute you'll get a URL like `https://<you>.github.io/Cabin-App/`. That's your app.

*(Netlify or Vercel work too — just drag the folder in, or point them at the repo.
No build command; publish directory is the repo root.)*

### 2. Tell Supabase your app's address

Magic-link emails need to know where to send people back to.

1. Open your project at [supabase.com](https://supabase.com) →
   **Authentication → URL Configuration**.
2. Set **Site URL** to your app URL from step 1 (e.g. `https://<you>.github.io/Cabin-App/`).
3. Under **Redirect URLs**, add that same URL (with a trailing `*` is fine, e.g.
   `https://<you>.github.io/Cabin-App/**`).
4. Save. That's it — open the app, enter your email, tap the link in your inbox, you're in.

> **Tip:** Supabase's built-in email is fine for a family but is rate-limited and can land
> in spam. For rock-solid delivery you can add free custom SMTP later under
> **Authentication → Emails → SMTP Settings** (e.g. Resend, SendGrid, or your Gmail).

### 3. (Recommended) Keep it family-only

Magic-link login means *anyone who knows the address and enters an email can create an
account*. To keep it to family only, in Supabase go to
**Authentication → Sign In / Providers → Email** and consider:
- Turning **"Allow new users to sign up"** off, then inviting each family member from
  **Authentication → Users → Invite** (they still log in with the magic link).

Either way, the **Private / Maintenance** tab is always safe: it's restricted to the owner
email at the database level (Row Level Security), so even a logged-in family member cannot
read it.

---

## Who's the owner?

The owner (admin) is set in two places, both to `malcolm.johnson3@gmail.com`:
- `js/config.js` → `OWNER_EMAIL` (controls what the app *shows*)
- the `owners` table in the database (controls what the database *allows*)

The owner is the only one who sees the **Private** tab, can **post News**, and can
**edit Procedures**. To add another owner later, add their email to the `owners` table
and to `OWNER_EMAIL` handling — just ask and I can wire multiple owners in.

---

## Running it locally

No build step. From the project folder:

```bash
python3 -m http.server 8099
# then open http://localhost:8099
```

(For magic-link login to work locally, add `http://localhost:8099` to the Supabase
Redirect URLs as well.)

---

## Project layout

```
index.html                 # app shell
manifest.webmanifest       # "Add to Home Screen" support
css/styles.css             # cabin theme
js/config.js               # Supabase URL + key + owner email
js/app.js                  # all app logic
js/vendor/supabase.js      # Supabase client (vendored — no CDN dependency)
assets/moose.svg           # logo + favicon
assets/icon-192/512.png    # home-screen icons
supabase/migrations/       # database schema (already applied)
```

## Notes on the data

- Every table uses Supabase **Row Level Security**. The cabin can never be double-booked
  (a database-level `no_overlap` constraint backs up the friendly pop-up).
- The publishable key in `config.js` is meant to be public — it only grants what RLS allows.

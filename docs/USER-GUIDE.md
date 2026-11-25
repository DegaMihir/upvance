# Upvance – Setup and user guide

> This guide is for people evaluating Upvance on their own computer. The software is published under the PolyForm Strict License 1.0.0, which allows non-commercial use only (see [LICENSE](../LICENSE)). Back to the [project overview](../README.md).

---

## 1. What you need

| Thing | Why | Where |
|---|---|---|
| **Node.js 26** (or 20+) | runs the app | https://nodejs.org → "LTS"/"Current" installer for Windows |
| **Google Chrome** | for the browser extension (optional) | |
| **Gemini API key** (free, optional) | AI analysis & writing | https://aistudio.google.com/apikey |
| **Groq API key** (free, optional) | automatic fallback when Gemini is busy | https://console.groq.com/keys |
| Adzuna key (free, optional) | one more job source | https://developer.adzuna.com |

Without any keys, Upvance still works fully using rule-based matching and editable templates.

---

## 2. First-time setup (Windows PowerShell)

Open **PowerShell** and go to the project folder:

```powershell
cd C:\Users\<you>\Projects\upvance
```

Install the packages (takes a few minutes the first time):

```powershell
npm install
```

Run the one-time setup. This creates the local database, adds any missing secrets to `.env` (it **never** changes your existing API keys), and creates a demo account with a fictional profile and sample history so you can look around:

```powershell
npm run setup
```

Start the app:

```powershell
npm run dev
```

Open **http://localhost:3100** in your browser.

- Sign in: **demo@upvance.local** / **demo12345**
- Or click **Create an account** to start with your own data.

To stop the app, press **Ctrl + C** in the PowerShell window.

### Starting it again later

```powershell
cd C:\Users\<you>\Projects\upvance
npm run dev
```

`npm run dev` starts two things: the website (port 3100) and the **background worker** that runs scheduled searches, refreshes job boards and sponsor lists, and works through the AI queue.

---

## 3. Your keys (`.env`)

All settings live in the `.env` file in the project folder. Open it in Notepad:

```powershell
notepad .env
```

| Variable | What it does |
|---|---|
| `GEMINI_API_KEY` | Google Gemini (free tier). Default AI for both roles. |
| `GROQ_API_KEY` | Groq (free tier). Used automatically when Gemini is rate-limited or overloaded. |
| `ANALYSIS_PROVIDER` / `WRITING_PROVIDER` | `gemini`, `groq`, `openrouter`, `anthropic` or `none`. You can also change these in **Settings** without editing files. |
| `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` | Gemini Flash model, plus a lighter model used when Flash is busy. |
| `AI_DAILY_LIMIT` | Max AI requests per provider per day (keeps you inside free limits). |
| `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` | Optional paid providers (e.g. `claude-haiku-5-5`). |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Optional Adzuna job search. |
| `PORT` | The fixed port (default **3100**). |
| `AUTH_SECRET`, `APP_ENCRYPTION_KEY` | Random secrets created by `npm run setup`. Don't share them. If you lose `APP_ENCRYPTION_KEY`, saved passwords/keys can't be decrypted. |

A template with every variable is in `.env.example`. **Never commit `.env`** – it's already in `.gitignore`.

> ⚠ Free AI tiers (Gemini, Groq, OpenRouter free models) may use what you send them to train their models. Set the providers to `none` if you don't want that.

**Saving AI requests:** jobs are filtered with free keyword/rule checks before any AI call, results are cached (the same job is never analysed twice), background analysis is spread through the day, failed calls are retried with backoff, and the app pauses with a clear message when a daily limit is reached. Usage per day (and estimated cost for paid providers) is shown in **Settings → AI providers & usage**.

---

## 4. Using Upvance

1. **Profile & resumes** – upload your resume PDF (max 10 MB) or type it in. Check every field; missing required fields are highlighted in red. Set your citizenship, current country, existing work rights, sponsorship needs, relocation and salary. You can keep several profiles (e.g. "AI resume", "Software resume").
2. **Discover jobs** – add companies by their Greenhouse/Lever/Ashby board name or careers URL, paste a job URL, paste a description, or import from Remotive / Remote OK / Arbeitnow / Adzuna.
3. **Match feed** – jobs ranked by suitability, with sponsorship and remote badges. Combine filters (e.g. *United States + Remote + I need sponsorship + "AI Engineer"*). Hard rules (citizenship, location, "no sponsorship") override the score.
4. **Job page** – the structured breakdown, a plain-English "why you match / don't match", score breakdown, sponsorship evidence (quoted from the posting plus official lists) → **Prepare application**.
5. **Application page** – review the tailored resume side by side with your original (every change is listed), the cover letter and screening answers. Anything missing or uncertain appears under **Needs you**. Approve, open the employer form, fill it (manually or with the extension), click Submit yourself, then **Confirm submission**.
6. **Auto mode (opt-in)** – up to 5 saved searches, 1–4 runs a day, a shared daily cap, only jobs from the last 48 hours. Applications are prepared and queued for your review – never submitted for you.
7. **Recruiter outreach** – draft a short personal message, copy it, send it yourself, track replies and follow-ups.
8. **Insights / Analytics** – which roles, resumes, skills and companies get responses, plus suggestions you can apply with one click.

---

## 4b. Real jobs, automatic applying, inbox and sheet

### Install the browser engine (once)

The apply engine drives a real Chromium browser on your computer (Playwright).

```powershell
npm install
npm run engine:install
```

### Real jobs from around the world

- The match feed shows real jobs only; the fictional sample jobs that come with the demo account are hidden there. (To delete the sample jobs completely: `npm run demo:remove`.)
- **Discover → Add a company** accepts careers URLs from Greenhouse, Lever, Ashby, Gem, Workable, SmartRecruiters, Recruitee, Personio, Teamtailor, BambooHR, Breezy HR, JazzHR and Workday. How each public endpoint was found is documented in `docs/connectors.md`.
- **Company discovery** looks for the job boards of ~167,000 employers from the official sponsor lists (plus companies you add), your target countries first. Run a batch now:

```powershell
npm run discover
```

  The background worker continues on its own (a few companies every hour) and refreshes found boards every few hours. Optional aggregators: `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` and `SERPAPI_KEY` (Google Jobs) in `.env`.

### Apply to all / Keep applying (review mode)

1. Settings → **Automatic applying & inbox**: set your **application email** (e.g. `yourname+upvance@gmail.com`), the daily cap and your answers for voluntary questions. Keep **Review before submit** (default).
2. Jobs page → set filters (chips) → **Apply to all** → check the counts → **Queue**.
3. The worker (started by `npm run dev`) opens each form in a visible Chromium window, fills it, takes a screenshot and stops.
4. **Apply queue** → “Waiting for your review” → check the screenshot and values → **Approve & submit**. Questions your profile can't answer, CAPTCHAs and accounts appear under “Needs you”.
5. **Keep applying to new matches** saves the current filters; new matching jobs found later are queued automatically. Turn it off with the eye icon next to its name.
6. **Stop all** (Jobs page or Apply queue) stops the engine immediately.

Try it risk-free first: add `APPLY_ENGINE_DRY_RUN=1` to `.env` – the engine then always stops before Submit.

### Inbox

Inbox → choose Gmail/Outlook → enter your email and an **app password** (steps are shown on the page: Google Account → Security → 2-Step Verification → App passwords). Only job-related emails are imported; confirmations, rejections and interview invites update your applications automatically, and verification codes are passed to the apply engine. Replies are drafts until you click **Send**.

### First-time setup

After you register (or sign in to an account that isn't set up), you land on **Set up your account**: 1) upload your resume and complete your profile, 2) confirm countries, roles, visa need, salary and application email, then **Finish setup**. Until then every page except Profile sends you back there. Password boxes have an **eye button** to show what you typed, and Register has a **Confirm password** box – on any error nothing you typed is cleared.

When the apply engine meets open questions like "Why do you want to work at …?", it writes the answer from your resume and the job posting in plain English, checks it is truthful, and saves it with the application so you can edit it before submitting.

### Target roles

Settings → **Target job titles** decides which jobs you see and apply to. The **My target roles** chip on Jobs (on by default) hides every job whose title doesn't fit one of them; click it to see all roles. Matching allows common spellings: engineer = developer, "Full-stack" = "Full Stack", "GenAI" = "Generative AI", "Back-end" = "Backend", plurals, and words like Senior/Lead/Staff are ignored. Text in brackets is a detail, so "Backend Developer (Node.js / Python)" matches any backend developer or engineer. "Apply to all", "Keep applying" and the job-site checks use the same roles.

### Country priority (Tier 1 / Tier 2)

Settings → **Tier 1 countries** and **Tier 2 countries**, each in priority order. The Jobs page sorts by **Country priority** by default: every eligible job in your first country (best match first), then your second country, and so on – Tier 1, then remote-from-anywhere jobs, then Tier 2, then everything else. "Apply to all" and "Keep applying" queue jobs in the same order, so your daily limit goes to your top countries first. Switch the sort to **Best match** or **Newest** any time. Tip: set the **Match** filter to "Good" or better so weak matches in your first country don't crowd out strong ones in the next.

### Job sites and remote pay

**Job sites:** Remotive, Remote OK, We Work Remotely and Y Combinator jobs are checked every 6 hours for the roles in Settings → Target titles (or click **Check job sites now** on Discover jobs). YC jobs show whether the startup sponsors visas and its salary range. We Work Remotely and YC don't let tools apply, so Upvance looks for the same job on the employer's own job page (Ashby, Greenhouse, Lever…) and applies there; if it can't find it, the job is shown with a link to apply yourself. Wellfound isn't included (its job search is closed to tools) – paste the employer's own job link instead.

**Remote pay:** Settings → "Remote jobs must pay the on-site rate" (on by default) lowers the match score of remote jobs whose pay is cut to where you live ("based on location", "local market rates", "cost-of-living adjusted"…) and of jobs paying below your minimum salary. The **Fair remote pay** chip on Jobs hides them. Set **Minimum salary** to the rate paid in the country you'd move to. Jobs without a listed salary are not affected; salaries in another currency are not compared.

### Applications sheet

Applications sheet → filter, sort, search, choose/reorder columns, edit Status/Response/Response date/Notes in place → download **Excel, CSV, PDF, JSON**, or **Copy for Google Sheets** (paste into sheets.new).

Recruiter columns (**Recruiter / contact**, **Contact email**, **LinkedIn / profile**) fill in from recruiters you saved (Recruiter outreach page or the extension) and from people who emailed you about an application (LinkedIn links in their signature included). You can type or paste your own – what you type wins. LinkedIn is never searched or scraped.

---

## 5. Chrome extension

1. In Upvance go to **Settings → Chrome extension pairing → Create pairing token** and copy the token.
2. In Chrome open `chrome://extensions`, switch on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder inside the project.
4. Click the Upvance icon → ⚙ (options). App URL: `http://localhost:3100`. Paste the token → **Save & test connection**.

On a job page (LinkedIn, Indeed, company sites) click the extension → **Analyse this job** to see your match and prepare an application. On an employer form → **Fill this form** fills fields and attaches your approved resume (you check and click Submit). On a recruiter's profile → **Capture recruiter & draft message**.

LinkedIn Easy Apply is not supported. The extension only acts when you click it, and only connects to your local app.

---

## 6. Official sponsor lists

**Sponsor lists** page → **Download latest now** for each list:

- UK Register of licensed sponsors (gov.uk)
- USCIS H-1B Employer Data Hub
- Netherlands IND public register of recognised sponsors
- Canada positive LMIA employers (open.canada.ca)

The worker refreshes them weekly. If a download fails (government sites change), download the file from the official link and use **Import file**.

---

## 7. Tests

```powershell
npm test
```

Runs 129 automated tests (including the apply engine against local mock employer forms – nothing real is ever submitted) on a separate test database (`prisma/test.db`). With the app running, you can also run an end-to-end smoke test that signs in with the demo account and opens every page:

```powershell
npm run test:smoke
```

---

## 8. Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app + worker on port 3100 |
| `npm run web` | Start only the website (no worker) |
| `npm run worker` | Start only the background worker |
| `npm run build` then `npm start` | Faster production mode |
| `npm run seed` | ⚠ Re-creates the sample account, profiles and jobs (used for testing – don't run it on your real data) |
| `npm run db:reset` | ⚠ Wipes the local database (all your data) and loads sample data |
| `npm run icons` | Regenerate favicon/PWA/extension icons after changing `public/brand/icon.svg` |
| `npx prisma studio` | Browse the database in your browser |

---

## 9. Troubleshooting

**"Port 3100 is already in use"** – Upvance is probably already running in another window. Otherwise find what uses the port:

```powershell
Get-NetTCPConnection -LocalPort 3100 | Select-Object OwningProcess
```

or change `PORT` in `.env` (and the extension's App URL).

**AI is slow or says "overloaded"** – the free Gemini tier is sometimes busy. Upvance automatically switches to the lighter Gemini model and then to Groq. To make the lighter model the default, set `GEMINI_MODEL=gemini-flash-lite-latest` in `.env`.

**"Background worker isn't running" on the dashboard** – start it with `npm run dev` (or `npm run worker` in a second window).

---

## 10. Install as an app (PWA)

In Chrome or Edge, open http://localhost:3100 and click the **Install** icon in the address bar. On a phone on the same Wi-Fi, open `http://<your-PC's-IP>:3100` (shown in the terminal as "Network"). Note: phones only offer "install" for HTTPS sites, so use the browser normally there.

---

## 11. Rename the app / change colours

Edit `src/config/brand.ts` (name, tagline, colours). Replace the SVGs in `public/brand/`, then run `npm run icons`.

## 12. Switch to PostgreSQL later

In `prisma/schema.prisma` change `provider = "sqlite"` to `"postgresql"`, set `DATABASE_URL` in `.env` to your PostgreSQL connection string, then run `npx prisma db push`.

---

## Project structure

```
src/
  app/            pages (Next.js App Router), server actions, API routes
  components/     UI (shadcn-style components in components/ui)
  config/brand.ts name, tagline, colours
  lib/
    ai/           provider-agnostic AI layer (Gemini, Groq, OpenRouter, Anthropic, none)
    analysis/     rule-based + AI job analysis
    matching/     eligibility rules, weighted scoring
    resume/       PDF parsing, truthful tailoring + fabrication guard, PDF/DOCX export
    writing/      cover letters, screening answers
    sources/      job APIs (Greenhouse, Lever, Ashby, Remotive, Remote OK, Arbeitnow, Adzuna, URLs)
    sponsors/     official sponsor list importers
    auto/         auto mode pipeline + scheduler
prisma/           database schema + seed
scripts/          start (fixed port), worker, setup, icons, smoke test
extension/        Chrome extension (Manifest V3)
tests/            automated tests
```

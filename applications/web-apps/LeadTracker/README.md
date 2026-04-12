# Midas Lead Tracker — Local LinkedIn Pull Setup

This folder now owns the LinkedIn scraping flow for LeadTracker.

## What lives here

- `index.html`
- `schema.sql`
- `.env.example`
- `requirements-linkedin.txt`
- `scripts/linkedin_scraper.py`
- `scripts/run_linkedin_pull.ps1`
- `scripts/register_linkedin_task.ps1`
- `Run LinkedIn Pull.bat`
- `Bootstrap LinkedIn Session.bat`

## One-time setup

1. Copy `.env.example` to `.env.local`
2. Fill in:
   - `LINKEDIN_EMAIL`
   - `LINKEDIN_PASSWORD`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Create the virtual environment:

```powershell
py -3 -m venv .venv
```

## First session bootstrap

Double-click `Bootstrap LinkedIn Session.bat`

or run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_linkedin_pull.ps1 -Bootstrap -Visible
```

## Open the LeadTracker app

Do not open `index.html` by double-clicking it. Firebase email/password sign-in needs the app to run from a web server.

Double-click `Launch LeadTracker.bat` to start a local server and open the app in your browser.
Wait for the browser tab to open automatically before logging in.

If you are using the GitHub Pages site at `https://midastechinc.github.io/Leads/`, make sure `midastechinc.github.io` is listed in Firebase Authentication > Settings > Authorized domains.

## Manual pull

Double-click `Run LinkedIn Pull.bat`

or run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_linkedin_pull.ps1
```

## Schedule it daily

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register_linkedin_task.ps1 -DailyAt 08:00
```

This creates a Windows Scheduled Task named `MidasTech LinkedIn Pull`.

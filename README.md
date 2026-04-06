# Midas Tech Apps Dashboard

This repository is the master inventory for the `My Application` workspace. The dashboard surfaces each app with the right action type for its category:

- Web apps launch.
- Desktop apps expose download and local-start links.
- Mobile apps should expose APK downloads.
- Scripts expose local run and GitHub download links.
- Workflows expose downloadable export packages.

## Folder Rules

Every tracked app should live under its own folder inside one of these category roots:

- `applications/web-apps`
- `applications/desktop-apps`
- `applications/mobile-apps`
- `applications/scripts`
- `applications/workflows`

Shared utility folders that are not real app cards can stay beside them, but the audit will flag any top-level folder that is not represented in the dashboard data.

## Dashboard Data

The dashboard reads from `data/apps.json`. The browser-friendly fallback copy in `data/apps-data.js` is generated from the JSON file so the dashboard also works when opened directly from disk.

Each app entry now carries:

- `folderPath`
- `manual`
- typed action links for launch, download, local start, and GitHub

## Standard Workflow

1. Create or move the app into its own folder under `applications/...`.
2. Add or update the app entry in `data/apps.json`.
3. Run `tools/sync-dashboard-data.ps1`.
4. Run `tools/audit-applications.ps1`.
5. Commit the updated app folder plus dashboard data.

## Helper Scripts

- `tools/register-dashboard-app.ps1`
  Creates a folder if needed, scaffolds a basic `README.md`, adds a dashboard entry, and regenerates `data/apps-data.js`.

- `tools/new-mobile-app.ps1`
  Copies the shared Expo template into a new mobile app folder and reminds you to create the dedicated GitHub repo.

- `tools/sync-dashboard-data.ps1`
  Normalizes `data/apps.json` and rebuilds `data/apps-data.js`.

- `tools/audit-applications.ps1`
  Checks the dashboard inventory against real folders and writes a markdown audit report under `reports/`.

## Deployment

The dashboard is hosted on GitHub Pages at `https://midastechinc.github.io/Apps/`.

After changing the app catalog:

1. Run `tools/sync-dashboard-data.ps1`
2. Commit the folder and data updates
3. Push to `main`

## Current Cleanup Direction

The workspace is being normalized toward:

- one app per folder
- one dashboard card per app
- GitHub links on every card
- short how-to guidance on every card

Anything that still points to the shared `Apps` repo instead of a dedicated repository will show up as a warning in the audit report.

# Mobile Apps Workspace

This folder is the home for all Midas Tech mobile applications.

## Standard

- One app per folder
- One GitHub repo per app
- One dashboard card per app
- Android-first release flow to GitHub Releases
- APK link required before the app is considered launch-ready

## Recommended Stack

Use `React Native + Expo` for most new business apps unless a project clearly needs fully custom native Android or iOS work.

Why this is the default:

- Fastest path to shipping Android apps
- Easier team onboarding
- Good support for camera, files, notifications, auth, and offline storage
- Clean path to later add iOS builds if needed

## Folder Rules

Each real mobile app should follow this pattern:

```text
applications/mobile-apps/<app-name>/
  README.md
  .env.example
  package.json
  app.json
  App.tsx
  src/
  docs/
```

Support folders that are not dashboard apps should start with `_`, for example:

- `_template-expo-app`

## New App Workflow

1. Create the app folder with `tools/new-mobile-app.ps1`
2. Review and update the generated `README.md`
3. Create the GitHub repo for the app
4. Add the dashboard entry with APK and GitHub links
5. Build and upload the APK to GitHub Releases
6. Run the dashboard sync and audit scripts

## Reminder

Every real mobile app still needs its own GitHub repo.
If a new mobile app exists locally without a repo, it is not considered complete.

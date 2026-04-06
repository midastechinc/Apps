# Expo Mobile App Template

Use this folder as the starting point for each new Midas Tech mobile app.

## What this template gives you

- Expo + React Native starter app
- TypeScript setup
- Shared theme file
- Environment variable example
- Release checklist

## Before you start building

1. Copy this folder into `applications/mobile-apps/<your-app-name>`
2. Rename the app in `package.json` and `app.json`
3. Update `README.md` for the real app
4. Create the GitHub repo for the app
5. Add the app to the dashboard with a GitHub link and future APK link

## Local development

```powershell
npm install
npm run start
```

Then choose:

- `a` for Android emulator
- Expo Go on a physical Android phone
- web preview for fast UI checks

## Release target

The standard delivery target is:

- GitHub repository for source
- GitHub Release for APK files
- Dashboard card linked to the latest APK

## Repo reminder

Do not leave a real app only in this monorepo folder.
Create its dedicated GitHub repo before the project becomes active.

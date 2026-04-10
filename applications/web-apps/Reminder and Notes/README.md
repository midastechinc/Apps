# M365 Reminder and Notes Dashboard

## Purpose
This application is a one-screen Microsoft 365 dashboard that brings together:
- OneNote notes
- Microsoft To Do tasks
- Microsoft 365 calendar reminders and events
- Outlook flagged email

## What Is Working Now
- One-screen responsive dashboard for desktop and mobile
- Shared search across all four Microsoft 365 sections
- Admin section for Microsoft Graph settings
- Local browser storage for tenant-specific Graph settings
- Microsoft sign-in flow using MSAL Browser
- Live Microsoft Graph reads for OneNote, To Do, Calendar, and flagged mail
- Sample fallback data when Microsoft sign-in is not configured yet

## Admin Section
The Admin section is now the place where you enter:
- Client ID
- Tenant mode
- Specific tenant ID when needed
- Redirect URI
- Graph scopes

This makes it easier to reuse the same dashboard across different Microsoft 365 tenants without editing app files each time.

## Recommended Microsoft Graph Delegated Permissions
- `User.Read`
- `Notes.Read`
- `Tasks.Read`
- `Calendars.Read`
- `Mail.Read`

## Files
- `index.html` - dashboard layout, auth controls, and admin form
- `styles.css` - one-screen responsive UI
- `app.js` - admin settings, MSAL auth flow, Graph fetches, and rendering
- `m365-config.js` - optional default values for the admin form
- `blank.html` - popup redirect target for Microsoft sign-in

## Suggested Usage
1. Open the dashboard on a local or hosted web server.
2. Enter the Microsoft Graph settings in the Admin section.
3. Save the settings.
4. Connect Microsoft 365 for the tenant you want to use.
5. Refresh when you want to reload live data.

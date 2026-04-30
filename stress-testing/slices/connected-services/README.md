# Slice — connected-services

## Purpose

Stress external-service-backed product flows: Gmail and Calendar.

## In scope

- `server/src/routes/gmail.js`
- `server/src/routes/calendar.js`
- `server/src/services/gmail.js`
- `server/src/services/calendar.js`
- `server/src/models/GmailAuth.js`
- account and connected-service client surfaces including `client/src/components/GmailInbox.jsx`, `CalendarView.jsx`, `SettingsAccountsSection.jsx`, and `client/src/lib/gmail/*`

## Out of scope

- workspace assistant logic built on top of these services
- shipment tracking, which is covered by `shipment-domain`
- provider-backed AI response generation unrelated to Google or shipment calls

## Entry points

- `/api/gmail/*`
- `/api/calendar/*`

## External dependencies

- Google OAuth and Gmail API
- Google Calendar API
- MongoDB auth/account records

## Known shared surfaces

- workspace assistant
- user preferences and default account selection
- runtime health and startup environment

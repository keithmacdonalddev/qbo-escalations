# Slice — image-intake-and-parse

## Purpose

Stress screenshot upload, parse orchestration, image parser history, archival, and provider fallback behavior.

## In scope

- `server/src/routes/image-parser.js`
- `server/src/routes/chat/parse.js`
- parse and screenshot sections inside `server/src/routes/escalations.js`
- `server/src/routes/chat/image-archive.js`
- `server/src/services/image-parser.js`
- `server/src/services/parse-orchestrator.js`
- `server/src/services/claude.js`
- `server/src/services/codex.js`
- `server/src/services/lm-studio.js`
- `server/src/services/sdk-image-parse.js`
- `server/src/lib/chat-image.js`
- `server/src/lib/image-archive.js`
- `server/src/lib/image-parser-archive.js`
- `server/src/models/ImageParseResult.js`
- `server/src/models/ImageParserApiKey.js`
- image-parser client surfaces such as `client/src/components/ImageParserPanel.jsx`, `ParserGallery.jsx`, `WebcamCapture.jsx`, and `client/src/components/chat/ImageParserPopup.jsx`

## Out of scope

- main chat answer generation after parsing is complete
- workspace assistant logic
- room orchestration
- Gmail and Calendar correctness

## Entry points

- `/api/image-parser/*`
- `/api/chat/parse-escalation`
- `/api/chat/image-archive/*`
- `/api/escalations/parse`
- `/api/escalations/:id/screenshots`

## External dependencies

- local uploads and archive files
- `sharp`
- provider APIs and CLIs used for parse/transcription
- MongoDB image parser collections and linked escalation/conversation records

## Known shared surfaces

- linked escalation records
- linked conversation records
- traces and usage logs
- provider health and runtime configuration

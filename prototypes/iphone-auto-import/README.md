# iPhone Auto-Import Prototype

Standalone feature prototype (HTML/CSS/JS only), isolated from production app code paths.

## Files

- `index.html`
- `styles.css`
- `script.js`

## How To Run

1. Open `index.html` directly in a Chromium browser (Edge/Chrome), or serve this folder with any static server.
2. Go to **Settings**.
3. Click **Connect Folder** and choose your test folder:
   `C:\Users\NewAdmin\Pictures\Screenshots`
4. Click **Save Settings**.
5. Click **Import Latest Now**.
6. Go to **Chat**.
7. Click **Open Imports** to open the right sidebar popup.
8. Scroll imported screenshots vertically and click **Add To Chat** on any item.
9. Send the chat message to see the attachment-driven response simulation.

## Notes

- Uses browser APIs and localStorage only.
- No calls to the React/Express application.
- Folder access is session-scoped unless browser persists permission.

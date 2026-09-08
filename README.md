# gg.deals Extension

Browser extension for syncing game libraries (Steam and Epic) with gg.deals.

## Tech Stack

- TypeScript
- Vite
- CRXJS Vite plugin
- Manifest V3

## What This Extension Does

- Injects a content script on gg.deals settings/collection pages.
- Adds sync actions for Steam and Epic providers.
- Uses a background service worker to:
  - fetch Steam user data,
  - fetch Epic auth token and library data,
  - POST import payloads to gg.deals endpoints.

## Project Structure

- src/manifest.json - extension manifest (MV3)
- src/background.ts - background service worker message handlers
- src/content-settings.ts - content script for gg.deals pages
- src/integrations/steam/index.ts - Steam sync flow
- src/integrations/epic/index.ts - Epic sync flow
- src/options.html - extension options page
- index.html + src/main.ts - popup entry
- vite.config.ts - Vite + CRX build configuration

## Prerequisites

- Node.js 18+ (recommended: latest LTS)
- npm 9+

## Install Dependencies

```bash
npm install
```

## Build the Extension (Step by Step)

The content scripts and extension pages are bundled directly from their source files by Vite and CRXJS.

1. Run TypeScript type-checking:

```bash
npx tsc
```

2. Build the full extension bundle:

```bash
npx vite build
```

3. Or run all steps at once for Chrome (recommended):

```bash
npm run build
```

To create production builds for both Chrome and Firefox:

```bash
npm run build -- --debug=false --target=all
```

The `--debug=false` flag is optional. The shorter equivalent is:

```bash
npm run build:all
```

Production builds are generated in `dist/gg.deals_chrome/` and
`dist/gg.deals_firefox/`.

### Building against another site

`--site` points a build at a different installation. It sets both the domain used
in `manifest.json` and the site URLs used in the code, so the two can never drift
apart:

```bash
npm run build:all -- --site=example.com
```

It also accepts an installation path, for setups served from a subdirectory:

```bash
npm run build:all -- --site=example.com/subdir/
```

Output directories follow the `dist/<site>_<target>/` pattern, so the builds above
generate `dist/example.com_chrome/` and `dist/example.com_subdir_chrome/`
respectively (plus the matching `_firefox` directories).

To create debug builds for both browsers without changing the default GG.deals site:

```bash
npm run build:all -- --debug=true
```

Debug builds add a `debug_` prefix, so these are generated in
`dist/debug_gg.deals_chrome/` and `dist/debug_gg.deals_firefox/`.

## Development Mode

Run the Vite dev server with the stylesheet watchers:

```bash
npm run dev
```

Vite and CRXJS compile `src/content-settings.ts` directly; no generated content script is written to the repository root.

## Load the Extension in Chrome (Unpacked)

1. Build the project first:

```bash
npm run build:chrome
```

2. Open Chrome and go to chrome://extensions.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the `dist/gg.deals_chrome/` folder.

## Load the Extension in Firefox (Temporary Add-on)

1. Build the project first:

```bash
npm run build:firefox
```

2. Open Firefox and go to about:debugging.
3. Click This Firefox.
4. Click Load Temporary Add-on.
5. Select `dist/gg.deals_firefox/manifest.json`.

## Permissions and Hosts

The extension requests permissions and host access defined in src/manifest.json, including:

- gg.deals domains
- Steam Store
- Epic account/library APIs

## Server Messages and Rate Limiting

Every GG.deals API response handled by the extension may include a top-level
`messages` array. Generic popup notices use this shape:

```json
{
  "code": "custom:maintenance",
  "type": "warning",
  "ttl": 3600,
  "title": "Maintenance",
  "message": "Some features are temporarily unavailable.",
  "constraint": "<1.2.3"
}
```

- `custom:<id>` identifies the message. Only the last message with an ID is
  active at a time.
- `type` may be `info`, `warning`, `success`, or `error`; omitted means `info`.
- `ttl` is measured from receipt and continues while the popup is closed.
- `constraint` supports `<`, `<=`, `>`, `>=`, and `=` comparisons. Multiple
  space-separated comparisons are combined with AND, for example
  `>=1.1.0 <1.2.3`.
- Dismissal is persistent. An identical response does not restart the TTL or
  show a dismissed message again; changed content or metadata replaces it.
- Message HTML is sanitised. Only links with fragment, `http`, or `https`
  targets remain clickable.
- A server-supplied message shows a small yellow dot on the action icon. Opening
  the popup acknowledges and clears this badge without dismissing the message.

An HTTP 429 response creates an internal warning with a red `!` action badge.
Its TTL comes from `Retry-After`, then `X-RateLimit-Reset`, and otherwise defaults
to 60 seconds. The red rate-limit badge takes priority over a yellow server-message
badge. 

## CSS Classes Added by the Extension

The extension adds the following classes dynamically.

### Settings Container State

- extension-installed
  - Added on #user-extension-settings when the content script detects the /settings page.
  - Indicates that the extension is active on the settings popup/container.

### Provider Status Click Target

- syncing
  - FIX NAMING:
  - Added on .extension-sync-popup-provider-status[data-connect-url] while provider sync is in progress.
  - Removed after success/failure handling.

### Steam/Epic Account Info Elements (created by extension)

- extension-account-info
  - Base class for account info line inserted by extension.

- extension-steam-account-info
  - Added when Steam account info element is created.

- extension-epic-account-info
  - Added when Epic account info element is created.

### Steam/Epic Sync Status Elements (created by extension)

- extension-sync-status
  - Base class for sync status element inserted by extension.

- extension-steam-sync-status
  - Added when Steam sync status element is created.

- extension-epic-sync-status
  - Added when Epic sync status element is created.

### Variant Classes for Sync State

These classes are switched on each sync status update (info/success/error):

- extension-sync-host--info
- extension-sync-host--success
- extension-sync-host--error
  - Applied to the host sync button/container element.

- extension-sync-status--info
- extension-sync-status--success
- extension-sync-status--error
  - Applied to the inserted sync status element.
  - Previous variant classes are removed before the current one is added.

## Notes

- Before production release, review vite config and add correct manifest.json

## License

The source code in this repository is licensed under the Mozilla Public License
2.0. See [LICENSE](LICENSE) for the full license text.

Corresponding source code for distributed builds is available from the
[GG.deals browser extension repository](https://github.com/ggdeals/browser-extension).

All product names, logos, brands, trademarks, service marks, and registered
trademarks are the property of their respective owners. Their inclusion in this
project does not imply affiliation, sponsorship, or endorsement. The MPL 2.0
does not grant rights to any trademarks, service marks, or logos.

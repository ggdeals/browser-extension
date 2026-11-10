# GG.deals Extension

Browser extension that shows [GG.deals](https://gg.deals/) prices while you shop and keeps your game
libraries in sync with your GG.deals account. Chrome and Firefox, Manifest V3.

## What It Does

- **Price bar.** On a supported store or game-info page, a bar shows the current
  GG.deals retail and keyshop prices for that game and flags historical lows.
  Available subscriptions link to GG.deals, with the cheapest on the bar and
  an alphabetical dropdown when there are multiple subscriptions.
  66 site integrations ship with the extension; the bar only appears on a page
  one of them recognises, and you can exclude any domain from the Appearance
  tab.
- **Library sync.** Link an account on the GG.deals extension settings page and
  import from Steam (library, wishlist, ignore list), Epic (library),
  PlayStation (collection, wishlist), Nintendo (collection, wishlist), or Xbox
  (collection).
- **Popup.** The toolbar icon opens the current page's deals, your sync and
  account options, and the bar's appearance settings.

The extension asks for `storage` and access to all `https://` sites. The broad
host access is what lets the price bar recognise product pages across the stores
listed in `src/manifest.json`.

Xbox sync works differently from the other providers. Instead of reusing the
store's browser session, it signs in to Microsoft once (in a tab opened after the
user confirms) and keeps the resulting token in the extension's own storage. The
token is never sent to GG.deals or page scripts and is deleted on disconnect.
Every collection sync checks the current Xbox link with GG.deals and requests
`https://www.xbox.com/en-us/home_alt/dark/home` with fresh Xbox.com cookies. Its
`user.isSignedIn` and `user.userInfo.xuid` identify the active session; the viewed
profile URL and the anonymous `play.xbox.com` SSR page are not used as identity.
A matching signed-in session reuses the saved grant without another prompt.
Signing out stops sync before collection requests, even if the OAuth grant is
still valid. A readable session with a different XUID uses the shared account
confirmation and Microsoft authorization flow.

A missing GG.deals link clears the saved token, and a token for a different XUID
than the current link also requires fresh authorization. If the Xbox.com session
cannot be read while the grant is usable, the extension keeps the grant and asks
the user to open Xbox.com before retrying. Reauthorizing Microsoft would not fix
the unreadable session and could repeat on every click. The extension does not
import with an unverified cached account. After a fresh Microsoft sign-in needed
for a missing or invalid grant, that sync may proceed without another Xbox.com
check. Xbox sync is unavailable in private
browsing, so private tabs cannot use the normal profile's token.

Concurrent sign-ins share one Microsoft tab and device grant. Each sync has its
own subscription, so canceling one does not cancel the others. The shared result
survives a background worker restart. Disconnect cancels all subscriptions and
deletes the token; starting a connection clears saved tokens while preserving
an unfinished sign-in already in progress in another tab.

If Microsoft rejects the extension's Origin during a token exchange, the
background retries that request once with an empty Origin header using its
existing host access. Browsers that do not support overriding the header report
the transport error and retain the grant. This requires no technical tabs,
additional permissions or backend token proxy.

## Build

To build this project, you'll need Node.js `^20.19.0 || >=22.12.0` (Vite 7's
requirement).

```bash
npm install
npm run build:all    # builds the extension for Chrome and Firefox in one go
```

## Tests

After installing dependencies, run:

```bash
npm test
```

This runs `scripts/test-*.mjs` with Node's built-in test runner. No
extension build or browser session is required. The script transpiles the
actual TypeScript integration modules and shared account-sync code in memory,
then runs them in `node:vm` contexts with mocked browser APIs, DOM elements,
account confirmations and server responses.

The tests cover Steam, Epic, PlayStation and Nintendo: account confirmation
before library requests when connecting or switching accounts, cancellation,
account mismatch recovery, import payloads, and selected button and settings
state transitions. Epic wishlist tests also cover store session refresh, waiting
for authenticated data, refresh timeouts and temporary tab cleanup.
They make no network requests and require no real accounts.
Xbox tests additionally cover device authorization, token rotation and isolation,
worker restarts, concurrent background requests, pagination and complete imports.
Other providers' background API pagination and visual browser behaviour need separate checks.
Type checking is performed by `npm run build:all`, separately from these tests.

## Load the Extension in Chrome (Unpacked)

1. Build the project first:

   ```bash
   npm run build:all
   ```

2. Open Chrome and go to `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the `dist/gg.deals_chrome/` folder.

## Load the Extension in Firefox (Temporary Add-on)

Requires Firefox 140 or newer.

1. Build the project first:

   ```bash
   npm run build:all
   ```

2. Open Firefox and go to `about:debugging`.
3. Click This Firefox.
4. Click Load Temporary Add-on.
5. Select `dist/gg.deals_firefox/manifest.json`.

## Making a Change

`npm run build:all` does everything: it compiles the Less stylesheets,
type-checks, bundles with Vite and CRXJS, then flattens the output and patches
the manifest for each browser. Rebuild and reload the extension to see a change.

Where things live:

| Path | What it is |
| --- | --- |
| `src/manifest.json` | The manifest, shared by both targets, and the list of supported sites |
| `src/bar/` | The price bar - `integrations/` holds one page rule per site |
| `src/integrations/` | Steam, Epic, PlayStation, Nintendo, and Xbox sync flows |
| `src/settings/` | The popup UI (Preact) |
| `src/background.ts` | Background script - all provider API calls |
| `src/content-settings.ts` | Content script for GG.deals pages |
| `src/utils/` | Shared settings, sync, and i18n helpers |
| `public/_locales/` | Translations, 14 locales, default `en` |
| `scripts/build.mjs` | The build itself |
| `scripts/test-sync-order.mjs` | Sync flow regression tests, run with `npm test` |
| `scripts/test-epic-wishlist.mjs` | Epic store session recovery regression tests |
| `scripts/test-xbox-sync.mjs` | Xbox authorization, refresh, pagination, and import regression tests |
| `scripts/test-settings-popup.mjs` | Settings popup refresh and page bridge regression tests |

Adding a site to the price bar means writing a page rule under
`src/bar/integrations/`, registering it in that directory's `index.ts`, and
adding the site's match patterns to `src/manifest.json`.

## Build Options

Flags go after `--`, for example `npm run build:all -- --debug`.

| Flag | What it does |
| --- | --- |
| `--target=<chrome\|firefox\|all>` | Which browsers to build. |
| `--debug` | Keeps `console` calls and the bar's request-debugging panel, and writes to a `debug_`-prefixed directory. |
| `--site=<domain[/path]>` | Builds against another installation, rewriting both the manifest domain and the site URLs in the code so the two can't disagree. Accepts a subdirectory, e.g. `example.com/subdir/`. |
| `--version=<x.y.z>` | Sets the version instead of deriving one. |
| `--version-base=<x.y.z>` | Sets the release base offline, skipping the git tag lookup. |

Output directories follow `dist/<site>_<target>/`, so `--site=example.com`
produces `dist/example.com_chrome/`. Versions are derived from the latest
released tag plus a counter, so dev builds always sort above the released
extension.

Builds for a custom `--site` send credentials with guest settings requests so
they can use HTTP Basic Auth on development servers. This also sends available
site cookies. Builds for `gg.deals` omit credentials for these guest requests.

## License

The source code in this repository is licensed under the Mozilla Public License
2.0. See [LICENSE](LICENSE) for the full license text.

Corresponding source code for distributed builds is available from the
[GG.deals browser extension repository](https://github.com/ggdeals/browser-extension).

All product names, logos, brands, trademarks, service marks, and registered
trademarks are the property of their respective owners. Their inclusion in this
project does not imply affiliation, sponsorship, or endorsement. The MPL 2.0
does not grant rights to any trademarks, service marks, or logos.

# GG.deals Extension

Browser extension that shows [GG.deals](https://gg.deals/) prices while you shop and keeps your game
libraries in sync with your GG.deals account. Chrome and Firefox, Manifest V3.

## What It Does

- **Price bar.** On a supported store or game-info page, a bar shows the current
  GG.deals retail and keyshop prices for that game and flags historical lows.
  66 site integrations ship with the extension; the bar only appears on a page
  one of them recognises, and you can exclude any domain from the Appearance
  tab.
- **Library sync.** Link an account on the GG.deals extension settings page and
  import from Steam (library, wishlist, ignore list), Epic (library),
  PlayStation (collection, wishlist), or Nintendo (collection, wishlist).
- **Popup.** The toolbar icon opens the current page's deals, your sync and
  account options, and the bar's appearance settings.

The extension asks for `storage` and access to all `https://` sites. The broad
host access is what lets the price bar recognise product pages across the stores
listed in `src/manifest.json`.

## Build

To build this project, you'll need Node.js `^20.19.0 || >=22.12.0` (Vite 7's
requirement).

```bash
npm install
npm run build:all    # builds the extension for Chrome and Firefox in one go
```

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
| `src/integrations/` | Steam, Epic, and PlayStation sync flows |
| `src/settings/` | The popup UI (Preact) |
| `src/background.ts` | Background script - all provider API calls |
| `src/content-settings.ts` | Content script for GG.deals pages |
| `src/utils/` | Shared settings, sync, and i18n helpers |
| `public/_locales/` | Translations, 14 locales, default `en` |
| `scripts/build.mjs` | The build itself |

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

## License

The source code in this repository is licensed under the Mozilla Public License
2.0. See [LICENSE](LICENSE) for the full license text.

Corresponding source code for distributed builds is available from the
[GG.deals browser extension repository](https://github.com/ggdeals/browser-extension).

All product names, logos, brands, trademarks, service marks, and registered
trademarks are the property of their respective owners. Their inclusion in this
project does not imply affiliation, sponsorship, or endorsement. The MPL 2.0
does not grant rights to any trademarks, service marks, or logos.

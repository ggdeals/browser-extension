import {spawnSync} from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import process from 'node:process';

const ROOT_DIR = process.cwd();
const SRC_MANIFEST_PATH = join(ROOT_DIR, 'src/manifest.json');
const SRC_BAR_CSS_PATH = join(ROOT_DIR, 'src/bar/styles/bar.css');
const SRC_BAR_ASSETS_FONTS_DIR = join(ROOT_DIR, 'src/assets/fonts');
const SRC_BAR_TEMPLATE_PATH = join(ROOT_DIR, 'src/bar/index.html');
const SRC_ASSETS_DIR = join(ROOT_DIR, 'src/assets');
const DIST_DIR = join(ROOT_DIR, 'dist');
const BUILD_TARGETS = ['chrome', 'firefox'];
const TMP_DIR = join(ROOT_DIR, '.build-temp');
const TMP_MANIFEST_PATH = join(TMP_DIR, 'manifest.json');

const ICON_ASSET_FILES = [
  'gg-ext-icon-16.png',
  'gg-ext-icon-48.png',
  'gg-ext-icon-128.png',
  'gg-ext-icon-16_gray.png',
  'gg-ext-icon-48_gray.png',
  'gg-ext-icon-128_gray.png',
];

const DEFAULT_SITE = 'gg.deals';
const PACKAGE_JSON_PATH = join(ROOT_DIR, 'package.json');
// Chrome allows 1-4 dot-separated integers up to 65535 each and Firefox up to
// 9 digits each, so every version has to fit Chrome's limit.
const VERSION_PART_MAX = 65535;
// gg.deals gates features on the extension version, so a dev build cannot carry
// an invented number. It reuses the three leading parts of the highest released
// version and only moves the fourth one.
const REPO_URL = 'https://github.com/ggdeals/browser-extension.git';
const VERSION_BASE_PART_COUNT = 3;
// The fourth part counts whole hours since this epoch: rebuilds within the same
// hour keep the same version, and every later build sorts above the earlier
// ones. The counter reaches 65535 in July 2033 - move the epoch forward before
// then (the base version will have moved on long before, so nothing regresses).
const DEV_VERSION_EPOCH_MS = Date.UTC(2026, 0, 1);
const HOUR_MS = 60 * 60 * 1000;
const GIT_LOOKUP_TIMEOUT_MS = 10_000;
const DEBUG_ONLY_BLOCK_PATTERN = /\s*<!-- DEBUG_ONLY_START -->[\s\S]*?<!-- DEBUG_ONLY_END -->/g;
const FIREFOX_REQUIRED_DATA_COLLECTION_PERMISSIONS = [
  'authenticationInfo', // GG.deals API keys and Epic OAuth tokens
  'personallyIdentifyingInfo', // Account usernames and identifiers
  'browsingActivity', // Product page URLs sent to the GG.deals API
  'websiteContent', // Page titles and game libraries/wishlists
  'locationInfo', // Region used to localize deals and prices
];

function parseArgs(argv) {
  let site;
  let debug;
  let version;
  let versionBase;
  let target = 'firefox';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg.startsWith('--site=')) {
      site = arg.slice('--site='.length);
      continue;
    }

    if (arg.startsWith('--debug=')) {
      debug = arg.slice('--debug='.length);
      continue;
    }

    if (arg.startsWith('--version=')) {
      version = arg.slice('--version='.length);
      continue;
    }

    if (arg.startsWith('--version-base=')) {
      versionBase = arg.slice('--version-base='.length);
      continue;
    }

    if (arg.startsWith('--target=')) {
      target = arg.slice('--target='.length).toLowerCase();
      continue;
    }

    if (arg === '--debug') {
      const nextArg = argv[index + 1];
      if (nextArg && !nextArg.startsWith('--')) {
        debug = nextArg;
        index += 1;
      } else {
        debug = 'true';
      }
      continue;
    }

    if (arg === '--debug-true') {
      debug = 'true';
      continue;
    }

    if (arg === '--debug-false') {
      debug = 'false';
      continue;
    }

    // Unknown flags used to be ignored silently, which produced builds that
    // looked fine but pointed at the wrong site.
    if (arg.startsWith('--')) {
      throw new Error(
        `Unknown build flag "${arg}". Supported flags: --site=<domain[/path]>, `
        + '--target=<chrome|firefox|all>, --debug[=true|false], --version=<x.y.z>, '
        + '--version-base=<x.y.z>.',
      );
    }

    if (site === undefined) {
      site = arg;
    }
  }

  if (!debug && typeof process.env.npm_config_debug === 'string' && process.env.npm_config_debug.trim().length > 0) {
    debug = process.env.npm_config_debug;
  }

  if (!version && typeof process.env.EXT_VERSION === 'string' && process.env.EXT_VERSION.trim().length > 0) {
    version = process.env.EXT_VERSION;
  }

  if (!versionBase && typeof process.env.EXT_VERSION_BASE === 'string' && process.env.EXT_VERSION_BASE.trim().length > 0) {
    versionBase = process.env.EXT_VERSION_BASE;
  }

  if (![...BUILD_TARGETS, 'all'].includes(target)) {
    throw new Error(
        `"${target}" must be chrome, firefox or all.`,
    );
  }

  return {
    site: site?.trim() || undefined,
    debug: debug?.trim() || undefined,
    version: version?.trim() || undefined,
    versionBase: versionBase?.trim() || undefined,
    target: target,
  };
}

function normalizeDebugFlag(rawDebug) {
  if (!rawDebug) {
    return 'false';
  }

  return ['1', 'true', 'yes', 'on'].includes(rawDebug.toLowerCase()) ? 'true' : 'false';
}

function assertValidExtensionVersion(version, storeLabel) {
  const parts = version.split('.');
  const isValid = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/.test(version)
    && parts.every((part) => Number(part) <= VERSION_PART_MAX)
    && parts.some((part) => Number(part) !== 0);

  if (!isValid) {
    throw new Error(
      `Invalid extension version "${version}" for ${storeLabel}. Expected 1-4 dot-separated `
      + `integers, each between 0 and ${VERSION_PART_MAX}, without leading zeros, and not all zero.`,
    );
  }
}

function parseVersionParts(rawVersion) {
  const match = /^v?(\d+(?:\.\d+){0,3})$/.exec(String(rawVersion).trim());

  return match ? match[1].split('.').map(Number) : null;
}

function compareVersionParts(left, right) {
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function highestVersionParts(rawVersions) {
  let highest = null;

  for (const rawVersion of rawVersions) {
    const parts = parseVersionParts(rawVersion);

    if (parts && (!highest || compareVersionParts(parts, highest) > 0)) {
      highest = parts;
    }
  }

  return highest;
}

function captureCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: 'utf-8',
    timeout: GIT_LOOKUP_TIMEOUT_MS,
    env: {
      ...process.env,
      // A missing or unreachable remote must fail instead of asking for
      // credentials in the middle of a build.
      GIT_TERMINAL_PROMPT: '0',
    },
  });

  return result.status === 0 && typeof result.stdout === 'string' ? result.stdout : null;
}

function listGitTags(args) {
  const output = captureCommand('git', args);

  if (output === null) {
    return [];
  }

  return output
    .split('\n')
    .map((line) => line.split('refs/tags/').pop().trim())
    .filter((tag) => tag.length > 0);
}

function normalizeVersionBase(parts) {
  return Array.from({ length: VERSION_BASE_PART_COUNT }, (_, index) => parts[index] ?? 0);
}

// The published tags are the source of truth for the released version; local
// tags and package.json only keep builds working without network access.
function resolveVersionBase(baseOverride) {
  if (baseOverride) {
    const parts = parseVersionParts(baseOverride);

    if (!parts) {
      throw new Error(
        `Invalid version base "${baseOverride}". Expected 1-4 dot-separated integers.`,
      );
    }

    return normalizeVersionBase(parts);
  }

  const releasedVersion = highestVersionParts(
    listGitTags(['ls-remote', '--tags', '--refs', REPO_URL]),
  );

  if (releasedVersion) {
    return normalizeVersionBase(releasedVersion);
  }

  const fallbackVersion = highestVersionParts(listGitTags(['tag', '--list']))
    ?? parseVersionParts(JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')).version ?? '');

  if (!fallbackVersion) {
    throw new Error(
      `Could not read the released version from ${REPO_URL}. Pass `
      + '--version-base=<x.y.z> (or set EXT_VERSION_BASE) to build without network access.',
    );
  }

  console.warn(
    `Could not read the tags of ${REPO_URL}, falling back to the local version `
    + `${fallbackVersion.join('.')}. The dev build may be older than the released extension.`,
  );

  return normalizeVersionBase(fallbackVersion);
}

function buildDevVersion(now, versionBase) {
  const hoursSinceEpoch = Math.floor((now.getTime() - DEV_VERSION_EPOCH_MS) / HOUR_MS);

  if (hoursSinceEpoch < 0 || hoursSinceEpoch > VERSION_PART_MAX) {
    throw new Error(
      `Cannot build a dev version for ${now.toISOString()}: ${hoursSinceEpoch} hours since the `
      + `dev version epoch do not fit in a version part (0-${VERSION_PART_MAX}). Move `
      + 'DEV_VERSION_EPOCH_MS in scripts/build.mjs forward.',
    );
  }

  return [...versionBase, hoursSinceEpoch].join('.');
}

function resolveVersion(versionOverride, versionBaseOverride) {
  const version = versionOverride
    ?? buildDevVersion(new Date(), resolveVersionBase(versionBaseOverride));

  // Chrome and Firefox share the version, so it has to satisfy the stricter of
  // the two stores.
  assertValidExtensionVersion(version, 'the extension stores');

  return version;
}

function applyVersion(manifestPath, version) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  manifest.version = version;

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

// A single --site value drives every domain the build depends on. It accepts a
// bare domain ("example.com") or a domain with an installation path
// ("example.com/branch"), with or without a scheme.
//
//   domain -> replaces the domain in manifest.json (host permissions, matches)
//   base   -> replaces the domain and path of the site URLs used in the code
function resolveSite(rawSite) {
  const value = rawSite ?? DEFAULT_SITE;

  let url;

  try {
    url = new URL(value.includes('://') ? value : `https://${value}`);
  } catch {
    throw new Error(
      `Invalid --site value "${value}". Expected a domain with an optional path, `
      + 'for example example.com or example.com/branch.',
    );
  }

  if (!url.hostname) {
    throw new Error(`Invalid --site value "${value}". A domain is required.`);
  }

  const domain = url.hostname.toLowerCase();
  const basePath = url.pathname.replace(/\/+$/, '');
  const base = `${domain}${basePath}`;

  return {
    domain,
    base,
    isDefault: base === DEFAULT_SITE,
    // Used as the dist directory name, so the path has to survive as well:
    // example.com/branch -> example.com_branch
    name: base.replace(/[^a-z0-9_.-]+/g, '_'),
  };
}

// Output directories are flat and self-describing: dist/<domain>_<target>,
// prefixed with debug_ for debug builds. For example dist/gg.deals_chrome.
function resolveOutputDirs(targets, debugEnabled, site) {
  const prefix = debugEnabled ? 'debug_' : '';

  return Object.fromEntries(
    targets.map((buildTarget) => [
      buildTarget,
      join(DIST_DIR, `${prefix}${site.name}_${buildTarget}`),
    ]),
  );
}

function runCommand(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      ...env,
    },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureParentDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function copyToDist(outDir, debugEnabled) {
  const cssDest = join(outDir, 'src/bar/styles/bar.css');
  const templateDest = join(outDir, 'src/bar/index.html');
  const assetsDestDir = join(outDir, 'assets');
  const barAssetFontsDestDir = join(assetsDestDir, 'fonts');

  ensureParentDir(cssDest);
  ensureParentDir(templateDest);
  mkdirSync(assetsDestDir, { recursive: true });
  mkdirSync(barAssetFontsDestDir, { recursive: true });

  cpSync(SRC_BAR_CSS_PATH, cssDest);
  cpSync(SRC_BAR_ASSETS_FONTS_DIR, barAssetFontsDestDir, {
    recursive: true,
  });

  const template = readFileSync(SRC_BAR_TEMPLATE_PATH, 'utf-8');
  const outputTemplate = debugEnabled
    ? template.replaceAll('<!-- DEBUG_ONLY_START -->', '').replaceAll('<!-- DEBUG_ONLY_END -->', '')
    : template.replace(DEBUG_ONLY_BLOCK_PATTERN, '');
  writeFileSync(templateDest, outputTemplate, 'utf-8');

  for (const iconFile of ICON_ASSET_FILES) {
    const srcPath = join(SRC_ASSETS_DIR, iconFile);
    const destPath = join(assetsDestDir, iconFile);

    if (!existsSync(srcPath)) {
      continue;
    }

    cpSync(srcPath, destPath);
  }

  // CRXJS copies manifest assets using their source paths. They are duplicated
  // above into the single public assets directory used by the final bundle.
  rmSync(join(outDir, 'src/assets'), { recursive: true, force: true });
}

function normalizeOutputAssetPaths(outputDir) {
  const targetExtensions = new Set(['.js', '.html', '.css', '.json']);

  for (const filePath of walkFiles(outputDir)) {
    if (![...targetExtensions].some((ext) => filePath.endsWith(ext))) {
      continue;
    }

    const content = readFileSync(filePath, 'utf-8');
    const updatedContent = content.replaceAll('src/assets/', 'assets/');

    if (updatedContent !== content) {
      writeFileSync(filePath, updatedContent, 'utf-8');
    }
  }
}

function normalizeGeneratedFileNames(outputDir) {
  const renamedFiles = [];

  for (const filePath of walkFiles(outputDir)) {
    const normalizedPath = filePath.replace(/\.[cm]?[jt]s-loader\.js$/, '-loader.js');

    if (normalizedPath === filePath) {
      continue;
    }

    renameSync(filePath, normalizedPath);
    renamedFiles.push([
      relative(outputDir, filePath).replaceAll('\\', '/'),
      relative(outputDir, normalizedPath).replaceAll('\\', '/'),
    ]);
  }

  if (renamedFiles.length === 0) {
    return;
  }

  for (const filePath of walkFiles(outputDir)) {
    if (!['.js', '.html', '.json'].some((ext) => filePath.endsWith(ext))) {
      continue;
    }

    const content = readFileSync(filePath, 'utf-8');
    let updatedContent = content;

    for (const [oldName, newName] of renamedFiles) {
      updatedContent = updatedContent.replaceAll(oldName, newName);
    }

    if (updatedContent !== content) {
      writeFileSync(filePath, updatedContent, 'utf-8');
    }
  }
}

function replaceManifestDomain(manifestDomain, outputDir) {
  const manifestOutputPath = join(outputDir, 'manifest.json');
  const manifestOutput = readFileSync(manifestOutputPath, 'utf-8');
  const updated = manifestOutput.replace(/\bgg\.deals\b/g, manifestDomain);
  writeFileSync(manifestOutputPath, updated, 'utf-8');
}

function replaceDomainInHttpUrls(content, fromDomain, toDomain) {
  const escapedFrom = fromDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(https?:\\/\\/[^"'\\s]*?)${escapedFrom}`, 'g');
  return content.replace(pattern, `$1${toDomain}`);
}

function extractConstantsDomains() {
  const barConstantsPath = join(ROOT_DIR, 'src/bar/js/constants.ts');
  const settingsConstantsPath = join(ROOT_DIR, 'src/settings/constants.ts');
  const sourceFiles = [barConstantsPath, settingsConstantsPath];

  // Matches any exported string constant whose value is an http(s) URL.
  const urlConstantPattern = /export\s+const\s+\w+\s*:\s*string\s*=\s*['"](https?:\/\/[^'"]+)['"]/g;
  const domains = new Set();

  for (const filePath of sourceFiles) {
    const source = readFileSync(filePath, 'utf-8');
    let match;
    while ((match = urlConstantPattern.exec(source)) !== null) {
      try {
        const parsedUrl = new URL(match[1]);
        domains.add(parsedUrl.hostname);
      } catch {
        // Ignore malformed URLs and keep processing remaining constants.
      }
    }
  }

  return Array.from(domains);
}

function walkFiles(dirPath) {
  if (!existsSync(dirPath)) {
    return [];
  }

  const entries = readdirSync(dirPath);
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function replaceSiteUrls(siteBase, outputDir, sourceDomains) {
  const targetExtensions = new Set(['.js', '.html', '.css', '.json']);
  const files = walkFiles(outputDir);

  for (const filePath of files) {
    if (![...targetExtensions].some((ext) => filePath.endsWith(ext))) {
      continue;
    }

    const content = readFileSync(filePath, 'utf-8');
    let updatedContent = content;

    for (const sourceDomain of sourceDomains) {
      updatedContent = replaceDomainInHttpUrls(updatedContent, sourceDomain, siteBase);
    }

    updatedContent = replaceDomainInHttpUrls(updatedContent, DEFAULT_SITE, siteBase);

    if (updatedContent !== content) {
      writeFileSync(filePath, updatedContent, 'utf-8');
    }
  }
}

function prepareCustomManifest(manifestDomain) {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });

  const manifestContent = readFileSync(SRC_MANIFEST_PATH, 'utf-8');
  const updatedManifest = manifestContent.replace(/\bgg\.deals\b/g, manifestDomain);

  writeFileSync(TMP_MANIFEST_PATH, updatedManifest, 'utf-8');

  return TMP_MANIFEST_PATH;
}

function removeDevelopmentCsp(manifest) {
  const extensionPagesCsp = manifest.content_security_policy?.extension_pages;
  if (typeof extensionPagesCsp !== 'string') {
    return false;
  }

  const productionCsp = extensionPagesCsp.replace(
    /\s+https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?=\s|;|$)/g,
    '',
  );

  if (productionCsp === extensionPagesCsp) {
    return false;
  }

  manifest.content_security_policy.extension_pages = productionCsp;
  return true;
}

function patchManifestForChrome(manifestPath) {
  const content = readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(content);
  let didPatch = removeDevelopmentCsp(manifest);

  if (manifest.browser_specific_settings?.gecko) {
    delete manifest.browser_specific_settings.gecko;
    didPatch = true;

    if (Object.keys(manifest.browser_specific_settings).length === 0) {
      delete manifest.browser_specific_settings;
    }
  }

  // crxjs already rewrote "scripts": ["src/background.ts"] to the bundled output path
  // Extract it and convert to "service_worker" for Chrome compatibility:
  const scripts = manifest.background?.scripts;
  if (Array.isArray(scripts) && scripts.length > 0) {
    manifest.background.service_worker = scripts[0];
    delete manifest.background.scripts;
    didPatch = true;
  }

  if (didPatch) {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  }
}

function patchManifestForFirefox(manifestPath) {
  const content = readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(content);
  let didPatch = removeDevelopmentCsp(manifest);

  const geckoSettings = manifest.browser_specific_settings?.gecko;
  if (geckoSettings) {
    const currentRequiredPermissions = geckoSettings.data_collection_permissions?.required;
    const requiredPermissionsChanged = JSON.stringify(currentRequiredPermissions)
      !== JSON.stringify(FIREFOX_REQUIRED_DATA_COLLECTION_PERMISSIONS);

    if (requiredPermissionsChanged) {
      geckoSettings.data_collection_permissions = {
        ...geckoSettings.data_collection_permissions,
        required: [...FIREFOX_REQUIRED_DATA_COLLECTION_PERMISSIONS],
      };
      didPatch = true;
    }
  }

  for (const resource of manifest.web_accessible_resources ?? []) {
    if (Object.hasOwn(resource, 'use_dynamic_url')) {
      delete resource.use_dynamic_url;
      didPatch = true;
    }
  }

  if (didPatch) {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  }
}

function patchExtensionUrlsForFirefox(outputDir) {
  for (const filePath of walkFiles(outputDir)) {
    if (!filePath.endsWith('.css')) {
      continue;
    }

    const content = readFileSync(filePath, 'utf-8');
    const updatedContent = content.replaceAll('chrome-extension://', 'moz-extension://');

    if (updatedContent !== content) {
      writeFileSync(filePath, updatedContent, 'utf-8');
    }
  }
}

function main() {
  const { site: rawSite, debug, target, version, versionBase } = parseArgs(process.argv.slice(2));
  const site = resolveSite(rawSite);
  const sourceConstantsDomains = extractConstantsDomains();
  const targets = target === 'all' ? BUILD_TARGETS : [target];
  const resolvedVersion = resolveVersion(version, versionBase);
  const debugEnabled = normalizeDebugFlag(debug) === 'true';
  const outputDirs = resolveOutputDirs(targets, debugEnabled, site);
  const buildOutDir = outputDirs[targets[0]];

  for (const outDir of Object.values(outputDirs)) {
    rmSync(outDir, { recursive: true, force: true });
  }

  runCommand('npm', ['run', 'build:bar-css']);
  runCommand('npm', ['run', 'build:settings-css']);
  runCommand('npx', ['tsc']);

  const viteEnv = {
    BUILD_OUT_DIR: buildOutDir,
    VITE_BOTTOM_BAR_DEBUG: String(debugEnabled),
  };

  if (!site.isDefault) {
    viteEnv.MANIFEST_PATH = prepareCustomManifest(site.domain);
  }

  runCommand('npx', ['vite', 'build'], viteEnv);

  copyToDist(buildOutDir, debugEnabled);
  normalizeOutputAssetPaths(buildOutDir);
  normalizeGeneratedFileNames(buildOutDir);

  // Both replacements are driven by the same --site value, so the manifest and
  // the URLs used in the code can never disagree.
  if (!site.isDefault) {
    replaceManifestDomain(site.domain, buildOutDir);
    replaceSiteUrls(site.base, buildOutDir, sourceConstantsDomains);
  }

  for (const buildTarget of targets.slice(1)) {
    cpSync(buildOutDir, outputDirs[buildTarget], { recursive: true });
  }

  for (const buildTarget of targets) {
    const manifestOutputPath = join(outputDirs[buildTarget], 'manifest.json');
    applyVersion(manifestOutputPath, resolvedVersion);

    if (buildTarget === 'chrome') {
      patchManifestForChrome(manifestOutputPath);
    } else {
      patchManifestForFirefox(manifestOutputPath);
      patchExtensionUrlsForFirefox(outputDirs[buildTarget]);
    }
  }

  rmSync(TMP_DIR, { recursive: true, force: true });

  console.log(`Built extension ${resolvedVersion} for ${site.base}: ${targets.join(', ')}.`);
}

main();

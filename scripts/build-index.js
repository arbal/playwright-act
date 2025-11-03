#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const archiveRoot = path.resolve(__dirname, '..', 'archive');
const docsRoot = path.resolve(__dirname, '..', 'docs');
const latestRoot = path.join(docsRoot, 'latest');

function safeReadDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs.readdirSync(dirPath, { withFileTypes: true });
}

function loadSnapshots() {
  const entries = [];
  const dirents = safeReadDir(archiveRoot);

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) {
      continue;
    }
    const snapshotDir = path.join(archiveRoot, dirent.name);
    const metaPath = path.join(snapshotDir, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      continue;
    }

    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (!meta || typeof meta.url !== 'string' || typeof meta.timestamp !== 'string') {
        continue;
      }

      entries.push({
        url: meta.url,
        timestamp: meta.timestamp,
        dirName: dirent.name,
        dirPath: snapshotDir,
      });
    } catch (error) {
      // Skip invalid JSON files.
    }
  }

  return entries;
}

function parseTimestampParts(timestamp) {
  const match = timestamp.match(/^(.*?)(?:-dup(\d+))?$/);
  if (!match) {
    return { base: timestamp, duplicate: 0 };
  }
  return { base: match[1], duplicate: match[2] ? parseInt(match[2], 10) : 0 };
}

function pickLatestSnapshots(snapshots) {
  const latestByUrl = new Map();

  for (const snapshot of snapshots) {
    const existing = latestByUrl.get(snapshot.url);
    if (!existing) {
      latestByUrl.set(snapshot.url, snapshot);
      continue;
    }

    const currentParts = parseTimestampParts(snapshot.timestamp);
    const existingParts = parseTimestampParts(existing.timestamp);

    if (currentParts.base > existingParts.base) {
      latestByUrl.set(snapshot.url, snapshot);
      continue;
    }

    if (currentParts.base < existingParts.base) {
      continue;
    }

    if (currentParts.duplicate >= existingParts.duplicate) {
      latestByUrl.set(snapshot.url, snapshot);
    }
  }

  return latestByUrl;
}

function slugifyUrl(u) {
  return u
    .replace(/^https?:\/\//i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function ensureCleanLatestDir() {
  fs.mkdirSync(docsRoot, { recursive: true });
  if (fs.existsSync(latestRoot)) {
    fs.rmSync(latestRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(latestRoot, { recursive: true });
}

function ensureUniqueSlug(baseSlug, used) {
  const base = baseSlug || 'snapshot';
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${counter}`.slice(0, 100);
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function buildLatestArtifacts(latestByUrl) {
  ensureCleanLatestDir();

  const indexEntries = [];

  const sortedUrls = Array.from(latestByUrl.keys()).sort((a, b) => a.localeCompare(b));
  const usedSlugs = new Set();

  for (const url of sortedUrls) {
    const snapshot = latestByUrl.get(url);
    const slug = ensureUniqueSlug(slugifyUrl(url), usedSlugs);
    const htmlSource = path.join(snapshot.dirPath, 'page.html');
    const textSource = path.join(snapshot.dirPath, 'page.txt');
    const metaSource = path.join(snapshot.dirPath, 'meta.json');

    if (!fs.existsSync(htmlSource) || !fs.existsSync(textSource) || !fs.existsSync(metaSource)) {
      continue;
    }

    const htmlTarget = path.join(latestRoot, `${slug}.html`);
    const textTarget = path.join(latestRoot, `${slug}.txt`);
    const metaTarget = path.join(latestRoot, `${slug}.meta.json`);
    const metaTextTarget = path.join(latestRoot, `${slug}.meta.txt`);

    fs.copyFileSync(htmlSource, htmlTarget);
    fs.copyFileSync(textSource, textTarget);
    fs.copyFileSync(metaSource, metaTarget);

    const metaData = JSON.parse(fs.readFileSync(metaSource, 'utf8'));
    const metaYaml = yaml.dump(metaData, { noRefs: true, lineWidth: 0 });
    const normalizedMetaYaml = metaYaml.endsWith('\n') ? metaYaml : `${metaYaml}\n`;
    fs.writeFileSync(metaTextTarget, normalizedMetaYaml, 'utf8');

    indexEntries.push({
      url,
      slug,
      timestamp: snapshot.timestamp,
      html: `latest/${slug}.html`,
      text: `latest/${slug}.txt`,
      meta: `latest/${slug}.meta.json`,
      meta_txt: `latest/${slug}.meta.txt`,
    });
  }

  const indexJsonPath = path.join(latestRoot, 'index.json');
  fs.writeFileSync(indexJsonPath, `${JSON.stringify(indexEntries, null, 2)}\n`, 'utf8');

  writeIndexHtml(indexEntries);
}

function writeIndexHtml(entries) {
  fs.mkdirSync(docsRoot, { recursive: true });

  let tableRows = '';
  if (entries.length === 0) {
    tableRows = '<tr><td colspan="6">No snapshots yet.</td></tr>';
  } else {
    tableRows = entries
      .map(
        (entry) =>
          `<tr>\n            <td><a href="${entry.url}">${entry.url}</a></td>\n            <td><code>${entry.timestamp}</code></td>\n            <td><a href="${entry.html}">Snapshot HTML</a></td>\n            <td><a href="${entry.text}">Snapshot text</a></td>\n            <td><a href="${entry.meta}">Snapshot meta</a></td>\n            <td><a href="${entry.meta_txt}">Snapshot meta (YAML)</a></td>\n          </tr>`
      )
      .join('\n');
  }

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Snapshot index</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.5; max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
      h1 { font-size: 20px; }
      table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
      th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 13px; }
      th { background-color: #f5f5f5; }
      code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; }
      p { margin: 0.5rem 0 1rem; }
    </style>
  </head>
  <body>
    <h1>Latest URL snapshots</h1>
    <p>This list is auto-generated from archived snapshots. Each "Snapshot HTML" and "Snapshot text" link points to the most recent capture we have for that URL. Older versions remain available under <code>archive/</code> in git history.</p>
    <table>
      <thead>
        <tr>
          <th>Source URL</th>
          <th>Latest timestamp</th>
          <th>Snapshot HTML</th>
          <th>Snapshot text</th>
          <th>Snapshot meta</th>
          <th>Snapshot meta (YAML)</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </body>
</html>\n`;

  const indexHtmlPath = path.join(docsRoot, 'index.html');
  fs.writeFileSync(indexHtmlPath, html, 'utf8');
}

function main() {
  const snapshots = loadSnapshots();
  if (snapshots.length === 0) {
    ensureCleanLatestDir();
    fs.writeFileSync(path.join(latestRoot, 'index.json'), '[]\n', 'utf8');
    writeIndexHtml([]);
    return;
  }

  const latestByUrl = pickLatestSnapshots(snapshots);
  buildLatestArtifacts(latestByUrl);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Failed to build docs index: ${error.message}`);
    process.exit(1);
  }
}

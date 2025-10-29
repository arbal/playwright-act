#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function validateUrl(targetUrl) {
  if (!targetUrl) {
    throw new Error('Error: target URL is required. Usage: node scripts/snapshot.js "<TARGET_URL>"');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (error) {
    throw new Error(`Error: invalid URL provided - ${error.message}`);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Error: URL must use http or https protocol.');
  }
}

function getTimestamp(baseTimestamp) {
  if (baseTimestamp) {
    return baseTimestamp;
  }
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureUniqueDir(baseDir, baseName) {
  let snapshotDirName = baseName;
  let snapshotDirPath = path.join(baseDir, snapshotDirName);
  let duplicateCounter = 0;

  while (fs.existsSync(snapshotDirPath)) {
    duplicateCounter += 1;
    snapshotDirName = `${baseName}-dup${duplicateCounter}`;
    snapshotDirPath = path.join(baseDir, snapshotDirName);
  }

  return { snapshotDirName, snapshotDirPath };
}

function resolveLogger(logger) {
  if (logger && typeof logger.warn === 'function') {
    return logger;
  }
  return {
    warn: (message) => {
      console.warn(message);
    },
  };
}

async function waitForPageSettled(page, options = {}) {
  const logger = resolveLogger(options.logger);
  const networkIdleTimeout =
    options.networkIdleTimeout === undefined ? 10000 : options.networkIdleTimeout;
  const additionalWaitMs =
    options.additionalWaitMs === undefined ? 1500 : options.additionalWaitMs;

  if (networkIdleTimeout && networkIdleTimeout > 0) {
    try {
      await page.waitForLoadState('networkidle', { timeout: networkIdleTimeout });
    } catch (error) {
      logger.warn(`Continuing without network idle: ${error.message}`);
    }
  }

  if (additionalWaitMs && additionalWaitMs > 0) {
    await page.waitForTimeout(additionalWaitMs);
  }
}

async function takeSnapshot(targetUrl, options = {}) {
  validateUrl(targetUrl);

  const archiveRoot = options.archiveRoot || path.resolve(__dirname, '..', 'archive');
  const timestampBase = getTimestamp(options.timestamp);
  const { snapshotDirName, snapshotDirPath } = ensureUniqueDir(archiveRoot, timestampBase);

  const browserLauncher = options.browserLauncher || chromium;
  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...(options.browserLaunchOptions || {}),
  };
  let browser;

  try {
    browser = await browserLauncher.launch(launchOptions);
    const context = await browser.newContext();
    const page = await context.newPage();

    if (typeof options.onPageReady === 'function') {
      await options.onPageReady(page);
    }

    const navigationTimeout = options.navigationTimeout === undefined ? 60000 : options.navigationTimeout;
    let response;
    try {
      response = await page.goto(targetUrl, {
        waitUntil: options.waitUntil || 'domcontentloaded',
        timeout: navigationTimeout,
      });
    } catch (error) {
      throw new Error(`Navigation failed: ${error.message}`);
    }

    if (!response) {
      throw new Error('Navigation failed: no response received.');
    }

    const status = response.status();
    if (status < 200 || status >= 400) {
      throw new Error(`Navigation failed: received HTTP status ${status}.`);
    }

    await waitForPageSettled(page, options);

    const html = await page.content();
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const textContent = await page.evaluate(() => {
      const root = document.body ? document.body.cloneNode(true) : document.documentElement.cloneNode(true);
      root.querySelectorAll('script, style, noscript').forEach((node) => node.remove());
      const text = root.innerText || '';
      return text.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    });

    fs.mkdirSync(snapshotDirPath, { recursive: true });

    const htmlPath = path.join(snapshotDirPath, 'page.html');
    const textPath = path.join(snapshotDirPath, 'page.txt');
    const metaPath = path.join(snapshotDirPath, 'meta.json');
    fs.writeFileSync(htmlPath, html, 'utf8');
    fs.writeFileSync(textPath, textContent, 'utf8');
    const metadata = {
      url: targetUrl,
      timestamp: snapshotDirName,
      status,
      userAgent,
      githubRunId: process.env.GITHUB_RUN_ID || null,
    };
    fs.writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

    return {
      snapshotDir: snapshotDirPath,
      timestamp: snapshotDirName,
      htmlPath,
      textPath,
      url: targetUrl,
      metaPath,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function main() {
  try {
    const targetUrl = process.argv[2];
    const result = await takeSnapshot(targetUrl);

    console.log(
      `Snapshot saved to:\n- ${path.relative(process.cwd(), result.htmlPath)}\n- ${path.relative(process.cwd(), result.textPath)}`
    );

    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `snapshot_timestamp=${result.timestamp}\n`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `snapshot_url=${result.url}\n`);
    }
  } catch (error) {
    console.error(`Snapshot error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  takeSnapshot,
  validateUrl,
  ensureUniqueDir,
  getTimestamp,
};

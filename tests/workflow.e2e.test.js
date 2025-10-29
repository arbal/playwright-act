const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawnSync, execSync } = require('child_process');

const WORKFLOW_PATH = path.resolve(__dirname, '..', '.github', 'workflows', 'snapshot.yml');

function commandExists(command) {
  try {
    execSync(`command -v ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hasDocker() {
  try {
    execSync('docker version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function ensureActBinary() {
  if (commandExists('act')) {
    return 'act';
  }

  const binDir = path.join(__dirname, '..', 'node_modules', '.bin');
  const actBinary = path.join(binDir, 'act');
  if (fs.existsSync(actBinary)) {
    fs.chmodSync(actBinary, 0o755);
    return actBinary;
  }

  return null;
}

function createServer(content) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

const dockerAvailable = hasDocker();
const actBinary = ensureActBinary();

if (!dockerAvailable || !actBinary) {
  test.skip('workflow dispatch snapshots a URL via GitHub Action using act', () => {});
} else {
  test('workflow dispatch snapshots a URL via GitHub Action using act', async () => {
    const { server, url } = await createServer('<html><body><h1>Workflow E2E</h1></body></html>');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-e2e-'));

    try {
      const archivePath = path.join(path.resolve(__dirname, '..', 'archive'));
      const before = new Set(
        fs
          .readdirSync(archivePath, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      );

      const result = spawnSync(
        actBinary,
        [
          'workflow-dispatch',
          '--workflows',
          WORKFLOW_PATH,
          '--input',
          `target_url=${url}`,
          '--job',
          'snapshot',
        ],
        {
          cwd: path.resolve(__dirname, '..'),
          env: {
            ...process.env,
            ACT: '1',
            INPUT_TARGET_URL: url,
          },
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 5 * 60 * 1000,
        }
      );

      if (result.error) {
        throw result.error;
      }

      if (result.status !== 0) {
        console.error(result.stdout);
        console.error(result.stderr);
        throw new Error(`act workflow failed with status ${result.status}`);
      }

      const after = fs
        .readdirSync(archivePath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => !before.has(name));

      expect(after.length).toBeGreaterThan(0);
    } finally {
      server.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 300000);
}

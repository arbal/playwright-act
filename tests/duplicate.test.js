const fs = require('fs');
const path = require('path');
const http = require('http');
const { takeSnapshot } = require('../scripts/snapshot');

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><p>Duplicate Test</p></body></html>');
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

describe('duplicate snapshot handling', () => {
  let archiveDir;
  let server;
  let url;

  beforeAll(async () => {
    ({ server, url } = await startServer());
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    archiveDir = fs.mkdtempSync(path.join(fs.realpathSync(require('os').tmpdir()), 'snapshot-dup-'));
  });

  afterEach(() => {
    if (archiveDir && fs.existsSync(archiveDir)) {
      fs.rmSync(archiveDir, { recursive: true, force: true });
    }
  });

  test('creates -dup suffix when timestamp collides', async () => {
    const first = await takeSnapshot(`${url}/`, { archiveRoot: archiveDir, timestamp: '2024-01-02T12-00-00Z' });
    const second = await takeSnapshot(`${url}/`, { archiveRoot: archiveDir, timestamp: '2024-01-02T12-00-00Z' });

    expect(path.basename(first.snapshotDir)).toBe('2024-01-02T12-00-00Z');
    expect(path.basename(second.snapshotDir)).toBe('2024-01-02T12-00-00Z-dup1');
    expect(fs.existsSync(first.htmlPath)).toBe(true);
    expect(fs.existsSync(second.htmlPath)).toBe(true);
  }, 60000);
});

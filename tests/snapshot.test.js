const fs = require('fs');
const path = require('path');
const http = require('http');
const { takeSnapshot } = require('../scripts/snapshot');

function createTestServer(html) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
      });
    });
  });
}

describe('takeSnapshot', () => {
  let archiveDir;

  beforeEach(() => {
    archiveDir = fs.mkdtempSync(path.join(fs.realpathSync(require('os').tmpdir()), 'snapshot-test-'));
  });

  afterEach(() => {
    if (archiveDir && fs.existsSync(archiveDir)) {
      fs.rmSync(archiveDir, { recursive: true, force: true });
    }
  });

  test('captures HTML and readable text', async () => {
    const html = `<!DOCTYPE html><html><head><title>Test</title><style>body { color: red; }</style><script>console.log('ignored');</script></head><body><h1>Hello</h1><p>World</p></body></html>`;
    const { server, url } = await createTestServer(html);

    try {
      const result = await takeSnapshot(`${url}/`, { archiveRoot: archiveDir, timestamp: '2024-01-01T00-00-00Z' });
      const savedHtml = fs.readFileSync(result.htmlPath, 'utf8');
      const savedText = fs.readFileSync(result.textPath, 'utf8');

      expect(savedHtml).toContain('<h1>Hello</h1>');
      expect(savedHtml).toContain('<p>World</p>');
      expect(savedText).toContain('Hello');
      expect(savedText).toContain('World');
      expect(savedText).not.toContain('console.log');
      expect(result.timestamp).toBe('2024-01-01T00-00-00Z');
    } finally {
      server.close();
    }
  }, 60000);
});

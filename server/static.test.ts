import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from './index';
import type { GameServer } from './index';

let server: GameServer;
let tmp: string;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-static-'));
  fs.mkdirSync(path.join(tmp, 'web', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'web', 'index.html'), '<html>hello</html>');
  fs.writeFileSync(path.join(tmp, 'web', 'assets', 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'top secret');
  server = await createServer(0, { staticDir: path.join(tmp, 'web') });
});

afterAll(async () => {
  await server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Raw request so the path is sent exactly as written (fetch would normalise `..`). */
const raw = (p: string, method = 'GET') =>
  new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: server.port, path: p, method }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body }));
    });
    req.on('error', reject);
    req.end();
  });

describe('static web client', () => {
  it('serves index.html at / and with the right content types', async () => {
    const root = await raw('/');
    expect(root.status).toBe(200);
    expect(root.type).toContain('text/html');
    expect(root.body).toContain('hello');
    const js = await raw('/assets/app.js');
    expect(js.status).toBe(200);
    expect(js.type).toContain('javascript');
  });

  it('ignores query strings', async () => {
    expect((await raw('/?auto=quick')).status).toBe(200);
  });

  it('404s for missing files', async () => {
    expect((await raw('/nope.js')).status).toBe(404);
  });

  it.each(['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/../../secret.txt', '/%00', '/..\\secret.txt'])(
    'refuses path traversal: %s',
    async (p) => {
      const r = await raw(p);
      expect(r.status).toBe(404);
      expect(r.body).not.toContain('top secret');
    },
  );

  it('does not serve on POST, and /health still works', async () => {
    expect((await raw('/', 'POST')).status).toBe(404);
    const h = await raw('/health');
    expect(JSON.parse(h.body).ok).toBe(true);
  });
});

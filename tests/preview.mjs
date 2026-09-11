import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
export async function startPreview(port = 4173, overrides = new Map()) {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (overrides.has(pathname)) {
        response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
        response.end(overrides.get(pathname)); return;
      }
      const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!filename.startsWith(root + path.sep) || !['.html', '.js', '.css', '.png', '.svg', '.ico'].includes(path.extname(filename)) || pathname.includes('node_modules') || pathname.includes('/.')) {
        response.writeHead(404); response.end(); return;
      }
      const data = await fs.readFile(filename);
      response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(data);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startPreview(); console.log('SilverForge preview: http://127.0.0.1:4173');
}

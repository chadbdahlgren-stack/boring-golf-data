// Serves a built course-data folder on http://localhost:8090 for testing the app against it.
//   node test/serve.mjs <folder>
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'site');
http
  .createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(fs.readFileSync(file));
  })
  .listen(8090, () => console.log(`serving ${root} on http://localhost:8090`));

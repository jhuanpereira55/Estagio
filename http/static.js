'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { FRONTEND_ROOT, PUBLIC_PATH } = require('../lib/config');
const { HttpError } = require('../lib/errors');
const { sessionFrom } = require('../auth/sessions');
const { send } = require('./json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Método não permitido.');
  if (!FRONTEND_ROOT) {
    if (pathname === '/' && req.method === 'GET') {
      return send(res, 200, { aplicacao: 'MotorPoint API', status: 'online', health: '/api/health', frontend: 'Defina FRONTEND_DIR para servir as telas locais.' });
    }
    throw new HttpError(404, 'Front-end não configurado. A API está disponível em /api/.');
  }
  const decoded = decodeURIComponent(pathname);
  const target = decoded === '/' ? PUBLIC_PATH : decoded;
  const filename = path.resolve(FRONTEND_ROOT, '.' + target);
  // O front-end pode conter arquivos do projeto antigo. Nunca disponibilize
  // arquivos de servidor, dados ou configurações pela URL.
  if (!filename.startsWith(FRONTEND_ROOT + path.sep)) throw new HttpError(404, 'Arquivo não encontrado.');
  const relative = path.relative(FRONTEND_ROOT, filename);
  const parts = relative.split(path.sep);
  if (parts.some(p => p.startsWith('.') || ['data', 'tests', 'node_modules', '.git'].includes(p)) ||
      ['server.js', 'setup.js', 'server-crypto.js', 'package.json', 'package-lock.json'].includes(path.basename(filename))) {
    throw new HttpError(404, 'Arquivo não encontrado.');
  }
  if (filename.endsWith('.html') && target !== PUBLIC_PATH && !sessionFrom(req)) {
    res.writeHead(302, { Location: PUBLIC_PATH }); res.end(); return;
  }
  let st;
  try { st = fs.statSync(filename); } catch { throw new HttpError(404, 'Arquivo não encontrado.'); }
  if (!st.isFile() || !MIME[path.extname(filename).toLowerCase()]) throw new HttpError(404, 'Arquivo não encontrado.');
  // Impede que um link simbólico no front exponha arquivos fora da pasta escolhida.
  const real = fs.realpathSync(filename);
  const baseReal = fs.realpathSync(FRONTEND_ROOT);
  if (!real.startsWith(baseReal + path.sep)) throw new HttpError(404, 'Arquivo não encontrado.');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filename).toLowerCase()], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filename).pipe(res);
}
module.exports = { serveStatic };

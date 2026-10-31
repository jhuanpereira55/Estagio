'use strict';
// Ponto de entrada da API MotorPoint. Rotas ficam em arquivos separados.
const http = require('node:http');
const { PORT, HOST, FRONTEND_ROOT } = require('./lib/config');
const { HttpError } = require('./lib/errors');
const { send, getBody } = require('./http/json');
const { serveStatic } = require('./http/static');
const { handleApi } = require('./routes');
const { hashPassword } = require('./server-crypto');

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT' || req.method === 'DELETE') {
      // Bloqueia POST cross-origin. No login, a origem também deve ser a aplicação local.
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new HttpError(403, 'Origem não permitida.');
      if (url.pathname.startsWith('/api/') && req.method !== 'DELETE' && !['application/json'].some(t => (req.headers['content-type'] || '').startsWith(t))) {
        throw new HttpError(415, 'Use Content-Type: application/json.');
      }
    }
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url.pathname, ['POST', 'PUT', 'PATCH'].includes(req.method) ? await getBody(req) : {});
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    return send(res, status, { erro: status === 500 ? 'Erro interno do servidor.' : err.message });
  }
});
if (require.main === module) server.listen(PORT, HOST, () => {
  console.log(`MotorPoint API: http://${HOST}:${PORT}/api/health`);
  if (FRONTEND_ROOT) console.log(`Front-end externo servido de: ${FRONTEND_ROOT}`);
  else console.log('Front-end separado: configure FRONTEND_DIR para abrir as telas no mesmo endereco.');
});
module.exports = { server, hashPassword };

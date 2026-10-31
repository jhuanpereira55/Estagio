'use strict';
// Direciona as requisições da API para cada grupo de rotas.
const { HttpError } = require('../lib/errors');
const { send } = require('../http/json');
const { requireAuth } = require('../auth/sessions');
const { text } = require('../services/validacoes');
const { handlePublicAuth, handlePrivateAuth } = require('./auth');
const { handleCadastros } = require('./cadastros');
const { handleRelatorios } = require('./relatorios');
const { handlePedidos } = require('./pedidos');
const { handleVendas } = require('./vendas');
const { handleConfiguracao } = require('./configuracao');

function handleApi(req, res, pathname, body) {
  const method = req.method;
  if (pathname === '/api/health' && method === 'GET') return send(res, 200, { ok: true });
  if (handlePublicAuth(req, res, pathname, body, { send, text })) return;
  const usuario = requireAuth(req);
  if (handlePrivateAuth(req, res, pathname, usuario, send)) return;
  if (handleCadastros(req, res, pathname, body, send)) return;
  if (handleRelatorios(req, res, pathname)) return;
  if (handlePedidos(req, res, pathname, body, send)) return;
  if (handleVendas(req, res, pathname, send)) return;
  if (handleConfiguracao(req, res, pathname, body)) return;
  throw new HttpError(404, 'Rota não encontrada.');
}
module.exports = { handleApi };

'use strict';
const { getStore, mutate } = require('../storage/json');
const { confirmarVenda, cancelarVenda } = require('../services/estoque');

function handleVendas(req, res, pathname, send) {
  const method = req.method;
  const store = getStore();
  const parts = pathname.split('/').filter(Boolean);
  const tipo = parts[1]; const recordId = parts[2]; const acao = parts[3];
  if (tipo === 'pedidos' && recordId && acao === 'vender' && method === 'POST') {
    send(res, 201, mutate(s => confirmarVenda(s, recordId)));
    return true;
  }
  if (pathname === '/api/vendas' && method === 'GET') {
    send(res, 200, store.vendas);
    return true;
  }
  if (tipo === 'vendas' && recordId && acao === 'cancelar' && method === 'POST') {
    send(res, 200, mutate(s => cancelarVenda(s, recordId)));
    return true;
  }
  return false;
}
module.exports = { handleVendas };

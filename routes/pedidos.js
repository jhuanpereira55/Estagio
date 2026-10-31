'use strict';
// Rotas de criacao, edicao e aprovacao de pedidos.
const { HttpError } = require('../lib/errors');
const { getStore, mutate } = require('../storage/json');
const { normalizePedido } = require('../services/pedidos');
const { findOr404, text } = require('../services/validacoes');

function handlePedidos(req, res, pathname, body, send) {
  const method = req.method;
  const parts = pathname.split('/').filter(Boolean);
  const tipo = parts[1];
  const recordId = parts[2];
  const acao = parts[3];

  if (pathname === '/api/pedidos' && method === 'GET') {
    send(res, 200, getStore().pedidos);
    return true;
  }

  if (pathname === '/api/pedidos' && method === 'POST') {
    const novo = mutate(s => {
      const pedido = normalizePedido(body, s);
      s.pedidos.push(pedido);
      return pedido;
    });
    send(res, 201, novo);
    return true;
  }

  if (tipo === 'pedidos' && recordId && !acao && method === 'PUT') {
    const editado = mutate(s => {
      const anterior = findOr404(s.pedidos, recordId, 'Pedido');
      if (!['Em Análise', 'Pendente'].includes(anterior.status)) {
        throw new HttpError(409, 'Só é possível editar pedidos em análise ou pendentes.');
      }
      const pedido = normalizePedido(body, s, anterior);
      s.pedidos = s.pedidos.map(p => p.id === recordId ? pedido : p);
      return pedido;
    });
    send(res, 200, editado);
    return true;
  }

  if (tipo === 'pedidos' && recordId && acao === 'status' && method === 'PATCH') {
    const atualizado = mutate(s => {
      const pedido = findOr404(s.pedidos, recordId, 'Pedido');
      const novo = text(body.status);
      const transicoes = {
        'Em Análise': ['Pendente', 'Aprovado', 'Cancelado'],
        'Pendente': ['Em Análise', 'Aprovado', 'Cancelado'],
        'Aprovado': ['Pendente', 'Cancelado']
      };
      if (!transicoes[pedido.status]?.includes(novo)) {
        throw new HttpError(409, 'Transição de status não permitida.');
      }
      pedido.status = novo;
      return pedido;
    });
    send(res, 200, atualizado);
    return true;
  }

  return false;
}

module.exports = { handlePedidos };

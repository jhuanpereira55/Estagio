'use strict';
const { HttpError } = require('../lib/errors');
const { id, findOr404 } = require('./validacoes');

// Registra a venda e faz a baixa de estoque na mesma operacao de gravacao.
function confirmarVenda(s, recordId) {
  const pedido = findOr404(s.pedidos, recordId, 'Pedido');
  if (pedido.status !== 'Aprovado') {
    throw new HttpError(409, 'O pedido precisa estar aprovado.');
  }

  // Confere todas as pecas antes de modificar qualquer quantidade.
  for (const item of pedido.itens) {
    const peca = findOr404(s.pecas, item.pecaId, 'Peça');
    if (peca.quantidade < item.qtd) {
      throw new HttpError(409, `Estoque insuficiente: ${peca.descricao}.`);
    }
  }

  for (const item of pedido.itens) {
    findOr404(s.pecas, item.pecaId, 'Peça').quantidade -= item.qtd;
  }

  const venda = {
    id: id(),
    numero: s.vendas.reduce((m, v) => Math.max(m, v.numero), 0) + 1,
    pedidoId: pedido.id,
    pedidoNumero: pedido.numero,
    data: new Date().toISOString(),
    vendedor: pedido.vendedor,
    cliente: pedido.cliente,
    itens: structuredClone(pedido.itens),
    total: Math.round(pedido.itens.reduce((t, i) => t + i.qtd * i.preco, 0) * 100) / 100,
    status: 'Concluída'
  };
  s.vendas.push(venda);
  pedido.status = 'Faturado';
  return venda;
}

// Se a venda foi cancelada, devolve as quantidades ao estoque.
function cancelarVenda(s, recordId) {
  const venda = findOr404(s.vendas, recordId, 'Venda');
  if (venda.status !== 'Concluída') {
    throw new HttpError(409, 'A venda já foi cancelada.');
  }
  for (const item of venda.itens) {
    findOr404(s.pecas, item.pecaId, 'Peça').quantidade += item.qtd;
  }
  venda.status = 'Cancelada';
  venda.dataCancelamento = new Date().toISOString();
  findOr404(s.pedidos, venda.pedidoId, 'Pedido').status = 'Cancelado';
  return venda;
}

module.exports = { confirmarVenda, cancelarVenda };

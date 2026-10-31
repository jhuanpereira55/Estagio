'use strict';
const { HttpError } = require('../lib/errors');
const { text, required, numberNonnegative, id, findOr404 } = require('./validacoes');
function normalizeItems(raw, s) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 100) throw new HttpError(400, 'Adicione de 1 a 100 itens.');
  const ids = new Set();
  return raw.map(it => {
    const pecaId = text(it.pecaId);
    const p = findOr404(s.pecas, pecaId, 'Peça');
    if (ids.has(pecaId)) throw new HttpError(400, 'Peça duplicada no pedido.');
    ids.add(pecaId);
    const qtd = numberNonnegative(it.qtd, 'Quantidade', true);
    if (qtd < 1) throw new HttpError(400, 'Quantidade mínima é 1.');
    return { pecaId: p.id, codigo: p.codigoInterno, descricao: p.descricao, marca: p.marca, qtd, preco: p.precoVenda };
  });
}
function normalizePedido(b, s, old = null) {
  const cliente = b?.cliente || {};
  return {
    id: old?.id || id(), numero: old?.numero || (s.pedidos.reduce((m, p) => Math.max(m, p.numero), 0) + 1),
    data: old?.data || new Date().toISOString(),
    vendedor: { nome: required(b?.vendedor?.nome, 'nome do vendedor'), cargo: text(b?.vendedor?.cargo) },
    cliente: { nome: required(cliente.nome, 'nome do cliente'), numero: text(cliente.numero), documento: text(cliente.documento) },
    itens: normalizeItems(b.itens, s), status: old?.status || 'Em Análise'
  };
}
module.exports = { normalizeItems, normalizePedido };

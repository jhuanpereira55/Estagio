'use strict';
const { getStore } = require('../storage/json');
const { send } = require('../http/json');
function handleRelatorios(req, res, pathname) {
  const method = req.method;
  // Relatório somente de leitura: reúne os dois cadastros existentes.
  // Aplicação de peça é texto livre; não inferimos compatibilidade com uma moto.
  if (pathname === '/api/relatorios/pecas-motos' && method === 'GET') {
    const pecas = getStore().pecas.map(p => ({
      codigoInterno: p.codigoInterno, descricao: p.descricao, marca: p.marca,
      aplicacao: p.aplicacao, localizacao: p.localizacao,
      quantidade: p.quantidade, precoVenda: p.precoVenda,
      valorPotencial: Math.round(p.quantidade * p.precoVenda * 100) / 100
    })).sort((a, b) => a.codigoInterno.localeCompare(b.codigoInterno, 'pt-BR', { numeric: true }));
    const motos = getStore().motos.map(m => ({
      placa: m.placa, dono: m.dono, marca: m.marca, modelo: m.modelo,
      ano: m.ano, cor: m.cor
    })).sort((a, b) => a.placa.localeCompare(b.placa, 'pt-BR'));
    const resumo = {
      totalModelosPecas: pecas.length,
      unidadesEmEstoque: pecas.reduce((s, p) => s + p.quantidade, 0),
      pecasEsgotadas: pecas.filter(p => p.quantidade === 0).length,
      valorPotencial: Math.round(pecas.reduce((s, p) => s + p.quantidade * p.precoVenda, 0) * 100) / 100,
      totalMotos: motos.length
    };
    send(res, 200, { geradoEm: new Date().toISOString(), resumo, pecas, motos });
    return true;
  }
  return false;
}
module.exports = { handleRelatorios };

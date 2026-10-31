'use strict';
// Rotas de cadastro: usuarios, motos e pecas (GET/POST/PUT/DELETE).
const { HttpError } = require('../lib/errors');
const { getStore, mutate } = require('../storage/json');
const { safeUser } = require('../auth/password');
const { requireAuth } = require('../auth/sessions');
const { normalizeCadastro, validateUnique, findOr404 } = require('../services/validacoes');

function handleCadastros(req, res, pathname, body, send) {
  const method = req.method;
  const parts = pathname.split('/').filter(Boolean);
  const tipo = parts[1];
  const recordId = parts[2];
  if (parts.length >= 2 && ['usuarios', 'motos', 'pecas'].includes(tipo)) {
    if (['POST', 'PUT', 'DELETE'].includes(method)) {
      const autorizado = requireAuth(req, { admin: tipo === 'usuarios' });
      if (tipo !== 'usuarios' && !['Administrador', 'Operador'].includes(autorizado.perfil)) {
        throw new HttpError(403, 'Somente administradores e operadores podem alterar esses cadastros.');
      }
    }
    if (method === 'GET' && parts.length === 2) {
      send(res, 200, tipo === 'usuarios' ? getStore().usuarios.map(safeUser) : getStore()[tipo]);
      return true;
    }
    if (method === 'POST' && parts.length === 2) {
      const item = mutate(s => { const x = normalizeCadastro(tipo, body); validateUnique(s, tipo, x); s[tipo].push(x); return x; });
      send(res, 201, tipo === 'usuarios' ? safeUser(item) : item);
      return true;
    }
    if (method === 'PUT' && parts.length === 3) {
      const item = mutate(s => { const old = findOr404(s[tipo], recordId, tipo); const x = normalizeCadastro(tipo, body, old); validateUnique(s, tipo, x); s[tipo] = s[tipo].map(r => r.id === recordId ? x : r); return x; });
      send(res, 200, tipo === 'usuarios' ? safeUser(item) : item);
      return true;
    }
    if (method === 'DELETE' && parts.length === 3) {
      mutate(s => {
        findOr404(s[tipo], recordId, tipo);
        if (tipo === 'pecas' && (s.pedidos.some(p => p.itens.some(i => i.pecaId === recordId)) || s.vendas.some(v => v.itens.some(i => i.pecaId === recordId)))) {
          throw new HttpError(409, 'Não exclua uma peça vinculada a pedidos/vendas.');
        }
        s[tipo] = s[tipo].filter(r => r.id !== recordId);
      });
      send(res, 200, { ok: true });
      return true;
    }
  }
  return false; // Essa URL nao pertence a um cadastro suportado.
}
module.exports = { handleCadastros };

'use strict';
const { HttpError } = require('../lib/errors');
const { getStore } = require('../storage/json');

const SESSIONS = new Map(); // Sessões em memória: reiniciar o servidor exige novo login.

const sessionFrom = req => {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=').map(decodeURIComponent)).filter(p => p.length === 2));
  const sid = cookies.mp_session;
  const sess = SESSIONS.get(sid);
  if (!sess) return null;
  if (Date.now() > sess.expires) { SESSIONS.delete(sid); return null; }
  if (sess.userId !== 'admin') {
    const u = getStore().usuarios.find(x => x.id === sess.userId);
    if (!u) { SESSIONS.delete(sid); return null; }
    return { userId: u.id, nome: u.nome, perfil: u.nivelPermissao || 'Operador', sid };
  }
  return { userId: 'admin', nome: 'Administrador', perfil: 'Administrador', sid };
};
function requireAuth(req, { admin = false } = {}) {
  const u = sessionFrom(req);
  if (!u) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  if (u.perfil === 'Cliente') throw new HttpError(403, 'Perfil sem acesso ao sistema interno.');
  if (admin && u.perfil !== 'Administrador') throw new HttpError(403, 'Apenas administradores podem realizar esta operação.');
  return u;
}
module.exports = { SESSIONS, sessionFrom, requireAuth };

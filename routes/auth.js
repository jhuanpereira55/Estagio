'use strict';
const crypto = require('node:crypto');
const { HttpError } = require('../lib/errors');
const { getStore } = require('../storage/json');
const { checkPassword } = require('../auth/password');
const { SESSIONS, sessionFrom } = require('../auth/sessions');

// As funcoes `send` e `text` continuam no server.js nesta etapa.
function handlePublicAuth(req, res, pathname, body, { send, text }) {
  const method = req.method;
  if (pathname === '/api/auth/login' && method === 'POST') {
    const entrada = text(body.usuario, 200).toLowerCase();
    const senha = body.senha;
    const usuarios = [...getStore().usuarios];
    const target = entrada === 'admin' ? { ...getStore().admin, id: 'admin', nome: 'Administrador', nivelPermissao: 'Administrador' } : usuarios.find(u => [u.nome?.toLowerCase(), u.email?.toLowerCase(), u.documento?.toLowerCase()].includes(entrada));
    if (!entrada || typeof senha !== 'string' || !target || !checkPassword(senha, target)) throw new HttpError(401, 'Usuário ou senha incorretos.');
    if (target.nivelPermissao === 'Cliente') throw new HttpError(403, 'Perfil Cliente não pode acessar o painel interno.');
    const sid = crypto.randomBytes(32).toString('hex');
    SESSIONS.set(sid, { userId: target.id, expires: Date.now() + 12 * 60 * 60_000 });
    send(res, 200, { usuario: target.nome, perfil: target.nivelPermissao }, {
      'Set-Cookie': `mp_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${req.socket.encrypted ? '; Secure' : ''}`
    });
    return true;
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const sess = sessionFrom(req); if (sess) SESSIONS.delete(sess.sid);
    send(res, 200, { ok: true }, { 'Set-Cookie': 'mp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    return true;
  }
  return false;
}
function handlePrivateAuth(req, res, pathname, user, send) {
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    send(res, 200, { nome: user.nome, perfil: user.perfil });
    return true;
  }
  return false;
}
module.exports = { handlePublicAuth, handlePrivateAuth };

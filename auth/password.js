'use strict';
const crypto = require('node:crypto');
const { hashPassword } = require('../server-crypto');

function checkPassword(senha, user) {
  if (!user?.salt || !user?.senhaHash) return false;
  const hash = crypto.scryptSync(senha, user.salt, 64);
  const esperado = Buffer.from(user.senhaHash, 'hex');
  return hash.length === esperado.length && crypto.timingSafeEqual(hash, esperado);
}

// Nunca enviar hash ou salt nas respostas da API.
const safeUser = u => { const { senhaHash, salt, ...publicData } = u; return publicData; };
module.exports = { hashPassword, checkPassword, safeUser };

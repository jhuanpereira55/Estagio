'use strict';
// Validações compartilhadas pelos cadastros e pedidos.
const crypto = require('node:crypto');
const { HttpError } = require('../lib/errors');
const { hashPassword } = require('../auth/password');

const text = (value, max = 255) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const required = (value, nome) => {
  const x = text(value);
  if (!x) throw new HttpError(400, `Informe ${nome}.`);
  return x;
};
const numberNonnegative = (v, field, integer = false) => {
  if (v === '' || v == null || !Number.isFinite(Number(v)) || Number(v) < 0 || (integer && !Number.isInteger(Number(v)))) {
    throw new HttpError(400, `${field} inválido.`);
  }
  return Number(v);
};
const id = () => crypto.randomUUID();
const findOr404 = (records, recordId, tipo) => {
  const rec = records.find(x => x.id === recordId);
  if (!rec) throw new HttpError(404, `${tipo} não encontrado(a).`);
  return rec;
};
const digits = v => text(v).replace(/\D/g, '');
function unique(rows, prop, val, skipId, label) {
  if (rows.some(r => r.id !== skipId && String(r[prop] || '').toLowerCase() === String(val).toLowerCase())) {
    throw new HttpError(409, `${label} já cadastrado(a).`);
  }
}
function normalizeCadastro(tipo, body, older = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Dados inválidos.');
  const novo = { id: older?.id || id() };
  if (tipo === 'pecas') {
    for (const f of ['codigoInterno', 'descricao']) novo[f] = required(body[f], f);
    for (const f of ['codigoOriginal', 'marca', 'fornecedor', 'aplicacao', 'unidadeMedida', 'localizacao']) novo[f] = text(body[f]);
    novo.quantidade = numberNonnegative(body.quantidade, 'quantidade', true);
    novo.precoVenda = numberNonnegative(body.precoVenda, 'precoVenda');
  } else if (tipo === 'motos') {
    for (const f of ['dono', 'marca', 'placa', 'cor', 'chassi', 'ano', 'modelo']) novo[f] = required(body[f], f);
    novo.placa = novo.placa.toUpperCase(); novo.chassi = novo.chassi.toUpperCase();
    if (novo.chassi.length !== 17) throw new HttpError(400, 'Chassi deve ter 17 caracteres.');
  } else if (tipo === 'usuarios') {
    for (const f of ['nome', 'documento', 'cargo', 'email', 'telefone', 'nivelPermissao']) novo[f] = required(body[f], f);
    novo.email = novo.email.toLowerCase();
    novo.dataNascimento = text(body.dataNascimento);
    if (!/^\S+@\S+\.\S+$/.test(novo.email)) throw new HttpError(400, 'E-mail inválido.');
    if (!['Administrador', 'Operador', 'Mecânico', 'Cliente'].includes(novo.nivelPermissao)) throw new HttpError(400, 'Perfil inválido.');
    if (body.senha) {
      if (typeof body.senha !== 'string' || body.senha.length < 8) throw new HttpError(400, 'Senha deve ter pelo menos 8 caracteres.');
      Object.assign(novo, hashPassword(body.senha));
    } else if (older) {
      novo.salt = older.salt; novo.senhaHash = older.senhaHash;
    } else throw new HttpError(400, 'Informe a senha do usuário.');
  }
  return novo;
}
function validateUnique(s, tipo, novo) {
  if (tipo === 'pecas') unique(s.pecas, 'codigoInterno', novo.codigoInterno, novo.id, 'Código interno');
  if (tipo === 'motos') {
    unique(s.motos, 'placa', novo.placa, novo.id, 'Placa');
    unique(s.motos, 'chassi', novo.chassi, novo.id, 'Chassi');
  }
  if (tipo === 'usuarios') {
    unique(s.usuarios, 'email', novo.email, novo.id, 'E-mail');
    unique(s.usuarios, 'documento', digits(novo.documento), novo.id, 'Documento');
    if (s.usuarios.some(u => u.id !== novo.id && digits(u.documento) === digits(novo.documento))) throw new HttpError(409, 'Documento já cadastrado.');
  }
}
module.exports = {
  text, required, numberNonnegative, id, findOr404,
  normalizeCadastro, validateUnique
};

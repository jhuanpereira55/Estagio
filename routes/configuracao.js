'use strict';
// Agendamentos e cores do calendario, compartilhados entre as telas.
const { HttpError } = require('../lib/errors');
const { send } = require('../http/json');
const { getStore, mutate } = require('../storage/json');
const { text, required, id } = require('../services/validacoes');

function handleConfiguracao(req, res, pathname, body) {
  if (pathname !== '/api/config') return false;

  if (req.method === 'GET') {
    const { agendamentos, coresDias } = getStore();
    send(res, 200, { agendamentos, coresDias });
    return true;
  }

  if (req.method === 'PATCH') {
    const atualizado = mutate(s => {
      if (body.agendamentos !== undefined) {
        if (!Array.isArray(body.agendamentos) || body.agendamentos.length > 5000) {
          throw new HttpError(400, 'Agendamentos inválidos.');
        }
        s.agendamentos = body.agendamentos.map(a => ({
          id: text(a.id) || id(),
          data: required(a.data, 'data'),
          hora: required(a.hora, 'hora'),
          servico: required(a.servico, 'serviço'),
          cliente: text(a.cliente),
          status: text(a.status) || 'Agendado'
        }));
      }
      if (body.coresDias !== undefined) {
        if (!body.coresDias || typeof body.coresDias !== 'object' || Array.isArray(body.coresDias)) {
          throw new HttpError(400, 'Cores inválidas.');
        }
        s.coresDias = Object.fromEntries(
          Object.entries(body.coresDias).filter(([data, cor]) =>
            /^\d{4}-\d{2}-\d{2}$/.test(data) &&
            ['amarelo', 'laranja', 'vermelho', 'verde', 'azul'].includes(cor)
          )
        );
      }
      return { agendamentos: s.agendamentos, coresDias: s.coresDias };
    });
    send(res, 200, atualizado);
    return true;
  }

  return false;
}

module.exports = { handleConfiguracao };

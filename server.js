'use strict';
// MotorPoint - servidor HTTP e API REST sem dependências externas (Node 20+).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// O front-end fica em outro projeto/pasta e e servido opcionalmente via FRONTEND_DIR.
const FRONTEND_ROOT = process.env.FRONTEND_DIR ? path.resolve(process.env.FRONTEND_DIR) : null;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_PATH = '/telaLogin/index.html';

const { HttpError } = require('./lib/errors');
const { hashPassword } = require('./auth/password');
const { sessionFrom, requireAuth } = require('./auth/sessions');
const { handlePublicAuth, handlePrivateAuth } = require('./routes/auth');
// Leitura e escrita dos dados foram movidas para storage/json.js.
const { getStore, mutate } = require('./storage/json');
const { text, required, numberNonnegative, id, findOr404 } = require('./services/validacoes');
const { handleCadastros } = require('./routes/cadastros');
function send(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders });
  res.end(JSON.stringify(data));
}
function getBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 100_000) { reject(new HttpError(413, 'Requisição muito grande.')); req.destroy(); } });
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch { reject(new HttpError(400, 'JSON inválido.')); }
    });
    req.on('error', reject);
  });
}
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
function handleApi(req, res, pathname, body) {
  const method = req.method;
  if (pathname === '/api/health' && method === 'GET') return send(res, 200, { ok: true });
  // Etapa 2: rotas de login, logout e sessao foram separadas.
  if (handlePublicAuth(req, res, pathname, body, { send, text })) return;
  const u = requireAuth(req);
  if (handlePrivateAuth(req, res, pathname, u, send)) return;

  const parts = pathname.split('/').filter(Boolean);
  const tipo = parts[1]; const recordId = parts[2]; const acao = parts[3];
  // Etapa 3: cadastros agora ficam em routes/cadastros.js.
  if (handleCadastros(req, res, pathname, body, send)) return;
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
    return send(res, 200, { geradoEm: new Date().toISOString(), resumo, pecas, motos });
  }
  if (pathname === '/api/pedidos' && method === 'GET') return send(res, 200, getStore().pedidos);
  if (pathname === '/api/pedidos' && method === 'POST') return send(res, 201, mutate(s => {
    const x = normalizePedido(body, s); s.pedidos.push(x); return x;
  }));
  if (tipo === 'pedidos' && recordId && method === 'PUT' && !acao) return send(res, 200, mutate(s => {
    const old = findOr404(s.pedidos, recordId, 'Pedido');
    if (!['Em Análise', 'Pendente'].includes(old.status)) throw new HttpError(409, 'Só é possível editar pedidos em análise ou pendentes.');
    const x = normalizePedido(body, s, old);
    s.pedidos = s.pedidos.map(p => p.id === recordId ? x : p); return x;
  }));
  if (tipo === 'pedidos' && recordId && acao === 'status' && method === 'PATCH') return send(res, 200, mutate(s => {
    const p = findOr404(s.pedidos, recordId, 'Pedido');
    const novo = text(body.status);
    const transicoes = { 'Em Análise': ['Pendente', 'Aprovado', 'Cancelado'], Pendente: ['Em Análise', 'Aprovado', 'Cancelado'], Aprovado: ['Pendente', 'Cancelado'] };
    if (!transicoes[p.status]?.includes(novo)) throw new HttpError(409, 'Transição de status não permitida.');
    p.status = novo; return p;
  }));
  if (tipo === 'pedidos' && recordId && acao === 'vender' && method === 'POST') return send(res, 201, mutate(s => {
    const p = findOr404(s.pedidos, recordId, 'Pedido');
    if (p.status !== 'Aprovado') throw new HttpError(409, 'O pedido precisa estar aprovado.');
    for (const item of p.itens) {
      const peca = findOr404(s.pecas, item.pecaId, 'Peça');
      if (peca.quantidade < item.qtd) throw new HttpError(409, `Estoque insuficiente: ${peca.descricao}.`);
    }
    for (const item of p.itens) findOr404(s.pecas, item.pecaId, 'Peça').quantidade -= item.qtd;
    const v = { id: id(), numero: s.vendas.reduce((m, v) => Math.max(m, v.numero), 0) + 1,
      pedidoId: p.id, pedidoNumero: p.numero, data: new Date().toISOString(), vendedor: p.vendedor,
      cliente: p.cliente, itens: structuredClone(p.itens), total: Math.round(p.itens.reduce((t, i) => t + i.qtd * i.preco, 0) * 100) / 100,
      status: 'Concluída' };
    s.vendas.push(v); p.status = 'Faturado'; return v;
  }));
  if (pathname === '/api/vendas' && method === 'GET') return send(res, 200, getStore().vendas);
  if (tipo === 'vendas' && recordId && acao === 'cancelar' && method === 'POST') return send(res, 200, mutate(s => {
    const v = findOr404(s.vendas, recordId, 'Venda');
    if (v.status !== 'Concluída') throw new HttpError(409, 'A venda já foi cancelada.');
    for (const item of v.itens) findOr404(s.pecas, item.pecaId, 'Peça').quantidade += item.qtd;
    v.status = 'Cancelada'; v.dataCancelamento = new Date().toISOString();
    findOr404(s.pedidos, v.pedidoId, 'Pedido').status = 'Cancelado';
    return v;
  }));
  if (pathname === '/api/config' && method === 'GET') return send(res, 200, { agendamentos: getStore().agendamentos, coresDias: getStore().coresDias });
  if (pathname === '/api/config' && method === 'PATCH') return send(res, 200, mutate(s => {
    if (body.agendamentos !== undefined) {
      if (!Array.isArray(body.agendamentos) || body.agendamentos.length > 5000) throw new HttpError(400, 'Agendamentos inválidos.');
      s.agendamentos = body.agendamentos.map(a => ({ id: text(a.id) || id(), data: required(a.data, 'data'), hora: required(a.hora, 'hora'), servico: required(a.servico, 'serviço'), cliente: text(a.cliente), status: text(a.status) || 'Agendado' }));
    }
    if (body.coresDias !== undefined) {
      if (!body.coresDias || typeof body.coresDias !== 'object' || Array.isArray(body.coresDias)) throw new HttpError(400, 'Cores inválidas.');
      s.coresDias = Object.fromEntries(Object.entries(body.coresDias).filter(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && ['amarelo', 'laranja', 'vermelho', 'verde', 'azul'].includes(v)));
    }
    return { agendamentos: s.agendamentos, coresDias: s.coresDias };
  }));
  throw new HttpError(404, 'Rota não encontrada.');
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Método não permitido.');
  if (!FRONTEND_ROOT) {
    if (pathname === '/' && req.method === 'GET') {
      return send(res, 200, { aplicacao: 'MotorPoint API', status: 'online', health: '/api/health', frontend: 'Defina FRONTEND_DIR para servir as telas locais.' });
    }
    throw new HttpError(404, 'Front-end não configurado. A API está disponível em /api/.');
  }
  const decoded = decodeURIComponent(pathname);
  const target = decoded === '/' ? PUBLIC_PATH : decoded;
  const filename = path.resolve(FRONTEND_ROOT, '.' + target);
  // O front-end pode conter arquivos do projeto antigo. Nunca disponibilize
  // arquivos de servidor, dados ou configurações pela URL.
  if (!filename.startsWith(FRONTEND_ROOT + path.sep)) throw new HttpError(404, 'Arquivo não encontrado.');
  const relative = path.relative(FRONTEND_ROOT, filename);
  const parts = relative.split(path.sep);
  if (parts.some(p => p.startsWith('.') || ['data', 'tests', 'node_modules', '.git'].includes(p)) ||
      ['server.js', 'setup.js', 'server-crypto.js', 'package.json', 'package-lock.json'].includes(path.basename(filename))) {
    throw new HttpError(404, 'Arquivo não encontrado.');
  }
  if (filename.endsWith('.html') && target !== PUBLIC_PATH && !sessionFrom(req)) {
    res.writeHead(302, { Location: PUBLIC_PATH }); res.end(); return;
  }
  let st;
  try { st = fs.statSync(filename); } catch { throw new HttpError(404, 'Arquivo não encontrado.'); }
  if (!st.isFile() || !MIME[path.extname(filename).toLowerCase()]) throw new HttpError(404, 'Arquivo não encontrado.');
  // Impede que um link simbólico no front exponha arquivos fora da pasta escolhida.
  const real = fs.realpathSync(filename);
  const baseReal = fs.realpathSync(FRONTEND_ROOT);
  if (!real.startsWith(baseReal + path.sep)) throw new HttpError(404, 'Arquivo não encontrado.');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filename).toLowerCase()], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filename).pipe(res);
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT' || req.method === 'DELETE') {
      // Bloqueia POST cross-origin. No login, a origem também deve ser a aplicação local.
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new HttpError(403, 'Origem não permitida.');
      if (url.pathname.startsWith('/api/') && req.method !== 'DELETE' && !['application/json'].some(t => (req.headers['content-type'] || '').startsWith(t))) {
        throw new HttpError(415, 'Use Content-Type: application/json.');
      }
    }
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url.pathname, ['POST', 'PUT', 'PATCH'].includes(req.method) ? await getBody(req) : {});
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    return send(res, status, { erro: status === 500 ? 'Erro interno do servidor.' : err.message });
  }
});
if (require.main === module) server.listen(PORT, HOST, () => {
  console.log(`MotorPoint API: http://${HOST}:${PORT}/api/health`);
  if (FRONTEND_ROOT) console.log(`Front-end externo servido de: ${FRONTEND_ROOT}`);
  else console.log('Front-end separado: configure FRONTEND_DIR para abrir as telas no mesmo endereco.');
});
module.exports = { server, hashPassword };

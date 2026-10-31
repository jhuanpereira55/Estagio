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
const { text, required, id } = require('./services/validacoes');
const { handleCadastros } = require('./routes/cadastros');
const { handlePedidos } = require('./routes/pedidos');
const { handleVendas } = require('./routes/vendas');
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
function handleApi(req, res, pathname, body) {
  const method = req.method;
  if (pathname === '/api/health' && method === 'GET') return send(res, 200, { ok: true });
  // Etapa 2: rotas de login, logout e sessao foram separadas.
  if (handlePublicAuth(req, res, pathname, body, { send, text })) return;
  const u = requireAuth(req);
  if (handlePrivateAuth(req, res, pathname, u, send)) return;

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
  // Etapa 4: pedidos, vendas e estoque ficam em modulos separados.
  if (handlePedidos(req, res, pathname, body, send)) return;
  if (handleVendas(req, res, pathname, send)) return;
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

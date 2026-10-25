'use strict';
// MotorPoint - servidor HTTP e API REST sem dependências externas (Node 20+).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname; // pasta exclusiva do back-end
// O front-end fica em outro projeto/pasta e e servido opcionalmente via FRONTEND_DIR.
const FRONTEND_ROOT = process.env.FRONTEND_DIR ? path.resolve(process.env.FRONTEND_DIR) : null;
const DATA_FILE = path.join(ROOT, 'data', 'store.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const SESSIONS = new Map(); // login é refeito se o servidor reiniciar
const PUBLIC_PATH = '/telaLogin/index.html';
const DEFAULT = () => ({ admin: null, usuarios: [], motos: [], pecas: [], pedidos: [], vendas: [], agendamentos: [], coresDias: {} });

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
if (!fs.existsSync(DATA_FILE)) {
  console.error('Sem configuração inicial. Rode primeiro: npm run setup');
  process.exit(1);
}
let store;
try {
  store = { ...DEFAULT(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  if (!store.admin?.senhaHash) throw new Error('Administrador não configurado');
} catch (err) {
  console.error('Não foi possível ler data/store.json:', err.message);
  process.exit(1);
}
function persist(next) {
  // Arquivo temporário no mesmo volume: evita JSON truncado em reinício/fechamento.
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, DATA_FILE);
  store = next;
}
function mutate(fn) {
  const next = structuredClone(store);
  const result = fn(next);
  persist(next);
  return result;
}
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
function hashPassword(senha, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, senhaHash: crypto.scryptSync(senha, salt, 64).toString('hex') };
}
function checkPassword(senha, user) {
  if (!user?.salt || !user?.senhaHash) return false;
  const hash = crypto.scryptSync(senha, user.salt, 64);
  const esperado = Buffer.from(user.senhaHash, 'hex');
  return hash.length === esperado.length && crypto.timingSafeEqual(hash, esperado);
}
const safeUser = u => { const { senhaHash, salt, ...publicData } = u; return publicData; };
const sessionFrom = req => {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=').map(decodeURIComponent)).filter(p => p.length === 2));
  const sid = cookies.mp_session;
  const sess = SESSIONS.get(sid);
  if (!sess) return null;
  if (Date.now() > sess.expires) { SESSIONS.delete(sid); return null; }
  // Revogação simples se usuário for excluído.
  if (sess.userId !== 'admin') {
    const u = store.usuarios.find(x => x.id === sess.userId);
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
  if (pathname === '/api/auth/login' && method === 'POST') {
    const entrada = text(body.usuario, 200).toLowerCase();
    const senha = body.senha;
    const usuarios = [...store.usuarios];
    const target = entrada === 'admin' ? { ...store.admin, id: 'admin', nome: 'Administrador', nivelPermissao: 'Administrador' } : usuarios.find(u => [u.nome?.toLowerCase(), u.email?.toLowerCase(), u.documento?.toLowerCase()].includes(entrada));
    if (!entrada || typeof senha !== 'string' || !target || !checkPassword(senha, target)) throw new HttpError(401, 'Usuário ou senha incorretos.');
    if (target.nivelPermissao === 'Cliente') throw new HttpError(403, 'Perfil Cliente não pode acessar o painel interno.');
    const sid = crypto.randomBytes(32).toString('hex');
    SESSIONS.set(sid, { userId: target.id, expires: Date.now() + 12 * 60 * 60_000 });
    return send(res, 200, { usuario: target.nome, perfil: target.nivelPermissao }, {
      'Set-Cookie': `mp_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${req.socket.encrypted ? '; Secure' : ''}`
    });
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const sess = sessionFrom(req); if (sess) SESSIONS.delete(sess.sid);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'mp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  const u = requireAuth(req);
  if (pathname === '/api/auth/me' && method === 'GET') return send(res, 200, { nome: u.nome, perfil: u.perfil });

  const parts = pathname.split('/').filter(Boolean);
  const tipo = parts[1]; const recordId = parts[2]; const acao = parts[3];
  if (parts.length >= 2 && ['usuarios', 'motos', 'pecas'].includes(tipo)) {
    if (['POST', 'PUT', 'DELETE'].includes(method)) {
      const autorizado = requireAuth(req, { admin: tipo === 'usuarios' });
      if (tipo !== 'usuarios' && !['Administrador', 'Operador'].includes(autorizado.perfil)) {
        throw new HttpError(403, 'Somente administradores e operadores podem alterar esses cadastros.');
      }
    }
    if (method === 'GET' && parts.length === 2) return send(res, 200, tipo === 'usuarios' ? store.usuarios.map(safeUser) : store[tipo]);
    if (method === 'POST' && parts.length === 2) {
      const item = mutate(s => { const x = normalizeCadastro(tipo, body); validateUnique(s, tipo, x); s[tipo].push(x); return x; });
      return send(res, 201, tipo === 'usuarios' ? safeUser(item) : item);
    }
    if (method === 'PUT' && parts.length === 3) {
      const item = mutate(s => { const old = findOr404(s[tipo], recordId, tipo); const x = normalizeCadastro(tipo, body, old); validateUnique(s, tipo, x); s[tipo] = s[tipo].map(r => r.id === recordId ? x : r); return x; });
      return send(res, 200, tipo === 'usuarios' ? safeUser(item) : item);
    }
    if (method === 'DELETE' && parts.length === 3) {
      mutate(s => {
        findOr404(s[tipo], recordId, tipo);
        if (tipo === 'pecas' && (s.pedidos.some(p => p.itens.some(i => i.pecaId === recordId)) || s.vendas.some(v => v.itens.some(i => i.pecaId === recordId)))) {
          throw new HttpError(409, 'Não exclua uma peça vinculada a pedidos/vendas.');
        }
        s[tipo] = s[tipo].filter(r => r.id !== recordId);
      });
      return send(res, 200, { ok: true });
    }
  }
  // Relatório somente de leitura: reúne os dois cadastros existentes.
  // Aplicação de peça é texto livre; não inferimos compatibilidade com uma moto.
  if (pathname === '/api/relatorios/pecas-motos' && method === 'GET') {
    const pecas = store.pecas.map(p => ({
      codigoInterno: p.codigoInterno, descricao: p.descricao, marca: p.marca,
      aplicacao: p.aplicacao, localizacao: p.localizacao,
      quantidade: p.quantidade, precoVenda: p.precoVenda,
      valorPotencial: Math.round(p.quantidade * p.precoVenda * 100) / 100
    })).sort((a, b) => a.codigoInterno.localeCompare(b.codigoInterno, 'pt-BR', { numeric: true }));
    const motos = store.motos.map(m => ({
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
  if (pathname === '/api/pedidos' && method === 'GET') return send(res, 200, store.pedidos);
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
  if (pathname === '/api/vendas' && method === 'GET') return send(res, 200, store.vendas);
  if (tipo === 'vendas' && recordId && acao === 'cancelar' && method === 'POST') return send(res, 200, mutate(s => {
    const v = findOr404(s.vendas, recordId, 'Venda');
    if (v.status !== 'Concluída') throw new HttpError(409, 'A venda já foi cancelada.');
    for (const item of v.itens) findOr404(s.pecas, item.pecaId, 'Peça').quantidade += item.qtd;
    v.status = 'Cancelada'; v.dataCancelamento = new Date().toISOString();
    findOr404(s.pedidos, v.pedidoId, 'Pedido').status = 'Cancelado';
    return v;
  }));
  if (pathname === '/api/config' && method === 'GET') return send(res, 200, { agendamentos: store.agendamentos, coresDias: store.coresDias });
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

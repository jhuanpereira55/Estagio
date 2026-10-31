'use strict';
const fs = require('node:fs');
const { DATA_FILE } = require('../lib/config');
const DEFAULT = () => ({ admin: null, usuarios: [], motos: [], pecas: [], pedidos: [], vendas: [], agendamentos: [], coresDias: {} });
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
const getStore = () => store;
module.exports = { getStore, mutate };

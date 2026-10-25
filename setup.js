'use strict';
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { hashPassword } = require('./server-crypto');
const file = path.join(__dirname, 'data', 'store.json');
if (fs.existsSync(file)) {
  console.error('Configuração já existe. Não substituímos seus dados nem a senha administrativa.');
  process.exit(1);
}
function start(password) {
  if (password.length < 8) { console.error('Use ao menos 8 caracteres na senha administrativa.'); process.exitCode = 1; return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const initial = { admin: { ...hashPassword(password) }, usuarios: [], motos: [], pecas: [], pedidos: [], vendas: [], agendamentos: [], coresDias: {} };
  fs.writeFileSync(file, JSON.stringify(initial, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Configuração criada. Login: admin. Agora execute: npm start');
}
if (process.env.MOTORPOINT_ADMIN_PASSWORD) start(process.env.MOTORPOINT_ADMIN_PASSWORD);
else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Defina a senha do usuário admin (mínimo 8 caracteres): ', s => { rl.close(); start(s); });
}

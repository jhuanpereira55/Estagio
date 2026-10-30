'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'motorpoint-test-'));
for (const f of ['server.js','setup.js','server-crypto.js']) fs.copyFileSync(path.join(__dirname,'..',f), path.join(root,f));
for (const dir of ['storage','lib']) fs.cpSync(path.join(__dirname,'..',dir),path.join(root,dir),{recursive:true});
fs.mkdirSync(path.join(root,'data'));
// As telas sao externas ao repositorio do back-end.
const front = path.join(root, 'frontend-externo');
fs.mkdirSync(path.join(front, 'telaLogin'), { recursive: true });
fs.writeFileSync(path.join(front, 'telaLogin', 'index.html'), '<h1>Login externo</h1>');
fs.writeFileSync(path.join(front, 'server.js'), '/* nao deve ficar publico */');
let proc;
let port;
async function freePort() {
  const srv = net.createServer();
  await new Promise(resolve => srv.listen(0,'127.0.0.1',resolve));
  const p = srv.address().port;
  await new Promise(resolve => srv.close(resolve));
  return p;
}
async function start() {
  port = await freePort();
  proc = spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',FRONTEND_DIR:front},stdio:'pipe'});
  proc.on('error', console.error);
  for (let i=0;i<75;i++) {
    if (proc.exitCode !== null) throw new Error('Servidor encerrou: '+proc.exitCode);
    try { const r=await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return; } catch {}
    await new Promise(r=>setTimeout(r,50));
  }
  throw new Error('Servidor não inicializou');
}
async function stop() {
  if (!proc) return;
  const current=proc;
  await new Promise(resolve => { current.once('exit',resolve); current.kill(); });
  proc=undefined;
}
after(async () => { await stop(); fs.rmSync(root,{recursive:true,force:true}); });
async function call(url, method='GET', data, cookie) {
  const r=await fetch(`http://127.0.0.1:${port}${url}`,{
    method,headers:{ ...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},
    ...(data===undefined?{}:{body:JSON.stringify(data)})
  });
  return { status:r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
test('MotorPoint: autenticação, CRUD, venda e persistência após reiniciar', async () => {
  const setup=spawnSync(process.execPath,['setup.js'],{cwd:root,env:{...process.env,MOTORPOINT_ADMIN_PASSWORD:'SenhaSegura567'},encoding:'utf8'});
  assert.equal(setup.status,0,setup.stderr);
  await start();
  const pagina = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /Login externo/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/server.js`)).status, 404);
  assert.equal((await call('/api/pecas')).status,401);
  assert.equal((await call('/api/auth/login','POST',{usuario:'admin',senha:'errada'})).status,401);
  const login=await call('/api/auth/login','POST',{usuario:'admin',senha:'SenhaSegura567'});
  assert.equal(login.status,200);
  const cookie=login.cookie;
  assert.ok(cookie.includes('mp_session='));
  assert.equal((await call('/api/relatorios/pecas-motos')).status,401);
  const vazio = await call('/api/relatorios/pecas-motos','GET',undefined,cookie);
  assert.equal(vazio.status,200);
  assert.deepEqual(vazio.data.resumo, {totalModelosPecas:0,unidadesEmEstoque:0,pecasEsgotadas:0,valorPotencial:0,totalMotos:0});
  const piece = {codigoInterno:'TEST001',descricao:'Pastilha de freio',marca:'Honda',quantidade:5,precoVenda:25.5};
  const ins=await call('/api/pecas','POST',piece,cookie);
  assert.equal(ins.status,201);
  const pecaId=ins.data.id;
  assert.equal((await call('/api/pecas','POST',piece,cookie)).status,409);
  const moto=await call('/api/motos','POST',{dono:'Cliente',marca:'Honda',placa:'ABC1D23',cor:'Preta',chassi:'12345678901234567',ano:'2020',modelo:'CG160'},cookie);
  assert.equal(moto.status,201);
  const relatorio = await call('/api/relatorios/pecas-motos','GET',undefined,cookie);
  assert.equal(relatorio.status,200);
  assert.equal(relatorio.data.pecas.length,1);
  assert.equal(relatorio.data.pecas[0].descricao,'Pastilha de freio');
  assert.equal(relatorio.data.pecas[0].valorPotencial,127.5);
  assert.equal(relatorio.data.motos.length,1);
  assert.equal(relatorio.data.motos[0].modelo,'CG160');
  assert.equal(relatorio.data.resumo.unidadesEmEstoque,5);
  assert.equal(relatorio.data.resumo.totalMotos,1);
  assert.equal(relatorio.data.resumo.valorPotencial,127.5);

  const cadastro=await call('/api/usuarios','POST',{nome:'Cliente Teste',documento:'111.111.111-11',cargo:'Atendente',email:'test@example.com',telefone:'(44) 99999-1111',nivelPermissao:'Operador',senha:'SenhaOperador567'},cookie);
  assert.equal(cadastro.status,201);
  assert.equal(cadastro.data.senhaHash,undefined);
  assert.equal(cadastro.data.senha,undefined);
  assert.equal((await call('/api/usuarios','GET',undefined,cookie)).data[0].salt,undefined);
  const pedido=await call('/api/pedidos','POST',{
    vendedor:{nome:'Admin',cargo:'Gerente'},cliente:{nome:'Pessoa',numero:'',documento:''},
    itens:[{pecaId,qtd:3,preco:0}] },cookie);
  assert.equal(pedido.status,201);
  const pedId=pedido.data.id;
  assert.equal(pedido.data.itens[0].preco,25.5);
  assert.equal((await call(`/api/pedidos/${pedId}/vender`,'POST',{},cookie)).status,409);
  assert.equal((await call(`/api/pedidos/${pedId}/status`,'PATCH',{status:'Aprovado'},cookie)).status,200);
  const venda=await call(`/api/pedidos/${pedId}/vender`,'POST',{},cookie);
  assert.equal(venda.status,201);
  assert.equal(venda.data.total,76.5);
  assert.equal((await call(`/api/pedidos/${pedId}/vender`,'POST',{},cookie)).status,409);
  assert.equal((await call('/api/pecas','GET',undefined,cookie)).data[0].quantidade,2);
  assert.equal((await call('/api/relatorios/pecas-motos','GET',undefined,cookie)).data.resumo.unidadesEmEstoque,2);

  assert.equal((await call(`/api/pecas/${pecaId}`,'DELETE',undefined,cookie)).status,409);
  const canc=await call(`/api/vendas/${venda.data.id}/cancelar`,'POST',{},cookie);
  assert.equal(canc.status,200);
  assert.equal((await call('/api/pecas','GET',undefined,cookie)).data[0].quantidade,5);
  assert.equal((await call('/api/relatorios/pecas-motos','GET',undefined,cookie)).data.resumo.unidadesEmEstoque,5);

  assert.equal((await call(`/api/vendas/${venda.data.id}/cancelar`,'POST',{},cookie)).status,409);
  assert.equal((await call('/api/config','PATCH',{agendamentos:[{data:'2026-11-01',hora:'09:00',servico:'Troca de óleo'}],coresDias:{'2026-11-01':'verde'}},cookie)).status,200);
  await stop();
  await start();
  const log2=await call('/api/auth/login','POST',{usuario:'admin',senha:'SenhaSegura567'});
  assert.equal(log2.status,200);
  const cookie2=log2.cookie;
  assert.equal((await call('/api/pecas','GET',undefined,cookie2)).data[0].quantidade,5);
  assert.equal((await call('/api/pedidos','GET',undefined,cookie2)).data[0].status,'Cancelado');
  assert.equal((await call('/api/vendas','GET',undefined,cookie2)).data[0].status,'Cancelada');
  assert.equal((await call('/api/config','GET',undefined,cookie2)).data.agendamentos.length,1);
  assert.equal((await call('/api/usuarios','GET',undefined,cookie2)).data.length,1);
  assert.equal((await call('/api/relatorios/pecas-motos','GET',undefined,cookie2)).data.resumo.totalMotos,1);
  assert.equal((await call('/api/relatorios/pecas-motos','GET',undefined,cookie2)).data.resumo.valorPotencial,127.5);

});

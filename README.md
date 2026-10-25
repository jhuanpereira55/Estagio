# MotorPoint - Back-end

Back-end do sistema MotorPoint, desenvolvido para o projeto de Estágio Supervisionado do curso de Análise e Desenvolvimento de Sistemas.

## Tecnologias utilizadas

- Node.js
- JavaScript
- API REST
- JSON para armazenamento temporário dos dados

## Funcionalidades

- Login e autenticação de usuários
- Cadastro de peças, motos e usuários
- Validação dos dados cadastrados
- Gerenciamento de pedidos e vendas
- Atualização automática do estoque
- Cancelamento de vendas
- Consultas e relatórios

## Como executar

É necessário ter o Node.js instalado.

No terminal, dentro da pasta do projeto, execute:

```bash
npm install
npm start
```

Para configurar o administrador inicial:

```bash
npm run setup
```

No Windows, caso o PowerShell bloqueie o comando `npm`, utilize `npm.cmd`.

## Estrutura do projeto

- `server.js` - Servidor e rotas da API.
- `server-crypto.js` - Funções de segurança e senhas.
- `setup.js` - Configuração do administrador.
- `package.json` - Configurações e comandos do projeto.
- `tests/` - Testes automatizados.
- `data/` - Armazenamento local dos dados.

## Banco de dados
Atualmente, os dados são armazenados em arquivo JSON. A integração com MySQL será realizada posteriormente.

## Observações
O back-end está separado do front-end para facilitar a organização e manutenção do projeto.
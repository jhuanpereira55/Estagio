'use strict';
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const FRONTEND_ROOT = process.env.FRONTEND_DIR ? path.resolve(process.env.FRONTEND_DIR) : null;
const DATA_FILE = path.join(ROOT, 'data', 'store.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_PATH = '/telaLogin/index.html';
module.exports = { ROOT, FRONTEND_ROOT, DATA_FILE, PORT, HOST, PUBLIC_PATH };

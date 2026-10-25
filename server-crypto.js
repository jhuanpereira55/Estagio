const crypto = require('node:crypto');
exports.hashPassword = (senha, salt = crypto.randomBytes(16).toString('hex')) => ({
  salt,
  senhaHash: crypto.scryptSync(senha, salt, 64).toString('hex')
});

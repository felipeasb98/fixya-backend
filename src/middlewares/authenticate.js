// ── authenticate.js ────────────────────────────────────────────
const { verifyAccessToken } = require('../utils/jwt');
const { AppError } = require('../utils/AppError');

function authenticate(req, _res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return next(new AppError('Token de autenticación requerido', 401));
  }
  try {
    const payload = verifyAccessToken(auth.split(' ')[1]);
    req.user = payload; // { id, rol }
    next();
  } catch {
    next(new AppError('Token inválido o expirado', 401));
  }
}

module.exports = { authenticate };

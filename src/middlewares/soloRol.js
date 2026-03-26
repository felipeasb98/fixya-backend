const { AppError } = require('../utils/AppError');
const rateLimit = require('express-rate-limit');

// ── soloRol ────────────────────────────────────────────────────
function soloRol(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.user?.rol)) {
      return next(new AppError(`Solo accesible para: ${roles.join(', ')}`, 403));
    }
    next();
  };
}

// ── errorHandler ───────────────────────────────────────────────
function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || 500;
  const message    = err.message    || 'Error interno del servidor';

  if (process.env.NODE_ENV !== 'production') {
    console.error(`[ERROR] ${statusCode} ${req.method} ${req.path}:`, err.message);
  }

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

// ── rateLimiter ────────────────────────────────────────────────
function rateLimiter(options = {}) {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: options.max || 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Intenta en unos minutos.' },
  });
}

module.exports = { soloRol, errorHandler, rateLimiter };

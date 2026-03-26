const rateLimit = require('express-rate-limit');

function rateLimiter(options = {}) {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: options.max || 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Intenta en unos minutos.' },
  });
}

module.exports = { rateLimiter };

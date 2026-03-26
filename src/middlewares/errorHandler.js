const { AppError } = require('../utils/AppError');

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

module.exports = { errorHandler };

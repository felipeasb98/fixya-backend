const { PrismaClient } = require('@prisma/client');

// Instancia única compartida en toda la app
// Evita exceso de conexiones a PostgreSQL
const prisma = global._prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  global._prisma = prisma;
}

module.exports = prisma;

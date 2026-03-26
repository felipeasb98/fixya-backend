require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...\n');

  const rubros = [
    { nombre: 'gasfiteria',    emoji: '🔧' },
    { nombre: 'electricidad',  emoji: '⚡' },
    { nombre: 'cerrajeria',    emoji: '🔑' },
    { nombre: 'handyman',      emoji: '🪛' },
    { nombre: 'pintura',       emoji: '🎨' },
    { nombre: 'climatizacion', emoji: '❄️' },
  ];

  for (const r of rubros) {
    await prisma.rubro.upsert({
      where: { nombre: r.nombre },
      update: {},
      create: r,
    });
    console.log(`✅ Rubro: ${r.emoji} ${r.nombre}`);
  }

  const passwordHash = await bcrypt.hash('Test1234!', 12);

  const usuario = await prisma.usuario.upsert({
    where: { email: 'cliente@fixya.cl' },
    update: {},
    create: {
      nombre: 'María González',
      email: 'cliente@fixya.cl',
      telefono: '+56912345678',
      passwordHash,
      emailVerificado: true,
    },
  });
  console.log(`✅ Usuario: ${usuario.email}`);

  const rubroGas  = await prisma.rubro.findUnique({ where: { nombre: 'gasfiteria' } });
  const rubroElec = await prisma.rubro.findUnique({ where: { nombre: 'electricidad' } });

  const tecnico = await prisma.tecnico.upsert({
    where: { email: 'tecnico@fixya.cl' },
    update: {},
    create: {
      nombre: 'Carlos Mendoza',
      email: 'tecnico@fixya.cl',
      telefono: '+56987654321',
      passwordHash,
      rut: '12345678-9',
      activo: true,
      disponible: true,
      comisionPct: 10,
      plan: 'fundador',
      secCertificado: true,
      secVerificado: true,
      ratingPromedio: 4.9,
      totalRatings: 47,
      trabajosCompletados: 127,
      banco: 'BancoEstado',
      tipoCuenta: 'cuenta_rut',
      numeroCuenta: '12345678',
      latitud: -33.4489,
      longitud: -70.6693,
      rubros: {
        create: [
          { rubroId: rubroGas.id },
          { rubroId: rubroElec.id },
        ],
      },
    },
  });
  console.log(`✅ Técnico: ${tecnico.email}`);
  console.log('\n✨ Seed completado');
  console.log('   Cliente:  cliente@fixya.cl / Test1234!');
  console.log('   Técnico:  tecnico@fixya.cl / Test1234!');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
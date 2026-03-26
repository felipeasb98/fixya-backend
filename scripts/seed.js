require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool, query } = require('../src/config/db');

async function seed() {
  console.log('🌱 Cargando datos de prueba...');

  try {
    // ── Limpiar tablas (en orden por FK) ──────────────
    await query('DELETE FROM ratings');
    await query('DELETE FROM pagos');
    await query('DELETE FROM postulaciones');
    await query('DELETE FROM solicitudes');
    await query('DELETE FROM tecnicos');
    await query('DELETE FROM usuarios');

    const passHash = await bcrypt.hash('fixya123', 12);

    // ── Cliente de prueba ─────────────────────────────
    const clienteId = uuidv4();
    await query(
      `INSERT INTO usuarios (id, nombre, email, telefono, password_hash, rol)
       VALUES ($1, 'María González', 'maria@test.com', '+56912345678', $2, 'cliente')`,
      [clienteId, passHash]
    );
    console.log('  ✓ Cliente: maria@test.com / fixya123');

    // ── Técnico fundador (gasfitero) ──────────────────
    const tec1Id = uuidv4();
    await query(
      `INSERT INTO usuarios (id, nombre, email, telefono, password_hash, rol)
       VALUES ($1, 'Carlos Mendoza', 'carlos@test.com', '+56987654321', $2, 'tecnico')`,
      [tec1Id, passHash]
    );
    await query(
      `INSERT INTO tecnicos (id, usuario_id, rut, rubros, banco, tipo_cuenta, numero_cuenta,
        estado_cuenta, comision, es_fundador, sec_verificado, rating_promedio, trabajos_completados)
       VALUES ($1, $2, '12.345.678-9', $3, 'BancoEstado', 'cuenta_rut', '12345678',
        'activo', 0.10, true, true, 4.9, 127)`,
      [uuidv4(), tec1Id, JSON.stringify(['gasfiteria', 'cerrajeria'])]
    );
    console.log('  ✓ Técnico: carlos@test.com / fixya123 (gasfitero fundador)');

    // ── Técnico electricista ──────────────────────────
    const tec2Id = uuidv4();
    await query(
      `INSERT INTO usuarios (id, nombre, email, telefono, password_hash, rol)
       VALUES ($1, 'Ana Martínez', 'ana@test.com', '+56922334455', $2, 'tecnico')`,
      [tec2Id, passHash]
    );
    await query(
      `INSERT INTO tecnicos (id, usuario_id, rut, rubros, banco, tipo_cuenta, numero_cuenta,
        estado_cuenta, comision, sec_verificado, rating_promedio, trabajos_completados)
       VALUES ($1, $2, '9.876.543-2', $3, 'Banco Chile', 'cuenta_corriente', '87654321',
        'activo', 0.18, true, 4.7, 43)`,
      [uuidv4(), tec2Id, JSON.stringify(['electricidad', 'handyman'])]
    );
    console.log('  ✓ Técnico: ana@test.com / fixya123 (electricista)');

    // ── Solicitud de prueba ───────────────────────────
    const solId = uuidv4();
    await query(
      `INSERT INTO solicitudes (
        id, numero, cliente_id, rubro, trabajo_nombre, descripcion,
        urgencia, latitud, longitud, direccion,
        precio_mo_estimado, precio_mat_estimado, estado
      ) VALUES ($1, 'FY-000001', $2, 'gasfiteria', 'Cambio de llave de paso',
        'La llave de paso del baño no cierra bien, gotea constantemente.',
        'hoy', -33.4489, -70.6693, 'Av. Providencia 1234, Santiago',
        22000, 8000, 'pendiente')`,
      [solId, clienteId]
    );
    console.log('  ✓ Solicitud de prueba creada: FY-000001');

    console.log('\n✅ Seed completado. Puedes hacer login con cualquiera de las cuentas.\n');
  } catch (err) {
    console.error('❌ Error en seed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();

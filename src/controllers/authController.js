const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');

// Generar tokens JWT
const generarTokens = (userId) => {
  const accessToken = jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
  const refreshToken = jwt.sign(
    { id: userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
  );
  return { accessToken, refreshToken };
};

// POST /auth/registro/cliente
const registroCliente = async (req, res) => {
  const { nombre, email, telefono, password } = req.body;
  try {
    // Verificar si el email ya existe
    const existe = await query('SELECT id FROM usuarios WHERE email = $1', [email.toLowerCase()]);
    if (existe.rows.length > 0) {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const id = uuidv4();

    await query(
      `INSERT INTO usuarios (id, nombre, email, telefono, password_hash, rol, activo)
       VALUES ($1, $2, $3, $4, $5, 'cliente', true)`,
      [id, nombre.trim(), email.toLowerCase(), telefono, passwordHash]
    );

    const { accessToken, refreshToken } = generarTokens(id);

    res.status(201).json({
      mensaje: 'Cuenta creada exitosamente',
      accessToken,
      refreshToken,
      usuario: { id, nombre, email, rol: 'cliente' }
    });
  } catch (err) {
    console.error('Error registro cliente:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// POST /auth/registro/tecnico
const registroTecnico = async (req, res) => {
  const {
    nombre, email, telefono, password,
    rubros, rut, banco, tipoCuenta, numeroCuenta
  } = req.body;
  try {
    const existe = await query('SELECT id FROM usuarios WHERE email = $1', [email.toLowerCase()]);
    if (existe.rows.length > 0) {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const id = uuidv4();

    // Insertar usuario base
    await query(
      `INSERT INTO usuarios (id, nombre, email, telefono, password_hash, rol, activo)
       VALUES ($1, $2, $3, $4, $5, 'tecnico', true)`,
      [id, nombre.trim(), email.toLowerCase(), telefono, passwordHash]
    );

    // Insertar perfil técnico
    await query(
      `INSERT INTO tecnicos (id, usuario_id, rut, rubros, banco, tipo_cuenta, numero_cuenta,
        estado_cuenta, comision, rating_promedio, trabajos_completados)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente_verificacion', $8, 5.0, 0)`,
      [uuidv4(), id, rut, JSON.stringify(rubros), banco, tipoCuenta, numeroCuenta,
       parseFloat(process.env.COMISION_FUNDADOR || '0.10')]
    );

    const { accessToken, refreshToken } = generarTokens(id);

    res.status(201).json({
      mensaje: 'Solicitud enviada. FixYa verificará tu cuenta en 24–48 hrs.',
      accessToken,
      refreshToken,
      usuario: { id, nombre, email, rol: 'tecnico' }
    });
  } catch (err) {
    console.error('Error registro técnico:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// POST /auth/login
const login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await query(
      `SELECT u.id, u.nombre, u.email, u.password_hash, u.rol, u.activo,
              u.foto_url, u.telefono
       FROM usuarios u
       WHERE u.email = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const usuario = result.rows[0];

    if (!usuario.activo) {
      return res.status(403).json({ error: 'Cuenta suspendida. Contacta a soporte.' });
    }

    const passwordOk = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    // Si es técnico, traer datos adicionales
    let perfilTecnico = null;
    if (usuario.rol === 'tecnico') {
      const tecResult = await query(
        `SELECT rubros, estado_cuenta, comision, rating_promedio,
                trabajos_completados, es_fundador, sec_verificado
         FROM tecnicos WHERE usuario_id = $1`,
        [usuario.id]
      );
      if (tecResult.rows.length > 0) perfilTecnico = tecResult.rows[0];
    }

    const { accessToken, refreshToken } = generarTokens(usuario.id);

    // Actualizar último acceso
    await query('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = $1', [usuario.id]);

    res.json({
      accessToken,
      refreshToken,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
        telefono: usuario.telefono,
        fotoUrl: usuario.foto_url,
        ...(perfilTecnico && { tecnico: perfilTecnico })
      }
    });
  } catch (err) {
    console.error('Error login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// POST /auth/refresh
const refreshToken = async (req, res) => {
  const { refreshToken: token } = req.body;
  if (!token) return res.status(400).json({ error: 'Refresh token requerido' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const result = await query('SELECT id, activo FROM usuarios WHERE id = $1', [decoded.id]);

    if (result.rows.length === 0 || !result.rows[0].activo) {
      return res.status(401).json({ error: 'Usuario no válido' });
    }

    const tokens = generarTokens(decoded.id);
    res.json(tokens);
  } catch (err) {
    res.status(401).json({ error: 'Refresh token inválido o expirado' });
  }
};

// GET /auth/me
const perfil = async (req, res) => {
  res.json({ usuario: req.user });
};

module.exports = { registroCliente, registroTecnico, login, refreshToken, perfil };

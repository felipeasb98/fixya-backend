# FixYa — Backend API

Backend para la app FixYa: marketplace de servicios del hogar en Chile.

## Stack

- **Node.js** + **Express** — servidor HTTP
- **PostgreSQL** — base de datos principal
- **Socket.io** — notificaciones en tiempo real
- **JWT** — autenticación stateless
- **bcryptjs** — hash de contraseñas

---

## Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales

# 3. Crear la base de datos en PostgreSQL
createdb fixya_db

# 4. Ejecutar migraciones (crea las tablas)
npm run db:migrate

# 5. Cargar datos de prueba (opcional)
npm run db:seed

# 6. Iniciar en desarrollo
npm run dev
```

---

## Endpoints principales

### Autenticación
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/registro/cliente` | Registro de cliente |
| POST | `/api/auth/registro/tecnico` | Registro de técnico |
| POST | `/api/auth/login` | Login (devuelve JWT) |
| POST | `/api/auth/refresh` | Renovar access token |
| GET  | `/api/auth/me` | Perfil del usuario logueado |

### Solicitudes
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/solicitudes` | Cliente crea solicitud |
| GET  | `/api/solicitudes` | Historial del usuario |
| GET  | `/api/solicitudes/disponibles` | Técnico ve trabajos cercanos |
| GET  | `/api/solicitudes/:id` | Detalle de solicitud |
| PATCH | `/api/solicitudes/:id/estado` | Cambiar estado |

### Postulaciones
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/postulaciones` | Técnico se postula |
| GET  | `/api/postulaciones/:solicitudId` | Cliente ve postulaciones |
| POST | `/api/postulaciones/:id/aceptar` | Cliente acepta técnico |

### Pagos
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/pagos/iniciar` | Cliente inicia pago |
| POST | `/api/pagos/webhook/khipu` | Webhook de confirmación |
| POST | `/api/pagos/liberar` | Cliente libera pago al técnico |
| GET  | `/api/pagos/historial` | Historial del técnico |

### Ratings
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/ratings` | Cliente califica al técnico |

---

## WebSockets (Socket.io)

Conectar con token JWT:
```javascript
const socket = io('http://localhost:3000', {
  auth: { token: 'tu_jwt_aqui' }
});

// Técnico: suscribirse a rubros
socket.emit('suscribir_rubros', ['gasfiteria', 'cerrajeria']);

// Escuchar nuevas solicitudes
socket.on('nueva_solicitud', (data) => { ... });

// Unirse al room de una solicitud
socket.emit('unirse_solicitud', solicitudId);

// GPS tracking (técnico)
socket.emit('ubicacion_tecnico', { solicitudId, latitud, longitud });

// Cliente escucha la ubicación del técnico
socket.on('ubicacion_tecnico', ({ latitud, longitud }) => { ... });
```

---

## Cuentas de prueba (después de `npm run db:seed`)

| Rol | Email | Password |
|-----|-------|----------|
| Cliente | maria@test.com | fixya123 |
| Técnico (Gasfitero · Fundador) | carlos@test.com | fixya123 |
| Técnico (Electricista) | ana@test.com | fixya123 |

---

## Estructura de carpetas

```
fixya-backend/
├── src/
│   ├── config/
│   │   └── db.js              # Pool PostgreSQL
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── solicitudController.js
│   │   ├── postulacionController.js
│   │   ├── pagoController.js
│   │   └── ratingController.js
│   ├── middleware/
│   │   ├── auth.js            # JWT guard
│   │   ├── validate.js        # express-validator helper
│   │   └── rateLimiter.js     # Rate limiting
│   ├── routes/
│   │   ├── auth.js
│   │   ├── solicitudes.js
│   │   ├── postulaciones.js
│   │   ├── pagos.js
│   │   └── ratings.js
│   ├── services/
│   │   └── socketService.js   # Socket.io + GPS tracking
│   └── index.js               # Entry point
├── scripts/
│   ├── migrate.js             # Crear tablas en PostgreSQL
│   └── seed.js                # Datos de prueba
├── .env.example
└── package.json
```

## Deploy en Railway

```bash
# Instalar Railway CLI
npm install -g @railway/cli

# Login y crear proyecto
railway login
railway init

# Agregar PostgreSQL
railway add postgresql

# Setear variables de entorno
railway variables set JWT_SECRET=... NODE_ENV=production

# Deploy
railway up
```

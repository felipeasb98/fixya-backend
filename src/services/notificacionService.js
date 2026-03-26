const { PrismaClient } = require('@prisma/client');
const {
  emitirATecnico,
  emitirAUsuario,
  emitirATecnicosDisponibles,
} = require('./socketService');

const prisma = new PrismaClient();

// ─────────────────────────────────────────────
// Notificar a técnicos disponibles cuando
// se crea una nueva solicitud
// ─────────────────────────────────────────────
async function notificarTecnicos(io, solicitud) {
  // Buscar técnicos disponibles con el rubro correspondiente
  const tecnicos = await prisma.tecnico.findMany({
    where: {
      activo: true,
      disponible: true,
      rubros: { some: { rubroId: solicitud.rubroId } },
    },
    select: { id: true, fcmToken: true, latitud: true, longitud: true },
  });

  if (tecnicos.length === 0) return;

  const tecnicoIds = tecnicos.map(t => t.id);

  // Emitir via Socket.io a los conectados
  emitirATecnicosDisponibles(tecnicoIds, 'nueva:solicitud', {
    solicitudId: solicitud.id,
    codigo: solicitud.codigo,
    trabajo: solicitud.trabajo,
    urgencia: solicitud.urgencia,
    comuna: solicitud.comuna,
    totalEstimado: solicitud.totalEstimado,
    latitud: solicitud.latitud,
    longitud: solicitud.longitud,
  });

  // Guardar notificación en BD para cada técnico
  await prisma.notificacion.createMany({
    data: tecnicoIds.map(id => ({
      destinoId: id,
      destinoTipo: 'tecnico',
      titulo: `Nuevo trabajo: ${solicitud.trabajo}`,
      cuerpo: `${solicitud.urgencia === 'emergencia' ? '🚨 EMERGENCIA · ' : ''}$${Math.round(solicitud.totalEstimado).toLocaleString('es-CL')} · ${solicitud.comuna || 'Sin ubicación'}`,
      tipo: 'nueva_solicitud',
      data: { solicitudId: solicitud.id },
    })),
  });

  // Push notifications (Firebase FCM)
  const tokensConFCM = tecnicos.filter(t => t.fcmToken).map(t => t.fcmToken);
  if (tokensConFCM.length > 0) {
    await enviarPushBatch(tokensConFCM, {
      title: `🔧 Nuevo trabajo disponible`,
      body: `${solicitud.trabajo} · ${solicitud.comuna || ''}`,
      data: { tipo: 'nueva_solicitud', solicitudId: solicitud.id },
    });
  }
}

// ─────────────────────────────────────────────
// Notificar a un usuario específico
// ─────────────────────────────────────────────
async function notificarUsuario(io, usuarioId, payload) {
  // Socket en tiempo real
  emitirAUsuario(usuarioId, `notif:${payload.tipo}`, payload);

  // Guardar en BD
  await prisma.notificacion.create({
    data: {
      destinoId: usuarioId,
      destinoTipo: 'usuario',
      titulo: payload.titulo,
      cuerpo: payload.cuerpo,
      tipo: payload.tipo,
      data: { solicitudId: payload.solicitudId },
    },
  });

  // Push si tiene FCM token
  const usuario = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { fcmToken: true },
  });
  if (usuario?.fcmToken) {
    await enviarPush(usuario.fcmToken, {
      title: payload.titulo,
      body: payload.cuerpo,
      data: { tipo: payload.tipo, solicitudId: payload.solicitudId },
    });
  }
}

// ─────────────────────────────────────────────
// Notificar a un técnico específico
// ─────────────────────────────────────────────
async function notificarTecnico(io, tecnicoId, payload) {
  emitirATecnico(tecnicoId, `notif:${payload.tipo}`, payload);

  await prisma.notificacion.create({
    data: {
      destinoId: tecnicoId,
      destinoTipo: 'tecnico',
      titulo: payload.titulo,
      cuerpo: payload.cuerpo,
      tipo: payload.tipo,
      data: { solicitudId: payload.solicitudId },
    },
  });

  const tecnico = await prisma.tecnico.findUnique({
    where: { id: tecnicoId },
    select: { fcmToken: true },
  });
  if (tecnico?.fcmToken) {
    await enviarPush(tecnico.fcmToken, {
      title: payload.titulo,
      body: payload.cuerpo,
      data: { tipo: payload.tipo, solicitudId: payload.solicitudId },
    });
  }
}

// ─────────────────────────────────────────────
// Firebase FCM — envío de push notification
// ─────────────────────────────────────────────
async function enviarPush(token, { title, body, data = {} }) {
  if (!token) return;
  try {
    const admin = getFirebaseAdmin();
    if (!admin) return;

    await admin.messaging().send({
      token,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } },
    });
  } catch (err) {
    console.error('[FCM] Error enviando push:', err.message);
  }
}

async function enviarPushBatch(tokens, payload) {
  await Promise.allSettled(tokens.map(t => enviarPush(t, payload)));
}

// ─────────────────────────────────────────────
// Singleton Firebase Admin
// ─────────────────────────────────────────────
let _firebaseAdmin;
function getFirebaseAdmin() {
  if (_firebaseAdmin) return _firebaseAdmin;
  if (!process.env.FIREBASE_PROJECT_ID) return null;

  try {
    const admin = require('firebase-admin');
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      });
    }
    _firebaseAdmin = admin;
    return admin;
  } catch (err) {
    console.error('[Firebase] No se pudo inicializar:', err.message);
    return null;
  }
}

module.exports = { notificarTecnicos, notificarUsuario, notificarTecnico };

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middlewares/authenticate');
const { AppError } = require('../utils/AppError');

// Multer en memoria (luego subimos a Firebase Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB max
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new AppError('Solo se permiten imágenes', 422));
    }
    cb(null, true);
  },
});

// POST /api/upload/foto — Subir una foto
router.post('/foto', authenticate, upload.single('foto'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('No se recibió ninguna foto', 400);

    const { tipo } = req.body; // 'problema' | 'trabajo' | 'cierre' | 'avatar' | 'sec'
    const admin = getFirebaseAdmin();

    let url;
    if (admin) {
      // Subir a Firebase Storage
      const bucket = admin.storage().bucket();
      const filename = `${tipo || 'misc'}/${req.user.id}/${Date.now()}_${req.file.originalname}`;
      const file = bucket.file(filename);
      await file.save(req.file.buffer, {
        metadata: { contentType: req.file.mimetype },
        public: true,
      });
      url = `https://storage.googleapis.com/${process.env.FIREBASE_STORAGE_BUCKET}/${filename}`;
    } else {
      // Modo desarrollo: devolver base64
      url = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }

    res.json({ url, tipo });
  } catch (err) { next(err); }
});

// POST /api/upload/fotos — Subir múltiples fotos (máx 4)
router.post('/fotos', authenticate, upload.array('fotos', 4), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) throw new AppError('No se recibieron fotos', 400);

    const admin = getFirebaseAdmin();
    const { tipo } = req.body;
    const urls = [];

    for (const file of req.files) {
      if (admin) {
        const bucket = admin.storage().bucket();
        const filename = `${tipo || 'misc'}/${req.user.id}/${Date.now()}_${file.originalname}`;
        const ref = bucket.file(filename);
        await ref.save(file.buffer, {
          metadata: { contentType: file.mimetype },
          public: true,
        });
        urls.push(`https://storage.googleapis.com/${process.env.FIREBASE_STORAGE_BUCKET}/${filename}`);
      } else {
        urls.push(`data:${file.mimetype};base64,${file.buffer.toString('base64')}`);
      }
    }

    res.json({ urls });
  } catch (err) { next(err); }
});

function getFirebaseAdmin() {
  if (!process.env.FIREBASE_PROJECT_ID) return null;
  try {
    const admin = require('firebase-admin');
    return admin.apps.length > 0 ? admin : null;
  } catch { return null; }
}

module.exports = router;

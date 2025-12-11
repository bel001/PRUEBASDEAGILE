const express = require('express');
const router = express.Router();
const { db, storage } = require('../db/firebase');
const { consultarDni, consultarRuc } = require('../services/dniService');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

// Configuración Multer: Memoria (para subir a Firebase)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF'));
    }
  }
});

const clientesRef = db.collection('clientes');

// GET /clientes
router.get('/', async (req, res) => {
  try {
    const snapshot = await clientesRef.get();
    const lista = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(lista);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /clientes/crear-desde-api (consulta RENIEC/SUNAT)
router.post('/crear-desde-api', async (req, res) => {
  const { tipo, documento, email, telefono } = req.body;

  if (!tipo || !documento) return res.status(400).json({ error: 'Faltan datos' });

  try {
    // 1. Validar duplicados
    const existe = await clientesRef.where('documento', '==', documento).get();
    if (!existe.empty) {
      return res.status(400).json({ error: 'El cliente ya existe' });
    }

    let nombre = '';

    // 2. Obtener Nombre de la API
    if (tipo === 'NATURAL' || tipo === 'DNI') {
      try {
        console.log("🔍 Buscando datos en servicio DNI...");
        const data = await consultarDni(documento);
        nombre = data.nombre || "Nombre Desconocido";
        console.log("📝 Nombre final a guardar:", nombre);
      } catch (apiError) {
        console.error("⚠️ Error servicio DNI:", apiError.message);
        nombre = `Cliente DNI ${documento} (Manual)`;
      }
    } else {
      // Lógica RUC
      try {
        const data = await consultarRuc(documento);
        nombre = data.razonSocial || `Empresa RUC ${documento}`;
      } catch (e) {
        nombre = `Empresa RUC ${documento} (Manual)`;
      }
    }

    const nuevoCliente = {
      tipo,
      nombre,
      documento,
      email: email || '',
      telefono: telefono || '',
      creado_en: new Date().toISOString()
    };

    const docRef = await clientesRef.add(nuevoCliente);
    res.json({ id: docRef.id, ...nuevoCliente, creado: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /clientes - Registro directo manual (sin consultar API externa)
// Ahora soporta FormData y Archivos (declaracion_jurada)
router.post('/', upload.single('declaracion_jurada'), async (req, res) => {
  // Con multer, req.body tiene los campos de texto y req.file el archivo
  const { tipo, documento, nombre, direccion, telefono, email, es_juridica } = req.body;

  // Validaciones
  if (!tipo || !documento || !nombre || !direccion || !telefono) {
    return res.status(400).json({
      error: 'Campos obligatorios: tipo, documento, nombre, direccion, telefono'
    });
  }

  // Validar formato de documento
  if (tipo === 'DNI' && documento.length !== 8) {
    return res.status(400).json({ error: 'DNI debe tener 8 dígitos' });
  }
  if (tipo === 'RUC' && documento.length !== 11) {
    return res.status(400).json({ error: 'RUC debe tener 11 dígitos' });
  }

  try {
    // Verificar duplicados
    const existe = await clientesRef.where('documento', '==', documento).get();
    if (!existe.empty) {
      return res.status(400).json({ error: 'El cliente ya existe con este documento' });
    }

    const nuevoCliente = {
      tipo,
      documento,
      nombre: nombre.toUpperCase(),
      direccion,
      telefono,
      email: email || '',
      email: email || '',
      es_juridica: es_juridica === 'true' || es_juridica === true,
      creado_en: new Date().toISOString()
    };

    // Subir a Firebase Storage si hay archivo
    if (req.file) {
      try {
        const bucket = storage.bucket();
        const filename = `declaraciones/${documento}_${Date.now()}.pdf`;
        const fileUpload = bucket.file(filename);
        const uuidToken = uuidv4();

        await fileUpload.save(req.file.buffer, {
          metadata: {
            contentType: req.file.mimetype,
            metadata: {
              firebaseStorageDownloadTokens: uuidToken
            }
          }
        });

        // Construir URL pública formato Firebase
        // https://firebasestorage.googleapis.com/v0/b/[bucket]/o/[path]?alt=media&token=[token]
        const bucketName = bucket.name;
        const encodedPath = encodeURIComponent(filename);
        const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${uuidToken}`;

        nuevoCliente.declaracion_jurada_url = downloadUrl;
        console.log('✅ Archivo subido a Firebase:', downloadUrl);

      } catch (uploadError) {
        console.error('❌ Error subiendo a Firebase Storage:', uploadError);
        // No fallamos toda la creación, pero avisamos
        nuevoCliente.error_upload = uploadError.message;
      }
    } else {
      nuevoCliente.declaracion_jurada_url = '';
    }

    const docRef = await clientesRef.add(nuevoCliente);
    res.json({ id: docRef.id, ...nuevoCliente, creado: true });

  } catch (err) {
    console.error('Error creando cliente:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /clientes/consulta-externa/:tipo/:documento
// Consulta DNI/RUC sin registrar cliente (solo para auto-completar)
router.get('/consulta-externa/:tipo/:documento', async (req, res) => {
  const { tipo, documento } = req.params;
  console.log(`📡 Consultando ${tipo} ${documento}...`);

  try {
    let datos = {};

    if (tipo === 'DNI') {
      const result = await consultarDni(documento);
      console.log(`✅ DNI Result:`, result);
      datos = {
        nombre: result.nombre || '',
        direccion: result.direccion || '',
        ubicacion: result.ubicacion || ''
      };
    } else if (tipo === 'RUC') {
      const result = await consultarRuc(documento);
      console.log(`✅ RUC Result:`, result);
      datos = {
        nombre: result.razonSocial || '',
        direccion: result.direccion || '',
        estado: result.estado || ''
      };
    } else {
      return res.status(400).json({ error: 'Tipo no soportado' });
    }

    // SIEMPRE devolver 200 OK
    res.json(datos);
  } catch (err) {
    // Devolver datos vacíos en lugar de error 500
    console.error(`❌ Error ${tipo}:`, err.message);
    res.json({ nombre: '', direccion: '' });
  }
});

module.exports = router;

// PUT /clientes/:id - Actualizar datos de cliente
// También soportamos archivo si lo suben al editar
router.put('/:id', upload.single('declaracion_jurada'), async (req, res) => {
  const { id } = req.params;
  const { nombre, direccion, telefono, email, es_juridica } = req.body;

  if (!nombre || !direccion || !telefono) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }

  try {
    const updateData = {
      nombre: nombre.toUpperCase(),
      direccion,
      telefono,
      email: email || '',
      es_juridica: es_juridica === 'true' || es_juridica === true
    };

    if (req.file) {
      try {
        const bucket = storage.bucket();
        // Usamos el documento original (o el nuevo si cambió, pero aqui no tenemos el doc antiguo facilmente a mano salvo que lo busquemos)
        // Usamos el ID del cliente para el nombre del archivo en update
        const filename = `declaraciones/${id}_${Date.now()}.pdf`;
        const fileUpload = bucket.file(filename);
        const uuidToken = uuidv4();

        await fileUpload.save(req.file.buffer, {
          metadata: {
            contentType: req.file.mimetype,
            metadata: {
              firebaseStorageDownloadTokens: uuidToken
            }
          }
        });

        const bucketName = bucket.name;
        const encodedPath = encodeURIComponent(filename);
        const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${uuidToken}`;

        updateData.declaracion_jurada_url = downloadUrl;

      } catch (uploadError) {
        console.error('❌ Error subiendo a Firebase Storage (Update):', uploadError);
      }
    }

    await clientesRef.doc(id).update(updateData);

    res.json({ success: true, message: 'Cliente actualizado correctamente' });
  } catch (err) {
    console.error('Error actualizando cliente:', err);
    res.status(500).json({ error: err.message });
  }
});
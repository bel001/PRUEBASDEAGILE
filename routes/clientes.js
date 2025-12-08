const express = require('express');
const router = express.Router();
const db = require('../db/firebase');
const { consultarDni, consultarRuc } = require('../services/dniService');

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
router.post('/', async (req, res) => {
  const { tipo, documento, nombre, direccion, telefono, email } = req.body;

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
      creado_en: new Date().toISOString()
    };

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
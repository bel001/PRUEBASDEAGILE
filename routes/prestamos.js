const express = require('express');
const router = express.Router();
const db = require('../db/firebase'); // Cambiado a Firebase

const MAX_CUOTAS = 24;
const MAX_MONTO = 20000;

// POST /prestamos - Crear préstamo y sus cuotas
router.post('/', async (req, res) => {
  const { cliente_id, monto_total, num_cuotas } = req.body;

  if (!cliente_id || !monto_total || !num_cuotas) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }
  if (monto_total > MAX_MONTO) return res.status(400).json({ error: 'Monto excede el máximo' });
  if (num_cuotas > MAX_CUOTAS) return res.status(400).json({ error: 'Excede max cuotas' });

  try {
    // 1. Verificar si el cliente existe
    const clienteRef = db.collection('clientes').doc(cliente_id);
    const clienteSnap = await clienteRef.get();
    if (!clienteSnap.exists) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // 2. Verificar si ya tiene préstamo activo (no cancelado)
    const activos = await db.collection('prestamos')
      .where('cliente_id', '==', cliente_id)
      .where('cancelado', '==', false)
      .get();

    if (!activos.empty) {
      return res.status(400).json({ error: 'El cliente ya tiene un préstamo activo' });
    }

    // 3. Preparar escritura en lote (Batch) para que sea todo o nada
    const batch = db.batch();

    // Crear referencia del nuevo préstamo
    const prestamoRef = db.collection('prestamos').doc();
    const fechaInicio = new Date();

    const monto_cuota = Number((monto_total / num_cuotas).toFixed(2));

    // Guardar datos del préstamo
    batch.set(prestamoRef, {
      cliente_id,
      monto_total,
      num_cuotas,
      monto_por_cuota: monto_cuota,
      fecha_inicio: fechaInicio.toISOString().split('T')[0],
      cancelado: false, // Bandera para saber si ya pagó todo
      creado_en: new Date().toISOString()
    });

    const cronograma = [];

    // 4. Generar Cuotas con EXACTAMENTE 30 días entre cada una
    for (let i = 1; i <= num_cuotas; i++) {
      // Calcular fecha: fecha_inicio + (i * 30 días)
      const diasDesdeInicio = i * 30;
      const fecha_vencimiento_date = new Date(fechaInicio);
      fecha_vencimiento_date.setDate(fecha_vencimiento_date.getDate() + diasDesdeInicio);
      const fecha_vencimiento = fecha_vencimiento_date.toISOString().split('T')[0];

      const cuotaRef = db.collection('cuotas').doc(); // ID automático
      const dataCuota = {
        prestamo_id: prestamoRef.id,
        cliente_id: cliente_id, // Para búsquedas rápidas
        numero_cuota: i,
        fecha_vencimiento,
        monto_cuota,
        saldo_pendiente: monto_cuota,
        pagada: false
      };

      batch.set(cuotaRef, dataCuota);

      cronograma.push({ cuota_id: cuotaRef.id, ...dataCuota });
    }

    // Ejecutar todo junto
    await batch.commit();

    res.json({
      prestamo_id: prestamoRef.id,
      mensaje: 'Préstamo creado correctamente',
      cronograma
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /prestamos/cliente/:cliente_id
router.get('/cliente/:cliente_id', async (req, res) => {
  try {
    const { cliente_id } = req.params;

    // Buscar préstamo activo del cliente
    const prestamosSnap = await db.collection('prestamos')
      .where('cliente_id', '==', cliente_id)
      .where('cancelado', '==', false) // Solo activos
      .limit(1)
      .get();

    if (prestamosSnap.empty) {
      return res.status(404).json({ error: 'El cliente no tiene préstamo activo' });
    }

    const docPrestamo = prestamosSnap.docs[0];
    const prestamo = { id: docPrestamo.id, ...docPrestamo.data() };

    // Buscar las cuotas de ese préstamo
    const cuotasSnap = await db.collection('cuotas')
      .where('prestamo_id', '==', prestamo.id)
      .get(); // Firestore no ordena fácil por número sin índices, lo ordenamos en JS

    const cuotas = cuotasSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => a.numero_cuota - b.numero_cuota);

    // Obtener datos del cliente para completar (opcional)
    const clienteSnap = await db.collection('clientes').doc(cliente_id).get();
    const clienteData = clienteSnap.exists ? clienteSnap.data() : {};

    res.json({
      prestamo: {
        ...prestamo,
        cliente_nombre: clienteData.nombre,
        cliente_documento: clienteData.documento,
        cliente_email: clienteData.email
      },
      cuotas
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
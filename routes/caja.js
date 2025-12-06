const express = require('express');
const router = express.Router();
const db = require('../db/firebase');

const cajaRef = db.collection('cierre_caja');

// Helper: Obtener última caja
async function obtenerUltimaCaja() {
  const snapshot = await cajaRef.orderBy('fecha', 'desc').limit(1).get();
  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

// POST /caja/apertura
router.post('/apertura', async (req, res) => {
  const { monto_inicial } = req.body;
  if (monto_inicial == null) return res.status(400).json({ error: 'Falta monto_inicial' });

  try {
    const ultima = await obtenerUltimaCaja();
    if (ultima && !ultima.cerrado) {
      return res.status(400).json({ error: 'Ya hay una caja abierta' });
    }

    const nuevaCaja = {
      fecha: new Date().toISOString(),
      monto_inicial: Number(monto_inicial),
      cerrado: false,
      total_sistema: 0,
      diferencia: 0
    };

    const docRef = await cajaRef.add(nuevaCaja);
    res.json({ id: docRef.id, ...nuevaCaja });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /caja/resumen-actual (Cálculo manual porque Firestore no tiene SUM)
router.get('/resumen-actual', async (req, res) => {
  try {
    const ultima = await obtenerUltimaCaja();
    if (!ultima) return res.status(404).json({ error: 'No hay caja' });
    if (ultima.cerrado) return res.status(400).json({ error: 'La caja está cerrada' });

    // Buscar pagos desde la fecha de apertura
    // Nota: Comparar cadenas ISO funciona bien
    const pagosSnap = await db.collection('pagos')
      .where('fecha_pago', '>=', ultima.fecha)
      .get();

    let totales = { EFECTIVO: 0, TARJETA: 0, YAPE: 0, PLIN: 0 };

    pagosSnap.forEach(doc => {
      const p = doc.data();
      if (totales[p.medio_pago] !== undefined) {
        totales[p.medio_pago] += Number(p.monto_pagado);
      }
    });

    const total_ingresos = Object.values(totales).reduce((a, b) => a + b, 0);
    const total_teorico = ultima.monto_inicial + total_ingresos;

    res.json({
      caja_id: ultima.id,
      monto_inicial: ultima.monto_inicial,
      ...totales,
      total_teorico
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /caja/cierre
router.post('/cierre', async (req, res) => {
  const { total_real } = req.body;
  if (total_real == null) return res.status(400).json({ error: 'Falta total_real' });

  try {
    const ultima = await obtenerUltimaCaja();
    if (!ultima || ultima.cerrado) return res.status(400).json({ error: 'No hay caja abierta' });

    // Recalcular totales (mismo código que resumen)
    const pagosSnap = await db.collection('pagos')
      .where('fecha_pago', '>=', ultima.fecha)
      .get();
      
    let total_sistema = 0;
    pagosSnap.forEach(doc => total_sistema += Number(doc.data().monto_pagado));

    const total_teorico = ultima.monto_inicial + total_sistema;
    const diferencia = Number(total_real) - total_teorico;

    // Actualizar caja a cerrada
    await cajaRef.doc(ultima.id).update({
      cerrado: true,
      fecha_cierre: new Date().toISOString(),
      total_sistema,
      total_real: Number(total_real),
      diferencia
    });

    res.json({ mensaje: 'Caja cerrada', diferencia });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
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
      const monto = Number(p.monto_pagado);
      if (totales[p.medio_pago] !== undefined) {
        totales[p.medio_pago] += monto;
      }
    });

    // Separar TOTAL (Banco + Caja)
    const total_ingresos_arr = Object.values(totales).reduce((a, b) => a + b, 0);

    // Calcular Saldo Teórico EN CAJÓN (Solo Efectivo)
    const saldo_teorico_cajon = ultima.monto_inicial + totales.EFECTIVO;

    // Calcular Saldo EN BANCO (Yape + Plin + Tarjeta)
    const saldo_banco = totales.YAPE + totales.PLIN + totales.TARJETA;

    res.json({
      caja_id: ultima.id,
      monto_inicial: ultima.monto_inicial,
      ...totales, // Desglose por medio
      total_ingresos: total_ingresos_arr,
      saldo_teorico_cajon, // Esto es lo que debe haber físico
      saldo_banco // Esto está en cuentas
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /caja/cierre
router.post('/cierre', async (req, res) => {
  const { total_real_efectivo } = req.body; // AHORA SOLO PIDE EL EFECTIVO REAL
  if (total_real_efectivo == null) return res.status(400).json({ error: 'Falta total_real_efectivo (Monto en cajón)' });

  try {
    const ultima = await obtenerUltimaCaja();
    if (!ultima || ultima.cerrado) return res.status(400).json({ error: 'No hay caja abierta' });

    // Recalcular totales
    const pagosSnap = await db.collection('pagos')
      .where('fecha_pago', '>=', ultima.fecha)
      .get();

    let total_efectivo_sistema = 0;
    let total_digital_sistema = 0;

    pagosSnap.forEach(doc => {
      const p = doc.data();
      if (p.medio_pago === 'EFECTIVO') {
        total_efectivo_sistema += Number(p.monto_pagado);
      } else {
        total_digital_sistema += Number(p.monto_pagado);
      }
    });

    // EL CUADRE SOLO ES CONTRA EL EFECTIVO
    const saldo_teorico_cajon = ultima.monto_inicial + total_efectivo_sistema;

    // Diferencia (Sobrante o Faltante en efectivo)
    const diferencia = Number((Number(total_real_efectivo) - saldo_teorico_cajon).toFixed(2));

    // RN3: Si las operaciones no cuadran, no permite cerrar
    // "No cuadran" implica diferencia != 0. 
    // Considerando punto flotante, usamos un epsilon muy pequeño o comparamos estricto.
    if (diferencia !== 0) {
      return res.status(400).json({
        error: 'La caja no cuadra. No se puede realizar el cierre.',
        detalle: {
          esperado: saldo_teorico_cajon,
          real: Number(total_real_efectivo),
          diferencia: diferencia
        }
      });
    }

    // Actualizar caja a cerrada
    await cajaRef.doc(ultima.id).update({
      cerrado: true,
      fecha_cierre: new Date().toISOString(),
      monto_final_sistema: saldo_teorico_cajon, // Lo que el sistema dice que debe haber en cajón
      monto_final_real: Number(total_real_efectivo), // Lo que contó el cajero
      diferencia: diferencia,
      total_ventas_efectivo: total_efectivo_sistema,
      total_ventas_digital: total_digital_sistema
    });

    res.json({
      mensaje: 'Caja cerrada correctamente',
      diferencia,
      saldo_teorico_cajon,
      monto_real_ingresado: Number(total_real_efectivo)
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

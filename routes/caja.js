const express = require('express');
const router = express.Router();
const { db } = require('../db/firebase');
const { getSystemDate } = require('../utils/dateHelper');

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
    // Validar si YA EXISTE una caja (abierta o cerrada) con fecha de HOY
    // Usamos el inicio del día para la consulta
    const hoyInicio = getSystemDate();
    hoyInicio.setHours(0, 0, 0, 0);
    const hoyISO = hoyInicio.toISOString();

    const chequeoHoy = await cajaRef
      .where('fecha', '>=', hoyISO)
      .get();

    if (!chequeoHoy.empty) {
      return res.status(400).json({ error: 'Ya se aperturo la caja el día de hoy' });
    }

    const ultima = await obtenerUltimaCaja();
    if (ultima && !ultima.cerrado) {
      return res.status(400).json({ error: 'Ya hay una caja abierta (de un día anterior sin cerrar)' });
    }

    const nuevaCaja = {
      fecha: getSystemDate().toISOString(),
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

    // Calcular límite superior (final del día de apertura + buffer o simplemente start of next day)
    // Para asegurar que no traiga pagos de "futuros días" si viajamos al pasado.
    const fechaApertura = new Date(ultima.fecha);
    const fechaLimite = new Date(fechaApertura);
    fechaLimite.setDate(fechaLimite.getDate() + 1);
    fechaLimite.setHours(0, 0, 0, 0); // Inicio del día siguiente
    // Ajuste por si la apertura fue muy cerca del cambio de día, mejor dar margen hasta fin del día de la fecha de apertura
    // Mejor: tomamos la fecha de apertura, le sumamos 1 día calendario y cortamos a las 00:00.

    // Buscar pagos desde la fecha de apertura hasta el limite del día
    console.log(`🔍 [Resumen Caja] Apertura: ${ultima.fecha} | Límite: ${fechaLimite.toISOString()}`);

    const pagosSnap = await db.collection('pagos')
      .where('fecha_pago', '>=', ultima.fecha)
      .where('fecha_pago', '<', fechaLimite.toISOString())
      .get();

    console.log(`🔍 [Resumen Caja] Pagos encontrados: ${pagosSnap.size}`);

    // Solo se manejan dos grupos: EFECTIVO y FLOW (digital)
    let totales = { EFECTIVO: 0, FLOW: 0 };

    pagosSnap.forEach(doc => {
      const p = doc.data();
      console.log(`   - Pago: ${p.monto_pagado} (${p.medio_pago}) fecha: ${p.fecha_pago}`);
      const monto = Number(p.monto_pagado);
      if (p.medio_pago === 'EFECTIVO') {
        totales.EFECTIVO += monto;
      } else {
        totales.FLOW += monto;
      }
    });

    // Separar TOTAL (Banco + Caja)
    const total_ingresos_arr = Object.values(totales).reduce((a, b) => a + b, 0);

    // Calcular Saldo Teórico EN CAJÓN (Solo Efectivo)
    const saldo_teorico_cajon = ultima.monto_inicial + totales.EFECTIVO;

    // Calcular Saldo EN BANCO (todo lo digital = FLOW)
    const saldo_banco = totales.FLOW;

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

    // Recalcular totales con el mismo limite
    const fechaApertura = new Date(ultima.fecha);
    const fechaLimite = new Date(fechaApertura);
    fechaLimite.setDate(fechaLimite.getDate() + 1);
    fechaLimite.setHours(0, 0, 0, 0);

    const pagosSnap = await db.collection('pagos')
      .where('fecha_pago', '>=', ultima.fecha)
      .where('fecha_pago', '<', fechaLimite.toISOString())
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
      fecha_cierre: getSystemDate().toISOString(),
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

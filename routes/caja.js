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

// GET /caja/movimientos-sesion - Historial de billetes/monedas (Entrada/Salida) en la sesión actual
router.get('/movimientos-sesion', async (req, res) => {
  try {
    const ultima = await obtenerUltimaCaja();
    if (!ultima || ultima.cerrado) return res.status(404).json({ error: 'No hay caja abierta' });

    // Buscar movimientos desde la fecha de apertura
    // Solo nos interesa ENTRADA (Recibido) y SALIDA (Vuelto) que se guardan en 'movimientos_caja'
    // Esto fue implementado en pagos.js cuando se paga en EFECTIVO

    // Obtener fecha límite (fin de la sesión o ahora)
    const fechaApertura = ultima.fecha;

    // Buscamos en la colección 'movimientos_caja' (creada en services/cajaService.js)
    const movimientosSnap = await db.collection('movimientos_caja')
      .where('fecha', '>=', fechaApertura)
      .orderBy('fecha', 'desc')
      .get();

    const movimientos = movimientosSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(movimientos);

  } catch (err) {
    console.error("Error obteniendo movimientos caja:", err);
    res.status(500).json({ error: err.message });
  }
});

const { registrarMovimientoCaja } = require('../services/cajaService');

// POST /caja/movimiento - Inyección o Retiro manual
router.post('/movimiento', async (req, res) => {
  const { tipo, monto, descripcion } = req.body;
  if (!['ENTRADA', 'SALIDA'].includes(tipo) || !monto || !descripcion) {
    return res.status(400).json({ error: 'Faltan datos (tipo, monto, descripcion)' });
  }

  try {
    const ultima = await obtenerUltimaCaja();
    if (!ultima || ultima.cerrado) return res.status(400).json({ error: 'Debe abrir caja primero' });

    // Registrar
    await registrarMovimientoCaja(tipo, monto, `${tipo} MANUAL: ${descripcion}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /caja/resumen-actual (Cálculo basado en movimientos físicos)
router.get('/resumen-actual', async (req, res) => {
  try {
    const ultima = await obtenerUltimaCaja();
    if (!ultima) return res.status(404).json({ error: 'No hay caja' });
    if (ultima.cerrado) return res.status(400).json({ error: 'La caja está cerrada' });

    const fechaApertura = ultima.fecha;
    const fechaLimite = new Date(new Date(fechaApertura).setDate(new Date(fechaApertura).getDate() + 1)).toISOString();

    // 1. Obtener movimientos FÍSICOS (incluye pagos efectivos, inyecciones, retiros y vueltos)
    const movsSnap = await db.collection('movimientos_caja')
      .where('fecha', '>=', fechaApertura)
      .where('fecha', '<', fechaLimite)
      .get();

    let saldo_teorico_cajon = ultima.monto_inicial;
    let entradas_efectivo = 0;
    let salidas_efectivo = 0;

    movsSnap.forEach(doc => {
      const m = doc.data();
      if (m.tipo === 'ENTRADA') {
        saldo_teorico_cajon += m.monto;
        entradas_efectivo += m.monto;
      } else if (m.tipo === 'SALIDA') {
        saldo_teorico_cajon -= m.monto;
        salidas_efectivo += m.monto;
      }
    });

    // 2. Obtener Pagos Digitales (FLOW) para el reporte
    const pagosSnap = await db.collection('pagos')
      .where('fecha_pago', '>=', fechaApertura)
      .where('fecha_pago', '<', fechaLimite)
      .get();

    let saldo_banco = 0;
    pagosSnap.forEach(doc => {
      const p = doc.data();
      if (p.medio_pago !== 'EFECTIVO') {
        saldo_banco += p.monto_pagado;
      }
    });

    res.json({
      caja_id: ultima.id,
      monto_inicial: ultima.monto_inicial,
      EFECTIVO: saldo_teorico_cajon, // Esto es el saldo actual disponible
      FLOW: saldo_banco,
      entradas_efectivo,
      salidas_efectivo,
      saldo_teorico_cajon,
      saldo_banco
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

const express = require('express');
const router = express.Router();
const { db } = require('../db/firebase'); // Cambiado a Firebase
const { recalcularPrestamoDesdeCuotas } = require('../services/pagosService');

const MAX_CUOTAS = 24;
const MAX_MONTO = 20000;

// POST /prestamos - Crear préstamo y sus cuotas
router.post('/', async (req, res) => {
  const { cliente_id, monto_capital, num_cuotas, tea } = req.body;

  if (!cliente_id || !monto_capital || !num_cuotas || tea == null) {
    return res.status(400).json({ error: 'Faltan datos obligatorios (Capital, Cuotas, TEA)' });
  }
  if (monto_capital > MAX_MONTO) return res.status(400).json({ error: 'Capital excede el máximo' });
  if (num_cuotas > MAX_CUOTAS) return res.status(400).json({ error: 'Excede max cuotas' });

  try {
    // 1. Verificar si el cliente existe
    const clienteRef = db.collection('clientes').doc(cliente_id);
    const clienteSnap = await clienteRef.get();
    if (!clienteSnap.exists) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // 2. Verificar si ya tiene préstamo activo
    const activos = await db.collection('prestamos')
      .where('cliente_id', '==', cliente_id)
      .where('cancelado', '==', false)
      .get();
    if (!activos.empty) {
      return res.status(400).json({ error: 'El cliente ya tiene un préstamo activo' });
    }

    // 3. Cálculos Financieros (Método Francés / Cuota Fija)
    // Convertir TEA a TEM
    // Fórmula: TEM = (1 + TEA%)^(1/12) - 1
    const teaDecimal = Number(tea) / 100;
    const temDecimal = Math.pow(1 + teaDecimal, 1 / 12) - 1;

    const capital = Number(monto_capital);
    const n = Number(num_cuotas);

    // Calcular Cuota Fija (R)
    // R = P * [ i(1+i)^n ] / [ (1+i)^n - 1 ]
    // Si la tasa es 0 (caso raro), cuota = P / n
    let monto_cuota;
    if (temDecimal === 0) {
      monto_cuota = capital / n;
    } else {
      const factor = Math.pow(1 + temDecimal, n);
      monto_cuota = capital * ((temDecimal * factor) / (factor - 1));
    }

    // Redondeamos la cuota a 2 decimales para cobro, pero ojo que esto genera pequeñas diferencias al final
    // Para exactitud financiera, se suele ajustar la última cuota, pero por simplicidad de este sistema:
    monto_cuota = Number(monto_cuota.toFixed(2));

    // El monto total a pagar por el cliente será Cuota * N
    const monto_total = Number((monto_cuota * n).toFixed(2));

    // 4. Preparar Batch
    const batch = db.batch();
    const prestamoRef = db.collection('prestamos').doc();

    // USAR FECHA PROPORCIONADA O DEFAULT A HOY
    let fechaInicio;
    if (req.body.fecha_inicio) {
      // Asumimos formato YYYY-MM-DD. Le agregamos T12:00:00 para evitar problemas de timezone
      fechaInicio = new Date(req.body.fecha_inicio + 'T12:00:00');
    } else {
      fechaInicio = new Date();
    }

    // Guardar Préstamo
    batch.set(prestamoRef, {
      cliente_id,
      monto_capital: capital,
      tea: Number(tea), // %
      tem: Number((temDecimal * 100).toFixed(4)), // % (guardamos con 4 decimales para referencia)
      monto_total,     // Deuda Total (Capital + Intereses)
      num_cuotas,
      monto_por_cuota: monto_cuota,
      fecha_inicio: fechaInicio.toISOString().split('T')[0],
      cancelado: false,
      saldo_restante: monto_total, // IMPORTANTE: Inicializar saldo_restante
      monto_pagado_total: 0,
      estado: 'PENDIENTE',
      creado_en: new Date().toISOString()
    });

    // 5. Generar Cronograma (Amortización)
    const cronograma = [];
    let saldo_pendiente = capital;

    for (let i = 1; i <= n; i++) {
      // Interés del periodo
      let interes = saldo_pendiente * temDecimal;

      // Amortización (Capital que se paga en esta cuota)
      let amortizacion = monto_cuota - interes;

      saldo_pendiente -= amortizacion;
      if (saldo_pendiente < 0) saldo_pendiente = 0; // Evitar negativos por redondeo

      // Calcular fecha de vencimiento (cada 30 días)
      const fechaVenc = new Date(fechaInicio);
      fechaVenc.setDate(fechaInicio.getDate() + (i * 30));
      const fecha_vencimiento = fechaVenc.toISOString().split('T')[0];

      const cuotaRef = db.collection('cuotas').doc();
      const dataCuota = {
        prestamo_id: prestamoRef.id,
        cliente_id: cliente_id,
        numero_cuota: i,
        fecha_vencimiento,
        monto_cuota: monto_cuota,   // Valor fijo a pagar
        interes_calculado: Number(interes.toFixed(2)),
        amortizacion_capital: Number(amortizacion.toFixed(2)),
        saldo_pendiente: monto_cuota, // Inicialmente debe todo el monto de la cuota
        saldo_capital_restante: Number(saldo_pendiente.toFixed(2)), // Referencial
        pagada: false
      };

      batch.set(cuotaRef, dataCuota);
      cronograma.push({ cuota_id: cuotaRef.id, ...dataCuota });
    }

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


    // Recalcular saldo/estado del pr?stamo y sincronizar campos
    const resumenPrestamo = await recalcularPrestamoDesdeCuotas(db, prestamo.id);

    // Historial de pagos del pr?stamo (para mostrar parcialidades)
    const pagosSnap = await db.collection('pagos')
      .where('prestamo_id', '==', prestamo.id)
      .get();

    const pagosPrestamo = pagosSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => new Date(b.fecha_pago) - new Date(a.fecha_pago));

    // Obtener datos del cliente para completar (opcional)
    const clienteSnap = await db.collection('clientes').doc(cliente_id).get();
    const clienteData = clienteSnap.exists ? clienteSnap.data() : {};

    res.json({
      prestamo: {
        ...prestamo,
        saldo_restante: resumenPrestamo.saldoRestante,
        monto_pagado_total: resumenPrestamo.montoPagadoTotal,
        estado: resumenPrestamo.estado,
        cliente_nombre: clienteData.nombre,
        cliente_documento: clienteData.documento,
        cliente_email: clienteData.email
      },
      cuotas,
      pagos: pagosPrestamo
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
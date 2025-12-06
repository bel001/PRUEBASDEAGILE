const express = require('express');
const router = express.Router();
const db = require('../db/firebase'); // Conexión Firebase
const { aplicarRedondeo } = require('../services/pagoService');
const { calcularMora, esVencida } = require('../services/moraService');
const { enviarComprobanteEmail } = require('../services/emailService');

// Helper: Verificar si la caja está abierta
async function cajaAbiertaHoy() {
  const snapshot = await db.collection('cierre_caja')
    .orderBy('fecha', 'desc')
    .limit(1)
    .get();
    
  if (snapshot.empty) return false;
  const caja = snapshot.docs[0].data();
  return caja.cerrado === false; // En Firebase guardamos booleanos como true/false
}

// POST /pagos
router.post('/', async (req, res) => {
  const { cuota_id, monto_pagado, medio_pago, canal_comprobante, email } = req.body;

  if (!cuota_id || !monto_pagado || !medio_pago) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }

  try {
    // 1. Validar Caja
    const abierta = await cajaAbiertaHoy();
    if (!abierta) return res.status(400).json({ error: 'La caja está cerrada' });

    // 2. Obtener Cuota
    const cuotaRef = db.collection('cuotas').doc(cuota_id);
    const cuotaSnap = await cuotaRef.get();

    if (!cuotaSnap.exists) return res.status(404).json({ error: 'Cuota no encontrada' });
    const cuota = cuotaSnap.data();

    // 3. Cálculos matemáticos (igual que antes)
    const vencida = esVencida(cuota.fecha_vencimiento);
    const mora = calcularMora(cuota.saldo_pendiente, vencida);
    const total_debido = cuota.saldo_pendiente + mora;

    if (monto_pagado > total_debido) {
      return res.status(400).json({ error: 'El pago excede la deuda', total_debido });
    }

    const { montoCobrar, ajuste } = aplicarRedondeo(monto_pagado, medio_pago);
    const nuevo_saldo = Math.max(0, Number((cuota.saldo_pendiente - montoCobrar).toFixed(2)));
    const pagada = nuevo_saldo <= 0;

    // 4. Escritura en Lote (Batch) para seguridad
    const batch = db.batch();

    // A) Crear Pago
    const pagoRef = db.collection('pagos').doc();
    const pagoId = pagoRef.id;
    const pagoData = {
      cuota_id,
      fecha_pago: new Date().toISOString(),
      monto_pagado: montoCobrar,
      medio_pago,
      redondeo_ajuste: ajuste,
      monto_recibido: monto_pagado
    };
    batch.set(pagoRef, pagoData);

    // B) Actualizar Cuota
    batch.update(cuotaRef, { 
      saldo_pendiente: nuevo_saldo, 
      pagada: pagada 
    });

    // C) Crear Comprobante
    // Primero necesitamos datos del cliente
    // Nota: En Firebase lo ideal es guardar nombre del cliente en la cuota para no hacer tantas lecturas,
    // pero aquí lo buscaremos manual.
    let clienteNombre = "Cliente";
    let clienteEmail = email;

    // Ejecutamos el batch
    await batch.commit();

    // 5. Enviar Email (Opcional, fuera del proceso crítico)
    if (canal_comprobante === 'EMAIL' && clienteEmail) {
       // Aquí iría tu lógica de email, la dejamos pendiente para no bloquear
       console.log("Simulando envío de email a:", clienteEmail);
    }

    res.json({
      pago_id: pagoId,
      monto_cobrado: montoCobrar,
      nuevo_saldo,
      cuota_pagada: pagada,
      comprobante: { serie: 'F001', numero: pagoId.substring(0,8) }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /pagos/historial/:cuota_id
router.get('/historial/:cuota_id', async (req, res) => {
  try {
    const snapshot = await db.collection('pagos')
      .where('cuota_id', '==', req.params.cuota_id)
      .get(); // Firestore no ordena por fecha sin índice compuesto, lo ordenamos aquí
      
    const pagos = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => new Date(b.fecha_pago) - new Date(a.fecha_pago));

    res.json(pagos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
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

    // 3. VALIDACIÓN: Las cuotas deben pagarse EN ORDEN
    if (cuota.numero_cuota > 1) {
      try {
        // Verificar que la cuota anterior esté pagada
        const cuotasAnteriores = await db.collection('cuotas')
          .where('prestamo_id', '==', cuota.prestamo_id)
          .where('numero_cuota', '<', cuota.numero_cuota)
          .get();

        const hayImpagadas = cuotasAnteriores.docs.some(doc => {
          const c = doc.data();
          return c.pagada === false;
        });

        if (hayImpagadas) {
          return res.status(400).json({
            error: `⚠️ Debe pagar las cuotas en orden. Complete primero la cuota anterior (cuota ${cuota.numero_cuota - 1}).`
          });
        }
      } catch (indexError) {
        // Si falla la consulta por falta de índice, mostrar mensaje amigable
        console.error('Error validación orden de cuotas:', indexError.message);
        return res.status(400).json({
          error: `⚠️ Debe pagar las cuotas en orden. Esta es la cuota #${cuota.numero_cuota}. Verifique que las cuotas anteriores estén pagadas.`
        });
      }
    }

    // 4. Lógica de Mora y Pagos Parciales (RF5, RN1)
    const vencida = esVencida(cuota.fecha_vencimiento);
    const moraCalculada = calcularMora(cuota.saldo_pendiente, vencida);
    const total_con_mora = cuota.saldo_pendiente + moraCalculada;

    // Determinar cómo se aplica el pago
    let abono_capital = 0;
    let abono_mora = 0;
    let mora_pagada_actualmente = 0;

    if (monto_pagado >= total_con_mora) {
      // PAGO TOTAL (o mayor): Cubre Mora + Capital
      // RN: Si paga todo, se cobra la mora.
      abono_mora = moraCalculada;
      abono_capital = cuota.saldo_pendiente; // Se cancela todo el saldo
      mora_pagada_actualmente = moraCalculada;
    } else {
      // PAGO PARCIAL: Se anula la mora del mes (RF5)
      // Todo el dinero va a capital (saldo_pendiente)
      abono_mora = 0; // Mora condonada/anulada por pago parcial
      // El pago no puede exceder el capital (aunque ya validamos arriba, por seguridad)
      abono_capital = Math.min(monto_pagado, cuota.saldo_pendiente);
      mora_pagada_actualmente = 0;

      // NOTA: RN1 dice "Si el cliente hace cualquier pago parcial... la mora se anula".
      // Por eso cobramos 0 de mora y todo a capital.
    }

    // Validar exceso (aunque con la lógica de arriba abono_capital se ajusta, 
    // validamos que no paguen más de la cuenta si es pago total estricto)
    // Pero permitimos redondeo hacia arriba en efectivo, así que el "cambio" se maneja en frontend o caja chica?
    // RF7: "El sistema debe registrar el monto final efectivamente ingresado" -> monto_real_recibido
    // Aquí asumimos monto_pagado es lo procesado.

    const { montoCobrar, ajuste } = aplicarRedondeo(monto_pagado, medio_pago);

    // Recalcular distribucion con montoCobrar (agregando ajuste si efectivo)
    // Si hubo redondeo, el montoCobrar es el oficial. Re-aplicamos lógica distribución.

    // RE-CALCULO FINAL CON MONTO REDONDEADO
    if (montoCobrar >= total_con_mora) {
      abono_mora = moraCalculada;
      abono_capital = cuota.saldo_pendiente;
    } else {
      abono_mora = 0;
      abono_capital = Math.min(montoCobrar, cuota.saldo_pendiente);
    }

    const nuevo_saldo = Number((cuota.saldo_pendiente - abono_capital).toFixed(2));
    const pagada = nuevo_saldo <= 0; // Se considera pagada si saldo capital es 0

    // 4. Escritura en Lote
    const batch = db.batch();

    // A) Crear Pago
    const pagoRef = db.collection('pagos').doc();
    const pagoId = pagoRef.id;
    const pagoData = {
      cuota_id,
      fecha_pago: new Date().toISOString(),
      monto_pagado: montoCobrar, // Monto oficial sistema
      monto_recibido: monto_pagado, // Monto físico
      medio_pago,
      redondeo_ajuste: ajuste,
      desglose: {
        capital: abono_capital,
        mora: abono_mora
      }
    };
    batch.set(pagoRef, pagoData);

    // B) Actualizar Cuota
    batch.update(cuotaRef, {
      saldo_pendiente: nuevo_saldo,
      pagada: pagada
      // No guardamos 'mora_acumulada' porque se recalcula cada vez o se anula.
    });

    // C) Crear Comprobante
    // Primero necesitamos datos del cliente
    // Nota: En Firebase lo ideal es guardar nombre del cliente en la cuota para no hacer tantas lecturas,
    // pero aquí lo buscaremos manual.
    let clienteNombre = "Cliente";
    let clienteEmail = email;

    // Ejecutamos el batch
    await batch.commit();

    // 5. Verificar si TODAS las cuotas del préstamo están pagadas
    // Si es así, marcar el préstamo como cancelado para permitir nuevos préstamos
    if (pagada) {
      const prestamo_id = cuota.prestamo_id;
      const cuotasSnapshot = await db.collection('cuotas')
        .where('prestamo_id', '==', prestamo_id)
        .get();

      const todasPagadas = cuotasSnapshot.docs.every(doc => {
        const c = doc.data();
        // La cuota actual ya está actualizada localmente, verificamos por ID
        if (doc.id === cuota_id) return true; // Esta ya la pagamos
        return c.pagada === true;
      });

      if (todasPagadas) {
        // Marcar préstamo como CANCELADO (terminado)
        await db.collection('prestamos').doc(prestamo_id).update({
          cancelado: true,
          fecha_cancelacion: new Date().toISOString()
        });
        console.log(`✅ Préstamo ${prestamo_id} marcado como cancelado - todas las cuotas pagadas`);
      }
    }

    // 6. Enviar Email (Opcional, fuera del proceso crítico)
    if (canal_comprobante === 'EMAIL' && clienteEmail) {
      // Aquí iría tu lógica de email, la dejamos pendiente para no bloquear
      console.log("Simulando envío de email a:", clienteEmail);
    }

    res.json({
      pago_id: pagoId,
      monto_cobrado: montoCobrar,
      nuevo_saldo,
      cuota_pagada: pagada,
      comprobante: { serie: 'F001', numero: pagoId.substring(0, 8) }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /pagos/anular (NUEVO)
router.post('/anular', async (req, res) => {
  const { pago_id, usuario_solicitante } = req.body;

  if (!pago_id) return res.status(400).json({ error: 'Falta ID del pago' });

  try {
    const pagoRef = db.collection('pagos').doc(pago_id);
    const pagoSnap = await pagoRef.get();

    if (!pagoSnap.exists) return res.status(404).json({ error: 'Pago no encontrado' });
    const pago = pagoSnap.data();

    // Validar si ya está anulado
    if (pago.estado === 'ANULADO') {
      return res.status(400).json({ error: 'El pago ya está anulado' });
    }

    // Obtener cuota para revertir saldo
    const cuotaRef = db.collection('cuotas').doc(pago.cuota_id);
    const cuotaSnap = await cuotaRef.get();

    if (!cuotaSnap.exists) return res.status(404).json({ error: 'Cuota asociada no encontrada' });
    const cuota = cuotaSnap.data();

    // Nueva lógica de reversión
    const montoAnulado = Number(pago.monto_pagado);
    const nuevoSaldo = Number((cuota.saldo_pendiente + montoAnulado).toFixed(2));

    const batch = db.batch();

    // 1. Marcar pago como ANULADO
    batch.update(pagoRef, {
      estado: 'ANULADO',
      anulado_por: usuario_solicitante,
      fecha_anulacion: new Date().toISOString()
    });

    // 2. Revertir saldo en cuota
    // Si la cuota ya estaba pagada, ahora volverá a ser PENDIENTE (pagada: false)
    batch.update(cuotaRef, {
      saldo_pendiente: nuevoSaldo,
      pagada: false
    });

    await batch.commit();

    res.json({ mensaje: 'Pago anulado correctamente', nuevo_saldo: nuevoSaldo });

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
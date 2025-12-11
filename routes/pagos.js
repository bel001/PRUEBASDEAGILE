const express = require('express');
const router = express.Router();
const { db } = require('../db/firebase'); // Conexión Firebase
const { aplicarRedondeo } = require('../services/pagoService');
const { calcularMora, esVencida } = require('../services/moraService');
const {
  recalcularPrestamoDesdeCuotas,
  agregarPagoAHistorialPrestamo
} = require('../services/pagosService');
const { enviarComprobanteEmail } = require('../services/emailService');
const { sendWhatsAppText, sendWhatsAppPdf } = require('../services/ultramsgService');
const { getSystemDate } = require('../utils/dateHelper');

const { registrarMovimientoCaja } = require('../services/cajaService');

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
  const { cuota_id, monto_pagado, medio_pago, canal_comprobante, email, monto_efectivo_entregado } = req.body;

  if (!cuota_id || !monto_pagado || !medio_pago) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }

  // Solo se permiten EFECTIVO o FLOW; cualquier otro medio se rechaza
  const medioNormalizado = medio_pago === 'EFECTIVO' ? 'EFECTIVO' : (medio_pago === 'FLOW' ? 'FLOW' : null);
  if (!medioNormalizado) {
    return res.status(400).json({ error: 'Medio de pago no soportado. Use EFECTIVO o FLOW.' });
  }
  const medioPago = medioNormalizado;

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
        // Buscar cuotas del mismo préstamo (sin segundo where para evitar índice compuesto)
        const cuotasPrestamo = await db.collection('cuotas')
          .where('prestamo_id', '==', cuota.prestamo_id)
          .get();

        // Filtrar en código: cuotas anteriores no pagadas
        const hayImpagadas = cuotasPrestamo.docs.some(doc => {
          const c = doc.data();
          return c.numero_cuota < cuota.numero_cuota && c.pagada === false;
        });

        if (hayImpagadas) {
          return res.status(400).json({
            error: `⚠️ Debe pagar las cuotas en orden. Complete primero la cuota anterior (cuota ${cuota.numero_cuota - 1}).`
          });
        }
      } catch (queryError) {
        // Si falla la consulta, mostrar mensaje amigable
        console.error('Error validación orden de cuotas:', queryError.message);
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
    // Aqui asumimos monto_pagado es lo procesado.

    const { montoCobrar, ajuste } = aplicarRedondeo(monto_pagado, medioPago);

    // --- VALIDACIÓN DE EFECTIVO Y VUELTO ---
    let vuelto = 0;
    let efectivoEntregado = 0;

    if (medioPago === 'EFECTIVO') {
      if (!monto_efectivo_entregado) {
        return res.status(400).json({ error: 'Debe ingresar el monto de efectivo entregado.' });
      }
      efectivoEntregado = Number(monto_efectivo_entregado);

      // Validar suficiencia
      if (efectivoEntregado < montoCobrar) {
        return res.status(400).json({
          error: `El efectivo entregado (S/ ${efectivoEntregado.toFixed(2)}) es menor al monto a pagar (S/ ${montoCobrar.toFixed(2)}).`
        });
      }

      vuelto = Number((efectivoEntregado - montoCobrar).toFixed(2));

      // VALIDACIÓN DE FONDOS EN CAJA PARA DAR VUELTO (NUEVO)
      if (vuelto > 0) {
        // Calcular Saldo Actual de Caja
        const cajaSnap = await db.collection('cierre_caja').orderBy('fecha', 'desc').limit(1).get();
        if (!cajaSnap.empty) {
          const caja = cajaSnap.docs[0].data();
          if (!caja.cerrado) {
            // Calcular saldo actual
            const movsSnap = await db.collection('movimientos_caja')
              .where('fecha', '>=', caja.fecha)
              .get();

            let saldoActual = caja.monto_inicial;
            movsSnap.forEach(doc => {
              const m = doc.data();
              if (m.tipo === 'ENTRADA') saldoActual += m.monto;
              if (m.tipo === 'SALIDA') saldoActual -= m.monto;
            });

            // IMPORTANTE: El billete que entrega el cliente (efectivoEntregado) se suma al saldo
            // ANTES de dar el vuelto? Físicamente sí. 
            // Si tengo 0 y me dan 100, tengo 100. Si debo cobrar 80, doy 20. Me quedan 80.
            // PERO, si tengo 0 y me dan 100 y debo cobrar 10 (vuelto 90).
            // Tengo 100 en mano (billete del cliente). Tengo que dar 90.
            // Si el billete del cliente ES el fondo con el que doy vuelto, siempre alcanza (salvo que no tenga sencillo).
            // LA REGLA DEL USUARIO: "restar del fondo inicial el vuelto, si este vuelto excede al total en efectivo no dejar".
            // Interpretación Literal: Comparar Vuelto vs (SaldoPrevo).
            // Si SaldoPrevio es 0, y vuelto es 90 -> Error. 
            // Esto evita que el cajero acepte billetes grandes si no tiene cambio.

            if (vuelto > saldoActual) {
              return res.status(400).json({
                error: 'INSUFICIENT_FUNDS_CAJA', // Código manejado por frontend
                message: `No hay suficiente efectivo en caja para dar vuelto. (Saldo: S/ ${saldoActual.toFixed(2)}, Vuelto: S/ ${vuelto.toFixed(2)})`
              });
            }
          }
        }
      }
    }

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

    // TOLERANCIA DE REDONDEO: Si la diferencia es menor a S/1.00, considerar como pago completo
    // Esto permite que redondeos hacia abajo (ej: 8.33 -> 8.30) marquen la cuota como pagada
    let nuevo_saldo = Number((cuota.saldo_pendiente - abono_capital).toFixed(2));

    if (nuevo_saldo > 0 && nuevo_saldo <= 1.00 && medioPago === 'EFECTIVO') {
      // Ajustar para considerar la diferencia de redondeo como pagada
      console.log(`📌 Tolerancia de redondeo aplicada: S/${nuevo_saldo} absorbido`);
      abono_capital = cuota.saldo_pendiente; // Pagar el saldo completo
      nuevo_saldo = 0;
    }

    const pagada = nuevo_saldo <= 0; // Se considera pagada si saldo capital es 0

    // 4. Escritura en Lote
    const batch = db.batch();

    // A) Crear Pago
    const pagoRef = db.collection('pagos').doc();
    const pagoId = pagoRef.id;
    const pagoData = {
      cuota_id,
      prestamo_id: cuota.prestamo_id,
      fecha_pago: getSystemDate().toISOString(),
      monto_pagado: montoCobrar, // Monto oficial sistema
      monto_recibido: monto_pagado, // Monto físico
      medio_pago: medioPago,
      redondeo_ajuste: ajuste,
      // Nuevos campos EFECTIVO
      monto_entregado: medioPago === 'EFECTIVO' ? efectivoEntregado : null,
      vuelto: medioPago === 'EFECTIVO' ? vuelto : 0,
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

    // 4.5. Registrar Movimientos en CAJA (Solo si es EFECTIVO)
    if (medioPago === 'EFECTIVO') {
      const descBase = `Pago cuota ${cuota.numero_cuota} / Préstamo ${cuota.prestamo_id}`;

      // A) ENTRADA: El dinero que entrega el cliente
      await registrarMovimientoCaja('ENTRADA', efectivoEntregado, `Recibido: ${descBase}`, {
        pago_id: pagoId,
        cuota_id,
        prestamo_id: cuota.prestamo_id
      });

      // B) SALIDA: El vuelto (si existe)
      if (vuelto > 0) {
        await registrarMovimientoCaja('SALIDA', vuelto, `Vuelto: ${descBase}`, {
          pago_id: pagoId,
          cuota_id,
          prestamo_id: cuota.prestamo_id
        });
      }
    }

    // 5. Registrar en historial del prestamo y recalcular estado/saldo
    await agregarPagoAHistorialPrestamo(db, cuota.prestamo_id, {
      pago_id: pagoId,
      cuota_id,
      monto: monto_pagado,
      medio: medioPago,
      fecha: getSystemDate().toISOString()
    });

    const resumenPrestamo = await recalcularPrestamoDesdeCuotas(db, cuota.prestamo_id, cuota_id);

    // --- NUEVO: GENERAR PDF EN BACKEND Y SUBIR A NUBE ---
    let pdfUrl = null;
    try {
      // Obtener datos del cliente (Nombre y DNI)
      const prestamoRef = db.collection('prestamos').doc(cuota.prestamo_id);
      const prestamoSnap = await prestamoRef.get();
      const prestamoData = prestamoSnap.exists ? prestamoSnap.data() : {};

      // Datos reales
      let realClienteNombre = prestamoData.cliente_nombre || 'Cliente General';
      let realClienteDoc = prestamoData.cliente_documento || '-';
      let realDireccion = 'Inambari';

      let clienteTelefono = '';

      if (prestamoData.cliente_id) {
        const clienteSnap = await db.collection('clientes').doc(prestamoData.cliente_id).get();
        if (clienteSnap.exists) {
          const cData = clienteSnap.data();
          realClienteNombre = cData.nombre || realClienteNombre;
          realClienteDoc = cData.documento || realClienteDoc;
          realDireccion = cData.direccion || realDireccion;
          clienteTelefono = cData.telefono || '';
        }
      }

      // Datos para el PDF
      const pdfData = {
        numero_serie: 'B001',
        numero_comprobante: pagoId.substring(0, 8).toUpperCase(),
        cliente_nombre: realClienteNombre,
        cliente_doc: realClienteDoc,
        direccion: realDireccion,
        numero_cuota: cuota.numero_cuota,
        monto_total: montoCobrar,
        mora: abono_mora,
        medio_pago: medioPago,
        // Datos Extra PDF
        monto_entregado: medioPago === 'EFECTIVO' ? efectivoEntregado : null,
        vuelto: medioPago === 'EFECTIVO' ? vuelto : 0
      };

      // Generar
      const { generarReciboPDF } = require('../services/pdfService');
      pdfUrl = await generarReciboPDF(pdfData);

      // Guardar URL en el documento del pago
      await pagoRef.update({ comprobante_url: pdfUrl });

      // --- INTEGRACIÓN ULTRAMSG (WHATSAPP) ---
      if (clienteTelefono) {
        // Enviar en background para no demorar la respuesta
        (async () => {
          try {
            console.log(`📱 (Efectivo) Iniciando envío WhatsApp a ${clienteTelefono}...`);
            const now = new Date();
            const fechaStr = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
            const boletaNum = `B001-${pagoId.substring(0, 8).toUpperCase()}`;

            const caption = `📄 *Comprobante de Pago*

Boleta: ${boletaNum}
Monto: S/ ${montoCobrar.toFixed(2)}
Fecha: ${fechaStr}

Gracias por tu pago.`;

            await sendWhatsAppPdf(clienteTelefono, pdfUrl, `Comprobante_${boletaNum}.pdf`, caption);
          } catch (waErr) {
            console.error('⚠️ Error enviando WhatsApp (UltraMSG):', waErr.message);
          }
        })();
      }

    } catch (pdfErr) {
      console.error("Error generando PDF para pago efectivo:", pdfErr);
      // No fallamos la request principal, solo logueamos
    }

    res.json({
      pago_id: pagoId,
      monto_cobrado: montoCobrar,
      vuelto: vuelto, // Retornar vuelto para mostrar en frontend
      nuevo_saldo,
      cuota_pagada: pagada,
      comprobante_url: pdfUrl, // URL para abrir directo
      estado_prestamo: resumenPrestamo?.estado,
      saldo_prestamo: resumenPrestamo?.saldoRestante
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
      fecha_anulacion: getSystemDate().toISOString()
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

const express = require('express');
const router = express.Router();
const { db } = require('../db/firebase');
const { createPayment, getPaymentStatus } = require('../services/flowService');
const {
    calcularEstadoCuota,
    distribuirPagoCuota,
    recalcularPrestamoDesdeCuotas,
    agregarPagoAHistorialPrestamo
} = require('../services/pagosService');
const { sendWhatsAppText, sendWhatsAppPdf } = require('../services/ultramsgService');
const { getSystemDate } = require('../utils/dateHelper');


// Helper: Verificar si la caja está abierta (Reutilizado de pagos.js)
async function cajaAbiertaHoy() {
    const snapshot = await db.collection('cierre_caja')
        .orderBy('fecha', 'desc')
        .limit(1)
        .get();

    if (snapshot.empty) return false;
    const caja = snapshot.docs[0].data();
    return caja.cerrado === false;
}

// POST /flow/crear-pago
router.post('/crear-pago', async (req, res) => {
    try {
        // 1. Validar Caja Abierta (Regla de Negocio)
        const abierta = await cajaAbiertaHoy();
        if (!abierta) {
            return res.status(400).json({ error: 'La caja está cerrada. Debe abrir caja para procesar pagos (incluso digitales).' });
        }

        const { cuota_id, monto, cliente_nombre, cliente_email } = req.body;

        if (!cuota_id || !monto) {
            return res.status(400).json({ error: 'Faltan datos obligatorios' });
        }

        // Validar email - Flow requiere un email válido real
        const emailValido = cliente_email &&
            cliente_email.includes('@') &&
            !cliente_email.includes('example') &&
            !cliente_email.includes('cliente@');

        if (!emailValido) {
            return res.status(400).json({
                error: 'Se requiere un email válido del cliente para procesar el pago con Flow'
            });
        }

        const FRONTEND_URL = process.env.FRONTEND_URL;
        const BACKEND_URL = process.env.BACKEND_URL;

        console.log(`🔵 Creando pago Flow para cuota ${cuota_id}, monto S/${monto}`);

        // Generar Order ID único para permitir pagos parciales múltiples sobre la misma cuota
        const uniqueCommerceOrder = `${cuota_id}_${Date.now()}`;

        // Crear pago en Flow
        const flowData = await createPayment({
            commerceOrder: uniqueCommerceOrder,
            subject: `Pago de cuota - ${cliente_nombre || 'Cliente'}`,
            amount: monto,
            email: cliente_email,
            urlConfirmation: `${BACKEND_URL}/flow/webhook`,
            // En el retorno seguimos enviando el cuota_id limpio para que el frontend lo entienda
            urlReturn: `${BACKEND_URL}/flow/retorno?cuota_id=${cuota_id}`
        });

        // Obtener datos del préstamo y cliente para enviar el mensaje
        const cuotaRef = db.collection('cuotas').doc(cuota_id);
        const cuotaSnap = await cuotaRef.get();
        if (!cuotaSnap.exists) throw new Error("Cuota no encontrada");
        const cuotaData = cuotaSnap.data();

        const prestamoRef = db.collection('prestamos').doc(cuotaData.prestamo_id);
        const prestamoSnap = await prestamoRef.get();
        const prestamoData = prestamoSnap.data();

        // Obtener teléfono del cliente
        let clienteTelefono = '';
        if (prestamoData.cliente_id) {
            const clienteSnap = await db.collection('clientes').doc(prestamoData.cliente_id).get();
            if (clienteSnap.exists) {
                clienteTelefono = clienteSnap.data().telefono;
            }
        }

        const linkPago = flowData.url + '?token=' + flowData.token;

        // Enviar enlace por WhatsApp si hay teléfono
        if (clienteTelefono) {
            const msg = `Hola ${cliente_nombre},

Detalle de tu deuda:
Cuota N°: ${cuotaData.numero_cuota}
Monto: S/ ${monto}

Realiza tu pago de forma segura aquí:
${linkPago}`;

            console.log(`📱 Enviando enlace de pago a ${clienteTelefono}`);
            await sendWhatsAppText(clienteTelefono, msg);
        }

        // Responder al frontend indicando que se envió el mensaje
        res.json({
            success: true,
            mensaje: 'Enlace de pago enviado por WhatsApp al cliente',
            link: linkPago, // Por si acaso el admin lo quiere
            whatsapp_sent: !!clienteTelefono
        });

    } catch (err) {
        console.error('❌ Error creando pago Flow:', err);
        // ... (resto del catch se mantiene igual, aunque ahora será menos probable el error 1605)
        if (err.message && err.message.includes('previously paid')) {
            // ... lógica existente ...
            const cuotaRef = db.collection('cuotas').doc(req.body.cuota_id);
            const cuotaSnap = await cuotaRef.get();

            if (cuotaSnap.exists && cuotaSnap.data().pagada) {
                return res.status(400).json({
                    error: 'Esta cuota ya fue pagada anteriormente',
                    yaPageda: true
                });
            } else {
                return res.status(400).json({
                    error: 'Este pago ya fue procesado en Flow. Intente nuevamente en unos segundos.', // Mensaje ajustado
                    requiereVerificacion: true,
                    cuota_id: req.body.cuota_id
                });
            }
        }
        res.status(500).json({ error: err.message });
    }
});

// POST /flow/retorno
// Recibe el POST del navegador del usuario desde Flow y redirige a la página de éxito
router.post('/retorno', async (req, res) => {
    const token = req.body.token;
    const cuota_id = req.query.cuota_id;

    console.log(`📩 Cliente retornó de Flow. Token: ${token}, Cuota: ${cuota_id}`);

    try {
        // Obtener datos para la boleta
        let clienteNombre = 'Cliente';
        let clienteDni = '---';
        let clienteDireccion = 'Av. Desconocida';
        let monto = '0.00';
        let cuotaNumero = '1';

        // 1. Obtener monto real pagado desde Flow
        try {
            console.log(`🔍 Verificando monto real en Flow para token: ${token}...`);
            const flowStatus = await getPaymentStatus(token);
            if (flowStatus && flowStatus.amount) {
                monto = parseFloat(flowStatus.amount).toFixed(2);
                console.log(`✅ Monto real obtenido de Flow: S/ ${monto}`);

                // --- ROBUSTEZ: Si el Webhook falló, procesamos aquí mismo ---
                if (flowStatus.status === 2) {
                    console.log('🔄 Estado Flow APROBADO (2). Verificando si ya se procesó en BD...');
                    // procesarPagoAprobado maneja idempotencia (chequea duplicados internamente)
                    await procesarPagoAprobado(flowStatus, token);
                }
            }
        } catch (flowError) {
            console.error("⚠️ Error consultando monto a Flow:", flowError.message);
        }

        if (cuota_id) {
            const cuotaSnap = await db.collection('cuotas').doc(cuota_id).get();
            if (cuotaSnap.exists) {
                const cuotaData = cuotaSnap.data();

                // Si por alguna razón falló Flow, usamos el monto de la cuota (fallback)
                if (monto === '0.00') {
                    monto = parseFloat(cuotaData.monto_cuota || 0).toFixed(2);
                }

                cuotaNumero = cuotaData.numero_cuota || '1';

                if (cuotaData.prestamo_id) {
                    const prestamoSnap = await db.collection('prestamos').doc(cuotaData.prestamo_id).get();
                    if (prestamoSnap.exists) {
                        const prestamoData = prestamoSnap.data();

                        if (prestamoData.cliente_id) {
                            const clienteSnap = await db.collection('clientes').doc(prestamoData.cliente_id).get();
                            if (clienteSnap.exists) {
                                const clienteData = clienteSnap.data();
                                clienteNombre = clienteData.nombre || 'Cliente';
                                clienteDni = clienteData.documento || '---';
                                clienteDireccion = clienteData.direccion || 'Av. Siempre Viva 123';
                            }
                        }
                    }
                }
            }
        }

        // 3. Polling para esperar la generación del PDF (Máx 7 segundos)
        let pdfUrl = null;
        let intentos = 0;
        const maxIntentos = 14; // 14 * 500ms = 7 seg

        while (intentos < maxIntentos) {
            try {
                const pagosSnap = await db.collection('pagos')
                    .where('flow_token', '==', token)
                    .limit(1)
                    .get();

                if (!pagosSnap.empty) {
                    const pagoData = pagosSnap.docs[0].data();
                    if (pagoData.comprobante_url) {
                        pdfUrl = pagoData.comprobante_url;
                        break;
                    }
                }
            } catch (e) {
                console.error("Error buscando PDF:", e);
            }

            intentos++;
            await new Promise(r => setTimeout(r, 500)); // Esperar 500ms
            console.log(`⏳ Esperando PDF... Intento ${intentos}`);
        }

        if (pdfUrl) {
            // REDIRECT DIRECTO AL PDF (Requisito Usuario)
            console.log(`🚀 Redirigiendo directo al PDF: ${pdfUrl}`);
            return res.redirect(pdfUrl);
        }

        // Fallback si falla la generación (o timeout)
        // Mostrar un error simple o intentar la página de éxito como último recurso (aunque el usuario dijo que no)
        // Para ser fiel a "no pase por el pago exitoso", podriamos mostrar un HTML simple que recargue
        res.send(`
        <html>
            <head>
                <meta http-equiv="refresh" content="2">
                <style>body { font-family: sans-serif; text-align: center; padding-top: 50px; }</style>
            </head>
            <body>
                <h2>Generando su comprobante...</h2>
                <p>Por favor espere, estamos finalizando su documento.</p>
                <div class="loader" style="border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 20px auto;"></div>
                <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
            </body>
        </html>
    `);

    } catch (error) {
        console.error("Error crítico en retorno:", error);
        res.status(500).send("Error procesando su solicitud. Por favor contacte soporte.");
    }
});

/**
 * Función para procesar un pago aprobado
 * Reutilizable por webhook y verificación manual
 */
async function procesarPagoAprobado(paymentData, token) {
    // Extraer cuota_id real (por si viene con sufijo _timestamp)
    const rawOrder = paymentData.commerceOrder || '';
    const cuota_id = rawOrder.split('_')[0];
    const monto_pagado = Number(paymentData.amount);

    console.log(`?o. Procesando pago para cuota ${cuota_id} (Order: ${rawOrder}), monto S/${monto_pagado}`);

    // Obtener cuota
    const cuotaRef = db.collection('cuotas').doc(cuota_id);
    const cuotaSnap = await cuotaRef.get();

    if (!cuotaSnap.exists) {
        console.error(`?s???? Cuota ${cuota_id} no encontrada`);
        return { success: false, error: 'Cuota no encontrada' };
    }

    const cuota = cuotaSnap.data();

    // Verificar si ya se proces?? este pago (evitar duplicados)
    const pagosExistentes = await db.collection('pagos')
        .where('flow_token', '==', token)
        .get();

    if (!pagosExistentes.empty) {
        console.log(`?s???? Pago con token ${token} ya fue procesado anteriormente`);
        return { success: true, message: 'Pago ya procesado anteriormente', duplicado: true };
    }

    // Estado y distribuci??n de pago centralizados
    const { moraCalculada, saldoActual } = calcularEstadoCuota(cuota);
    const {
        abonoMora,
        abonoCapital,
        nuevoSaldo,
        pagada
    } = distribuirPagoCuota({
        montoPagado: monto_pagado,
        saldoActual,
        moraCalculada
    });

    console.log(`?Y"S Cuota: Saldo S/${saldoActual} | Mora S/${moraCalculada} | Pagado S/${monto_pagado}`);
    console.log(`?Y"" Nuevo saldo: S/${nuevoSaldo} (Pagada? ${pagada})`);

    const batch = db.batch();

    // 1. Registrar el pago
    const pagoRef = db.collection('pagos').doc();
    batch.set(pagoRef, {
        cuota_id: cuota_id,
        prestamo_id: cuota.prestamo_id,
        fecha_pago: getSystemDate().toISOString(),
        monto_pagado: monto_pagado,
        monto_recibido: monto_pagado,
        medio_pago: 'FLOW',
        flow_token: token,
        flow_order: paymentData.flowOrder,
        estado: 'APROBADO',
        desglose: {
            capital: abonoCapital,
            mora: abonoMora
        },
        payer_email: paymentData.payer || ''
    });

    // 2. Actualizar la cuota
    batch.update(cuotaRef, {
        saldo_pendiente: nuevoSaldo,
        pagada: pagada,
        ultima_fecha_pago: getSystemDate().toISOString()
    });

    // 3. Ejecutar cambios en BD
    await batch.commit();
    console.log(`?Y'? Pago guardado en Firebase correctamente.`);

    // 3b. Registrar pago en historial del préstamo
    await agregarPagoAHistorialPrestamo(db, cuota.prestamo_id, {
        pago_id: pagoRef.id,
        cuota_id,
        monto: monto_pagado,
        medio: 'FLOW',
        flow_token: token,
        flow_order: paymentData.flowOrder,
        fecha: getSystemDate().toISOString()
    });

    // 5. Recalcular estado del préstamo (saldo, pagado/parcial)
    const resumenPrestamo = await recalcularPrestamoDesdeCuotas(db, cuota.prestamo_id, cuota_id);

    // --- NUEVO: GENERAR PDF EN BACKEND PARA FLOW (Async) ---
    // No esperamos el PDF para confirmar a Flow (rapidez del webhook), pero lo lanzamos
    (async () => {
        console.log('🚀 Iniciando proceso post-pago background (PDF + WhatsApp)...');
        try {
            const prestamoSnap = await db.collection('prestamos').doc(cuota.prestamo_id).get();
            const prestamoData = prestamoSnap.exists ? prestamoSnap.data() : {};

            // Obtener datos reales del cliente
            let realClienteNombre = prestamoData.cliente_nombre || 'Cliente Remoto';
            let realClienteDoc = prestamoData.cliente_documento || '-';
            let realDireccion = 'Inambari'; // Valor por defecto o del cliente

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

            const pdfData = {
                numero_serie: 'B001',
                numero_comprobante: pagoRef.id.substring(0, 8).toUpperCase(),
                cliente_nombre: realClienteNombre,
                cliente_doc: realClienteDoc,
                direccion: realDireccion,
                numero_cuota: cuota.numero_cuota,
                monto_total: monto_pagado,
                mora: abonoMora,
                medio_pago: 'FLOW'
            };

            const { generarReciboPDF } = require('../services/pdfService');
            const pdfUrl = await generarReciboPDF(pdfData);

            await pagoRef.update({ comprobante_url: pdfUrl });
            console.log(`📜 PDF generado para Flow: ${pdfUrl}`);

            console.log(`🔎 Verificando teléfono para WhatsApp. ClienteID: ${prestamoData.cliente_id}, Tel: ${clienteTelefono}`);

            // --- INTEGRACION ULTRAMSG (WHATSAPP) ---
            if (clienteTelefono) {
                try {
                    console.log(`📱 Iniciando envío WhatsApp a ${clienteTelefono}...`);

                    // 1. Construir caption formal
                    const now = new Date();
                    const fechaStr = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
                    const boletaNum = `B001-${pagoRef.id.substring(0, 8).toUpperCase()}`;

                    const caption = `📄 *Comprobante de Pago*

Boleta: ${boletaNum}
Monto: S/ ${monto_pagado.toFixed(2)}
Fecha: ${fechaStr}

Gracias por tu pago.`;

                    // 2. Enviar UN solo mensaje (PDF + Caption)
                    await sendWhatsAppPdf(clienteTelefono, pdfUrl, `Comprobante_${boletaNum}.pdf`, caption);

                } catch (waError) {
                    console.error('⚠️ Error enviando WhatsApp (UltraMSG):', waError.message);
                }
            } else {
                console.log('⚠️ No se envió WhatsApp porque el cliente no tiene teléfono registrado.');
            }

        } catch (e) {
            console.error("Error generando PDF Flow:", e);
        }
    })();

    // 6. Retornar resultado
    return {
        success: true,
        pago_id: pagoRef.id,
        cuota_id,
        monto_pagado,
        nuevo_saldo: nuevoSaldo,
        pagada,
        abono_capital: abonoCapital,
        abono_mora: abonoMora,
        estado_prestamo: resumenPrestamo.estado,
        saldo_prestamo: resumenPrestamo.saldoRestante
    };
}



// POST /flow/webhook - Webhook de Flow
router.post('/webhook', async (req, res) => {
    try {
        const { token } = req.body;

        console.log('📩 Webhook Flow recibido. Token:', token);

        if (!token) {
            console.log('⚠️ Webhook sin token');
            return res.status(200).send('OK');
        }

        // Guardar token para reprocesar si falla
        const tokenPendienteRef = db.collection('pagos_pendientes').doc(token);
        await tokenPendienteRef.set({
            token,
            recibido_en: new Date().toISOString(),
            procesado: false
        });

        try {
            // Consultar estado del pago (con reintentos)
            const paymentStatus = await getPaymentStatus(token);

            console.log('💰 Estado del pago Flow:', paymentStatus);

            // Solo procesar si el pago fue aprobado (status = 2)
            if (paymentStatus.status === 2) {
                const resultado = await procesarPagoAprobado(paymentStatus, token);

                // Marcar como procesado
                await tokenPendienteRef.update({
                    procesado: true,
                    procesado_en: new Date().toISOString(),
                    resultado: resultado
                });

                console.log('✅ Webhook procesado correctamente');
            } else {
                console.log(`⚠️ Pago no aprobado (Status: ${paymentStatus.status})`);
                await tokenPendienteRef.update({
                    procesado: true,
                    procesado_en: new Date().toISOString(),
                    estado_flow: paymentStatus.status,
                    motivo: 'Pago no aprobado'
                });
            }

        } catch (flowError) {
            console.error('❌ Error consultando Flow:', flowError.message);
            // Guardar error para reprocesar después
            await tokenPendienteRef.update({
                error: flowError.message,
                ultimo_intento: new Date().toISOString()
            });
        }

        // Siempre responder 200 OK
        res.status(200).send('OK');

    } catch (err) {
        console.error('❌ Error en webhook Flow:', err);
        res.status(200).send('OK');
    }
});

// POST /flow/verificar-pago - Verificar y procesar pago manualmente
router.post('/verificar-pago', async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Token requerido' });
        }

        console.log(`🔍 Verificación manual de pago. Token: ${token}`);

        // Consultar estado en Flow
        const paymentStatus = await getPaymentStatus(token);

        if (paymentStatus.status === 2) {
            const resultado = await procesarPagoAprobado(paymentStatus, token);

            // Actualizar registro de pendientes si existe
            try {
                await db.collection('pagos_pendientes').doc(token).update({
                    procesado: true,
                    procesado_en: new Date().toISOString(),
                    procesado_manualmente: true,
                    resultado: resultado
                });
            } catch (e) { /* puede que no exista */ }

            res.json({
                success: true,
                mensaje: resultado.duplicado
                    ? 'Este pago ya fue procesado anteriormente'
                    : 'Pago verificado y procesado correctamente',
                ...resultado
            });
        } else {
            res.json({
                success: false,
                mensaje: 'El pago no está aprobado en Flow',
                estado_flow: paymentStatus.status,
                detalle: paymentStatus
            });
        }

    } catch (err) {
        console.error('❌ Error verificando pago:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /flow/pendientes - Listar pagos pendientes de procesar
router.get('/pendientes', async (req, res) => {
    try {
        const pendientes = await db.collection('pagos_pendientes')
            .where('procesado', '==', false)
            .orderBy('recibido_en', 'desc')
            .limit(50)
            .get();

        const lista = pendientes.docs.map(doc => ({
            token: doc.id,
            ...doc.data()
        }));

        res.json({ pendientes: lista, total: lista.length });

    } catch (err) {
        console.error('Error listando pendientes:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /flow/reprocesar-pendientes - Reprocesar todos los pagos pendientes
router.post('/reprocesar-pendientes', async (req, res) => {
    try {
        const pendientes = await db.collection('pagos_pendientes')
            .where('procesado', '==', false)
            .get();

        const resultados = [];

        for (const doc of pendientes.docs) {
            const { token } = doc.data();
            try {
                const paymentStatus = await getPaymentStatus(token);

                if (paymentStatus.status === 2) {
                    const resultado = await procesarPagoAprobado(paymentStatus, token);
                    await doc.ref.update({
                        procesado: true,
                        procesado_en: new Date().toISOString(),
                        resultado
                    });
                    resultados.push({ token, success: true, ...resultado });
                } else {
                    await doc.ref.update({
                        procesado: true,
                        estado_flow: paymentStatus.status,
                        motivo: 'No aprobado'
                    });
                    resultados.push({ token, success: false, estado: paymentStatus.status });
                }
            } catch (err) {
                await doc.ref.update({
                    ultimo_intento: new Date().toISOString(),
                    error: err.message
                });
                resultados.push({ token, success: false, error: err.message });
            }
        }

        res.json({
            mensaje: `Procesados ${resultados.length} pagos pendientes`,
            resultados
        });

    } catch (err) {
        console.error('Error reprocesando:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /flow/estado/:token - Consultar estado manualmente
router.get('/estado/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const status = await getPaymentStatus(token);
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /flow/sincronizar-cuota - Buscar y sincronizar pago de Flow para una cuota
// Útil cuando Flow dice "already paid" pero no está reflejado en la BD local
router.post('/sincronizar-cuota', async (req, res) => {
    try {
        const { cuota_id } = req.body;

        if (!cuota_id) {
            return res.status(400).json({ error: 'cuota_id requerido' });
        }

        console.log(`🔍 Buscando pago Flow para cuota ${cuota_id}...`);

        // 1. Verificar estado actual de la cuota
        const cuotaRef = db.collection('cuotas').doc(cuota_id);
        const cuotaSnap = await cuotaRef.get();

        if (!cuotaSnap.exists) {
            return res.status(404).json({ error: 'Cuota no encontrada' });
        }

        const cuota = cuotaSnap.data();

        // Si ya está pagada, informar
        if (cuota.pagada) {
            return res.json({
                success: true,
                mensaje: 'La cuota ya está marcada como pagada',
                cuota: {
                    id: cuota_id,
                    saldo_pendiente: cuota.saldo_pendiente,
                    pagada: cuota.pagada
                }
            });
        }

        // 2. Buscar si hay pago registrado para esta cuota
        const pagosExistentes = await db.collection('pagos')
            .where('cuota_id', '==', cuota_id)
            .where('estado', '==', 'APROBADO')
            .get();

        if (!pagosExistentes.empty) {
            // Hay pagos pero la cuota no está marcada como pagada
            // Recalcular saldo
            let totalPagado = 0;
            pagosExistentes.docs.forEach(doc => {
                totalPagado += Number(doc.data().monto_pagado);
            });

            const nuevoSaldo = Math.max(0, cuota.monto_cuota - totalPagado);
            const estaPagada = nuevoSaldo <= 0.50;

            await cuotaRef.update({
                saldo_pendiente: estaPagada ? 0 : nuevoSaldo,
                pagada: estaPagada
            });

            return res.json({
                success: true,
                mensaje: estaPagada
                    ? 'Cuota actualizada y marcada como pagada'
                    : 'Cuota actualizada con los pagos encontrados',
                total_pagado: totalPagado,
                nuevo_saldo: nuevoSaldo,
                pagada: estaPagada
            });
        }

        // 3. Buscar en pagos_pendientes por tokens no procesados
        const pendientesSnap = await db.collection('pagos_pendientes')
            .where('procesado', '==', false)
            .get();

        // No podemos buscar el pago en Flow sin un token
        // Pero podemos marcar esta cuota para revisión manual

        return res.json({
            success: false,
            mensaje: 'No se encontraron pagos para esta cuota. Si realizaste el pago en Flow, contacta al administrador con tu comprobante.',
            cuota_id,
            saldo_pendiente: cuota.saldo_pendiente,
            tokens_pendientes: pendientesSnap.size
        });

    } catch (err) {
        console.error('Error sincronizando:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /flow/mock/pay - Página simulada de pago (Solo para desarrollo)
router.get('/mock/pay', (req, res) => {
    const { token } = req.query;
    if (!token) return res.send('<h1>Error: Falta token</h1>');

    // Extraer datos visuales del token
    const parts = token.split('_');
    const commerceOrder = parts[1] || '???';

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Flow Mock Payment</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 40px; background: #f5f6fa;">
            <div style="background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto;">
                <h1 style="color: #2c3e50; margin-bottom: 10px;">💸 Flow Local Mock</h1>
                <div style="background: #e1f5fe; color: #0277bd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <strong>Ambiente de Simulación</strong><br>
                    No se está realizando ningún cobro real.
                </div>
                
                <div style="text-align: left; margin: 30px 0; font-size: 16px;">
                    <p><strong>Cuota ID:</strong> ${commerceOrder}</p>
                    <p><strong>Token:</strong> <code style="background: #eee; padding: 2px 5px; border-radius: 4px;">${token}</code></p>
                    <p><strong>Monto:</strong> S/ 100.00 (Simulado)</p>
                </div>

                <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;">

                <button onclick="confirmar()" id="btn-pay" style="width: 100%; padding: 15px; font-size: 18px; font-weight: bold; background: #27ae60; color: white; border: none; border-radius: 8px; cursor: pointer; transition: background 0.2s;">
                    ✅ Simular Pago Exitoso
                </button>
                
                <button onclick="cancelar()" style="width: 100%; padding: 15px; font-size: 16px; margin-top: 10px; background: transparent; color: #7f8c8d; border: 2px solid #ecf0f1; border-radius: 8px; cursor: pointer;">
                    ❌ Simular Cancelación
                </button>

                <p id="status" style="margin-top: 20px; color: #7f8c8d; font-size: 14px;"></p>
            </div>

            <script>
                async function confirmar() {
                    const btn = document.getElementById('btn-pay');
                    const status = document.getElementById('status');
                    
                    btn.disabled = true;
                    btn.innerHTML = '🔄 Procesando...';
                    status.innerHTML = 'Contactando backend local...';

                    try {
                        // 1. Llamar al backend para simular la confirmación del pago
                        // Usamos verificar-pago que llama a getPaymentStatus (que devolverá mock data)
                        const res = await fetch('/flow/verificar-pago', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ token: '${token}' })
                        });
                        
                        const data = await res.json();
                        
                        if (data.success || data.pagada || data.nuevo_saldo !== undefined) {
                            status.innerHTML = '✅ Pago registrado! Redirigiendo...';
                            status.style.color = 'green';
                            
                            setTimeout(() => {
                                // 2. Redirigir al frontend como lo haría Flow
                                window.location.href = '/?pago=flow&token=${token}';
                            }, 1000);
                        } else {
                            throw new Error(data.error || 'Error desconocido');
                        }
                    } catch (e) {
                        btn.disabled = false;
                        btn.innerHTML = '✅ Simular Pago Exitoso';
                        status.innerHTML = '❌ Error: ' + e.message;
                        status.style.color = 'red';
                    }
                }

                function cancelar() {
                     window.location.href = '/?pago=error&token=${token}';
                }
            </script>
        </body>
        </html>
    `;
    res.send(html);
});

module.exports = router;

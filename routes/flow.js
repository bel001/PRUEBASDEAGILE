const express = require('express');
const router = express.Router();
const db = require('../db/firebase');
const { createPayment, getPaymentStatus } = require('../services/flowService');
const {
    calcularEstadoCuota,
    distribuirPagoCuota,
    recalcularPrestamoDesdeCuotas,
    agregarPagoAHistorialPrestamo
} = require('../services/pagosService');

// POST /flow/crear-pago
router.post('/crear-pago', async (req, res) => {
    try {
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

        const FRONTEND_URL = process.env.FRONTEND_URL || 'https://agile-prestamos-nn7p.onrender.com';
        const BACKEND_URL = "https://agile-prestamos-nn7p.onrender.com";

        console.log(`🔵 Creando pago Flow para cuota ${cuota_id}, monto S/${monto}`);

        // Crear pago en Flow
        const flowData = await createPayment({
            commerceOrder: cuota_id,
            subject: `Pago de cuota - ${cliente_nombre || 'Cliente'}`,
            amount: monto,
            email: cliente_email,
            urlConfirmation: `${BACKEND_URL}/flow/webhook`,
            urlReturn: `${FRONTEND_URL}?pago=flow&cuota_id=${cuota_id}`
        });

        res.json({
            url: flowData.url + '?token=' + flowData.token,
            token: flowData.token,
            flowOrder: flowData.flowOrder
        });

    } catch (err) {
        console.error('❌ Error creando pago Flow:', err);

        // Error 1605: El pago ya fue realizado en Flow
        if (err.message && err.message.includes('previously paid')) {
            // Verificar si la cuota ya está marcada como pagada en nuestra BD
            const cuotaRef = db.collection('cuotas').doc(req.body.cuota_id);
            const cuotaSnap = await cuotaRef.get();

            if (cuotaSnap.exists && cuotaSnap.data().pagada) {
                return res.status(400).json({
                    error: 'Esta cuota ya fue pagada anteriormente',
                    yaPageda: true
                });
            } else {
                // El pago existe en Flow pero no en nuestra BD - informar al usuario
                return res.status(400).json({
                    error: 'Este pago ya fue procesado en Flow. Si no ves el pago reflejado, contacta al administrador.',
                    requiereVerificacion: true,
                    cuota_id: req.body.cuota_id
                });
            }
        }

        res.status(500).json({ error: err.message });
    }
});

/**
 * Función para procesar un pago aprobado
 * Reutilizable por webhook y verificación manual
 */
async function procesarPagoAprobado(paymentData, token) {
    const cuota_id = paymentData.commerceOrder;
    const monto_pagado = Number(paymentData.amount);

    console.log(`?o. Procesando pago para cuota ${cuota_id}, monto S/${monto_pagado}`);

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
        fecha_pago: new Date().toISOString(),
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
        ultima_fecha_pago: new Date().toISOString()
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
        fecha: new Date().toISOString()
    });

    // 4. Generar comprobante
    try {
        const prestamoSnap = await db.collection('prestamos').doc(cuota.prestamo_id).get();
        let clienteDoc = '00000000';
        let clienteNombre = 'Cliente Flow';

        if (prestamoSnap.exists) {
            const pid = prestamoSnap.data().cliente_id;
            const cSnap = await db.collection('clientes').doc(pid).get();
            if (cSnap.exists) {
                clienteDoc = cSnap.data().documento;
                clienteNombre = cSnap.data().nombre;
            }
        }

        await db.collection('comprobantes').add({
            pago_id: pagoRef.id,
            cuota_id,
            cliente_nombre: clienteNombre,
            cliente_documento: clienteDoc,
            cliente_email: paymentData.payer,
            numero_cuota: cuota.numero_cuota,
            fecha_emision: new Date().toISOString(),
            monto_total: monto_pagado,
            desglose: { capital: abonoCapital, mora: abonoMora },
            medio_pago: 'FLOW',
            serie: clienteDoc.length === 11 ? 'F001' : 'B001',
            tipo: clienteDoc.length === 11 ? 'FACTURA' : 'BOLETA'
        });
        console.log('?Y"" Comprobante generado');
    } catch (errReceipt) {
        console.error('?s???? Error generando comprobante:', errReceipt.message);
    }

    // 5. Recalcular estado del préstamo (saldo, pagado/parcial)
    const resumenPrestamo = await recalcularPrestamoDesdeCuotas(db, cuota.prestamo_id, cuota_id);
    if (resumenPrestamo.cancelado) {
        console.log(`?YZ% PR?%STAMO ${cuota.prestamo_id} COMPLETADO`);
    } else {
        console.log(`?Y" Prestamo ${cuota.prestamo_id} pendiente. Saldo S/${resumenPrestamo.saldoRestante}`);
    }

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

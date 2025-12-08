const express = require('express');
const router = express.Router();
const db = require('../db/firebase');
const { createPayment, getPaymentStatus } = require('../services/flowService');

// POST /flow/crear-pago
router.post('/crear-pago', async (req, res) => {
    try {
        const { cuota_id, monto, cliente_nombre, cliente_email } = req.body;

        if (!cuota_id || !monto) {
            return res.status(400).json({ error: 'Faltan datos obligatorios' });
        }

        const BASE_URL = process.env.FRONTEND_URL || 'https://agile-prestamos-nn7p.onrender.com';

        console.log(`🔵 Creando pago Flow para cuota ${cuota_id}, monto S/${monto}`);

        // Crear pago en Flow
        const flowData = await createPayment({
            commerceOrder: cuota_id,
            subject: `Pago de cuota - ${cliente_nombre || 'Cliente'}`,
            amount: monto, // En soles (PEN)
            email: cliente_email || 'cliente@ejemplo.com',
            urlConfirmation: `${BASE_URL}/flow/webhook`,
            urlReturn: `${BASE_URL}?pago=flow&cuota_id=${cuota_id}`
        });

        res.json({
            url: flowData.url + '?token=' + flowData.token,
            token: flowData.token,
            flowOrder: flowData.flowOrder
        });

    } catch (err) {
        console.error('❌ Error creando pago Flow:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /flow/webhook
router.post('/webhook', async (req, res) => {
    try {
        const { token } = req.body;

        console.log('📩 Webhook Flow recibido. Token:', token);

        if (!token) {
            return res.status(400).send('Token no proporcionado');
        }

        // Consultar estado del pago
        const paymentStatus = await getPaymentStatus(token);

        console.log('💰 Estado del pago Flow:', paymentStatus);

        // Solo procesar si el pago fue aprobado (status = 2)
        if (paymentStatus.status === 2) {
            const cuota_id = paymentStatus.commerceOrder;
            const monto_pagado = Number(paymentStatus.amount);

            console.log(`✅ Pago aprobado para cuota ${cuota_id}, monto S/${monto_pagado}`);

            // Obtener cuota
            const cuotaRef = db.collection('cuotas').doc(cuota_id);
            const cuotaSnap = await cuotaRef.get();

            if (!cuotaSnap.exists) {
                console.error(`⚠️ Cuota ${cuota_id} no encontrada`);
                return res.status(200).send('OK');
            }

            const cuota = cuotaSnap.data();

            // Importar lógica de mora
            const { calcularMora, esVencida } = require('../services/moraService');

            const vencida = esVencida(cuota.fecha_vencimiento);
            const moraCalculada = calcularMora(cuota.saldo_pendiente, vencida);
            const total_con_mora = cuota.saldo_pendiente + moraCalculada;

            let abono_capital = 0;
            let abono_mora = 0;

            if (monto_pagado >= total_con_mora) {
                // PAGO TOTAL
                abono_mora = moraCalculada;
                abono_capital = cuota.saldo_pendiente;
            } else {
                // PAGO PARCIAL - Mora se anula
                abono_mora = 0;
                abono_capital = Math.min(monto_pagado, cuota.saldo_pendiente);
            }

            const nuevo_saldo = Number((cuota.saldo_pendiente - abono_capital).toFixed(2));
            const pagada = nuevo_saldo <= 0;

            const batch = db.batch();

            // Crear registro de pago
            const pagoRef = db.collection('pagos').doc();
            batch.set(pagoRef, {
                cuota_id,
                fecha_pago: new Date().toISOString(),
                monto_pagado,
                monto_recibido: monto_pagado,
                medio_pago: 'FLOW',
                flow_token: token,
                flow_order: paymentStatus.flowOrder,
                estado: 'APROBADO',
                desglose: {
                    capital: abono_capital,
                    mora: abono_mora
                },
                payer_email: paymentStatus.payer || ''
            });

            // Actualizar cuota
            batch.update(cuotaRef, {
                saldo_pendiente: nuevo_saldo,
                pagada: pagada
            });

            await batch.commit();

            console.log(`✅ Pago Flow registrado: Capital S/${abono_capital}, Mora S/${abono_mora}`);

            // GENERAR COMPROBANTE AUTOMÁTICAMENTE
            try {
                const prestamoSnap = await db.collection('prestamos').doc(cuota.prestamo_id).get();
                const clienteSnap = await db.collection('clientes').doc(cuota.cliente_id).get();

                if (prestamoSnap.exists && clienteSnap.exists) {
                    const cliente = clienteSnap.data();

                    await db.collection('comprobantes').add({
                        pago_id: pagoRef.id,
                        cuota_id,
                        cliente_nombre: cliente.nombre,
                        cliente_documento: cliente.documento,
                        cliente_email: cliente.email || paymentStatus.payer,
                        numero_cuota: cuota.numero_cuota,
                        fecha_emision: new Date().toISOString(),
                        monto_total: monto_pagado,
                        desglose: { capital: abono_capital, mora: abono_mora },
                        medio_pago: 'FLOW',
                        serie: cliente.documento?.length === 11 ? 'F001' : 'B001',
                        tipo: cliente.documento?.length === 11 ? 'FACTURA' : 'BOLETA'
                    });

                    console.log(`📄 Comprobante generado automáticamente para pago ${pagoRef.id}`);
                }
            } catch (receiptError) {
                console.error('⚠️ Error generando comprobante:', receiptError.message);
            }

            // Verificar si todas las cuotas están pagadas
            if (pagada) {
                const todasCuotas = await db.collection('cuotas')
                    .where('prestamo_id', '==', cuota.prestamo_id)
                    .get();

                const todasPagadas = todasCuotas.docs.every(doc => doc.data().pagada === true);

                if (todasPagadas) {
                    await db.collection('prestamos').doc(cuota.prestamo_id).update({
                        cancelado: true
                    });
                    console.log(`🎉 Préstamo ${cuota.prestamo_id} totalmente cancelado`);
                }
            }
        } else {
            console.log(`⚠️ Pago rechazado o pendiente. Status: ${paymentStatus.status}`);
        }

        // Siempre responder 200 OK para que Flow no reintente
        res.status(200).send('OK');

    } catch (err) {
        console.error('❌ Error en webhook Flow:', err);
        res.status(200).send('OK'); // Siempre 200 para que Flow no reintente
    }
});

// GET /flow/estado/:token (opcional, para consultar status manualmente)
router.get('/estado/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const status = await getPaymentStatus(token);
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const db = require('../db/firebase');

// Inicializar cliente MercadoPago con credenciales TEST
const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN || 'APP_USR-7403869921548499-120700-2c904f80db45bb9d0e111bd1edd2bc90-3046319007',
    options: { timeout: 5000 }
});

const preference = new Preference(client);
const payment = new Payment(client);

// POST /mercadopago/crear-preferencia
// Crea un link de pago para una cuota específica
router.post('/crear-preferencia', async (req, res) => {
    try {
        const { cuota_id, monto, cliente_nombre, cliente_email } = req.body;

        if (!cuota_id || !monto) {
            return res.status(400).json({ error: 'Faltan datos obligatorios' });
        }

        // URL base - usar producción para MercadoPago (requiere HTTPS)
        const BASE_URL = process.env.FRONTEND_URL || 'https://agile-prestamos-nn7p.onrender.com';

        // Crear preferencia de pago
        const preferenceData = {
            items: [
                {
                    id: cuota_id,
                    title: `Pago de cuota - ${cliente_nombre || 'Cliente'}`,
                    quantity: 1,
                    unit_price: Number(monto),
                    currency_id: 'PEN' // Soles peruanos
                }
            ],
            payer: {
                email: cliente_email || 'cliente@example.com'
            },
            back_urls: {
                success: `${BASE_URL}?pago=exitoso&cuota_id=${cuota_id}`,
                failure: `${BASE_URL}?pago=fallido`,
                pending: `${BASE_URL}?pago=pendiente`
            },
            external_reference: cuota_id, // Para identificar el pago en webhook
            notification_url: `${BASE_URL}/mercadopago/webhook`,
            statement_descriptor: 'AGILE Prestamos'
        };

        const result = await preference.create({ body: preferenceData });

        res.json({
            preference_id: result.id,
            init_point: result.init_point, // URL de pago en producción
            sandbox_init_point: result.sandbox_init_point // URL de pago en sandbox
        });

    } catch (err) {
        console.error('Error creando preferencia MercadoPago:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /mercadopago/webhook
// Recibe notificaciones de MercadoPago cuando se completa un pago
router.post('/webhook', async (req, res) => {
    try {
        const { type, data } = req.body;

        console.log('📩 Webhook MercadoPago recibido:', type, data);

        // Solo procesamos notificaciones de pago
        if (type === 'payment') {
            const paymentId = data.id;

            // Obtener detalles del pago desde MercadoPago
            const paymentInfo = await payment.get({ id: paymentId });

            console.log('💰 Pago info:', paymentInfo);

            // Solo procesar si el pago fue aprobado
            if (paymentInfo.status === 'approved') {
                const cuota_id = paymentInfo.external_reference;
                const monto_pagado = paymentInfo.transaction_amount;

                // Obtener cuota
                const cuotaRef = db.collection('cuotas').doc(cuota_id);
                const cuotaSnap = await cuotaRef.get();

                if (cuotaSnap.exists) {
                    const cuota = cuotaSnap.data();

                    // Importar lógica de cálculo de mora
                    const { calcularMora, esVencida } = require('../services/moraService');

                    // Calcular mora y distribución del pago
                    const vencida = esVencida(cuota.fecha_vencimiento);
                    const moraCalculada = calcularMora(cuota.saldo_pendiente, vencida);
                    const total_con_mora = cuota.saldo_pendiente + moraCalculada;

                    let abono_capital = 0;
                    let abono_mora = 0;

                    if (monto_pagado >= total_con_mora) {
                        // PAGO TOTAL: Cubre Mora + Capital
                        abono_mora = moraCalculada;
                        abono_capital = cuota.saldo_pendiente;
                    } else {
                        // PAGO PARCIAL: Mora anulada, todo a capital
                        abono_mora = 0;
                        abono_capital = Math.min(monto_pagado, cuota.saldo_pendiente);
                    }

                    const nuevo_saldo = Number((cuota.saldo_pendiente - abono_capital).toFixed(2));
                    const pagada = nuevo_saldo <= 0;

                    const batch = db.batch();

                    // Crear registro de pago
                    const pagoRef = db.collection('pagos').doc();
                    const pagoData = {
                        cuota_id,
                        fecha_pago: new Date().toISOString(),
                        monto_pagado,
                        monto_recibido: monto_pagado,
                        medio_pago: 'MERCADOPAGO',
                        mp_payment_id: paymentId,
                        estado: 'APROBADO',
                        desglose: {
                            capital: abono_capital,
                            mora: abono_mora
                        },
                        // Datos del cliente para el comprobante
                        payer_email: paymentInfo.payer?.email || '',
                        payer_name: paymentInfo.payer?.first_name || 'Cliente MercadoPago'
                    };
                    batch.set(pagoRef, pagoData);

                    // Actualizar cuota
                    batch.update(cuotaRef, {
                        saldo_pendiente: nuevo_saldo,
                        pagada: pagada
                    });

                    await batch.commit();

                    console.log(`✅ Pago MercadoPago registrado: Capital S/${abono_capital}, Mora S/${abono_mora}`);

                    // GENERAR COMPROBANTE AUTOMÁTICAMENTE
                    try {
                        // Obtener datos del cliente y préstamo
                        const prestamoSnap = await db.collection('prestamos').doc(cuota.prestamo_id).get();
                        const clienteSnap = await db.collection('clientes').doc(cuota.cliente_id).get();

                        if (prestamoSnap.exists && clienteSnap.exists) {
                            const prestamo = prestamoSnap.data();
                            const cliente = clienteSnap.data();

                            // Guardar datos del comprobante en Firebase
                            await db.collection('comprobantes').add({
                                pago_id: pagoRef.id,
                                cuota_id,
                                cliente_nombre: cliente.nombre,
                                cliente_documento: cliente.documento,
                                cliente_email: cliente.email || paymentInfo.payer?.email,
                                numero_cuota: cuota.numero_cuota,
                                fecha_emision: new Date().toISOString(),
                                monto_total: monto_pagado,
                                desglose: {
                                    capital: abono_capital,
                                    mora: abono_mora
                                },
                                medio_pago: 'MERCADOPAGO',
                                serie: cliente.documento?.length === 11 ? 'F001' : 'B001',
                                tipo: cliente.documento?.length === 11 ? 'FACTURA' : 'BOLETA'
                            });

                            console.log(`📄 Comprobante generado automáticamente para pago ${pagoRef.id}`);
                        }
                    } catch (receiptError) {
                        console.error('⚠️ Error generando comprobante:', receiptError.message);
                        // No fallar el webhook por esto
                    }

                    // Si todas las cuotas están pagadas, marcar préstamo como cancelado
                    if (pagada) {
                        const prestamo_id = cuota.prestamo_id;
                        const cuotasSnapshot = await db.collection('cuotas')
                            .where('prestamo_id', '==', prestamo_id)
                            .get();

                        const todasPagadas = cuotasSnapshot.docs.every(doc => {
                            const c = doc.data();
                            if (doc.id === cuota_id) return true;
                            return c.pagada === true;
                        });

                        if (todasPagadas) {
                            await db.collection('prestamos').doc(prestamo_id).update({
                                cancelado: true,
                                fecha_cancelacion: new Date().toISOString()
                            });
                        }
                    }

                    console.log(`✅ Pago MercadoPago registrado: Capital S/${abono_capital}, Mora S/${abono_mora}`);
                }
            }
        }

        // Siempre responder 200 para que MercadoPago no reintente
        res.sendStatus(200);

    } catch (err) {
        console.error('Error en webhook MercadoPago:', err);
        res.sendStatus(200); // Aún así respondemos 200 para evitar reintentos
    }
});

// GET /mercadopago/estado/:payment_id
// Consulta el estado de un pago
router.get('/estado/:payment_id', async (req, res) => {
    try {
        const paymentInfo = await payment.get({ id: req.params.payment_id });
        res.json({
            status: paymentInfo.status,
            status_detail: paymentInfo.status_detail,
            external_reference: paymentInfo.external_reference
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

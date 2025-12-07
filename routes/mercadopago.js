const express = require('express');
const router = express.Router();
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const db = require('../db/firebase');

// Inicializar cliente MercadoPago
const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN || 'APP_USR-5691813975231568-120700-0b4f105120a434d4c1240e2e4d6c21ee-3044196038',
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
                success: `${process.env.FRONTEND_URL || 'http://localhost:4000'}/pago-exitoso.html?cuota_id=${cuota_id}`,
                failure: `${process.env.FRONTEND_URL || 'http://localhost:4000'}/pago-fallido.html`,
                pending: `${process.env.FRONTEND_URL || 'http://localhost:4000'}/pago-pendiente.html`
            },
            auto_return: 'approved',
            external_reference: cuota_id, // Para identificar el pago en webhook
            notification_url: `${process.env.BACKEND_URL || 'https://agile-prestamos-nn7p.onrender.com'}/mercadopago/webhook`,
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

                // Registrar pago en nuestra base de datos
                const cuotaRef = db.collection('cuotas').doc(cuota_id);
                const cuotaSnap = await cuotaRef.get();

                if (cuotaSnap.exists) {
                    const cuota = cuotaSnap.data();
                    const nuevo_saldo = Math.max(0, cuota.saldo_pendiente - monto_pagado);
                    const pagada = nuevo_saldo <= 0;

                    // Crear registro de pago
                    await db.collection('pagos').add({
                        cuota_id,
                        fecha_pago: new Date().toISOString(),
                        monto_pagado,
                        medio_pago: 'MERCADOPAGO',
                        mp_payment_id: paymentId,
                        estado: 'APROBADO'
                    });

                    // Actualizar cuota
                    await cuotaRef.update({
                        saldo_pendiente: nuevo_saldo,
                        pagada: pagada
                    });

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

                    console.log(`✅ Pago MercadoPago registrado para cuota ${cuota_id}`);
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

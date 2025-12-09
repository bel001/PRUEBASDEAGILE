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

        const BASE_URL = process.env.FRONTEND_URL || 'https://agile-prestamos-nn7p.onrender.com';

        console.log(`🔵 Creando pago Flow para cuota ${cuota_id}, monto S/${monto}`);

        // Crear pago en Flow
        const flowData = await createPayment({
            commerceOrder: cuota_id,
            subject: `Pago de cuota - ${cliente_nombre || 'Cliente'}`,
            amount: monto, // En soles (PEN)
            email: cliente_email, // Email ya validado
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

            console.log(`✅ Pago aprobado por Flow para cuota ${cuota_id}, monto S/${monto_pagado}`);

            // Obtener cuota para validaciones
            const cuotaRef = db.collection('cuotas').doc(cuota_id);
            const cuotaSnap = await cuotaRef.get();

            if (!cuotaSnap.exists) {
                console.error(`⚠️ Cuota ${cuota_id} no encontrada (Reportada por Flow)`);
                return res.status(200).send('OK');
            }

            const cuota = cuotaSnap.data();

            // Importar lógica de mora
            const { calcularMora, esVencida } = require('../services/moraService');
            const vencida = esVencida(cuota.fecha_vencimiento);
            const moraCalculada = calcularMora(cuota.saldo_pendiente, vencida);
            const saldo_actual = Number(cuota.saldo_pendiente);

            // Total deuda teórica al momento
            const total_con_mora = saldo_actual + moraCalculada;

            let abono_capital = 0;
            let abono_mora = 0;

            console.log(`📊 Estado actual cuota: Saldo S/${saldo_actual} | Mora Calc S/${moraCalculada} | Pagado Flow S/${monto_pagado}`);

            // Lógica de distribución de pago (RN1: Pago Parcial anula mora del mes)
            if (monto_pagado >= total_con_mora - 0.5) {
                // PAGO TOTAL (Con tolerancia de 0.50 céntimos por redondeos)
                abono_mora = moraCalculada;
                // El resto va al capital (máximo lo que se debía)
                const remanente = monto_pagado - abono_mora;
                abono_capital = Math.min(remanente, saldo_actual);
            } else {
                // PAGO PARCIAL
                // Todo a capital, mora se condona/anula por ahora
                abono_mora = 0;
                abono_capital = Math.min(monto_pagado, saldo_actual);
            }

            // Calculamos nuevo saldo
            // Usamos Math.max(0, ...) para evitar saldos negativos por error
            let nuevo_saldo = Number((saldo_actual - abono_capital).toFixed(2));
            if (nuevo_saldo < 0) nuevo_saldo = 0;

            // Tolerancia para declarar pagada (dejarla en 0 si falta muy poco, ej < 0.10)
            const pagada = nuevo_saldo <= 0.50;
            if (pagada) nuevo_saldo = 0;

            console.log(`🔄 Nuevo saldo calculado: S/${nuevo_saldo} (Pagada? ${pagada})`);

            const batch = db.batch();

            // 1. Registrar el pago en colección 'pagos'
            const pagoRef = db.collection('pagos').doc();
            batch.set(pagoRef, {
                cuota_id: cuota_id,
                fecha_pago: new Date().toISOString(),
                monto_pagado: monto_pagado,
                monto_recibido: monto_pagado, // En online es exacto
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

            // 2. Actualizar la cuota
            batch.update(cuotaRef, {
                saldo_pendiente: nuevo_saldo,
                pagada: pagada,
                // Si quisieras guardar historial en la cuota también:
                // historial_pagos: admin.firestore.FieldValue.arrayUnion({...})
            });

            // 3. Ejecutar cambios en BD
            await batch.commit();
            console.log(`💾 Cambios guardados en Firebase correctamente.`);

            // GENERAR COMPROBANTE (Solo si el pago se procesó bien)
            try {
                const prestamoSnap = await db.collection('prestamos').doc(cuota.prestamo_id).get();
                // Intentamos buscar cliente por ID si está en el préstamo, sino fallará y no importa
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
                    cliente_email: paymentStatus.payer,
                    numero_cuota: cuota.numero_cuota,
                    fecha_emision: new Date().toISOString(),
                    monto_total: monto_pagado,
                    desglose: { capital: abono_capital, mora: abono_mora },
                    medio_pago: 'FLOW',
                    serie: clienteDoc.length === 11 ? 'F001' : 'B001',
                    tipo: clienteDoc.length === 11 ? 'FACTURA' : 'BOLETA'
                });
                console.log('📄 Comprobante generado para pago Flow');
            } catch (errReceipt) {
                console.error('⚠️ Error generando comprobante (no crítico):', errReceipt.message);
            }


            // Verificar si todas las cuotas están pagadas (Solo si esta cuota se pagó completa)
            if (pagada) {
                const todasCuotas = await db.collection('cuotas')
                    .where('prestamo_id', '==', cuota.prestamo_id)
                    .get();

                // Verificamos en memoria (incluida la actual que acabamos de marcar en el batch pero que 
                // en 'todasCuotas' vendría vieja si no volvemos a leer, pero aquí leemos de nuevo o usamos lógica)
                // Mejor lógica: si todas las OTRAS están pagadas y esta también -> FIN.

                const otrasPendientes = todasCuotas.docs.filter(doc => {
                    return doc.id !== cuota_id && doc.data().pagada === false;
                });

                if (otrasPendientes.length === 0) {
                    await db.collection('prestamos').doc(cuota.prestamo_id).update({
                        cancelado: true,
                        fecha_cancelacion: new Date().toISOString()
                    });
                    console.log(`🎉 PRÉSTAMO ${cuota.prestamo_id} COMPLETADO Y CANCELADO`);
                }
            }

        } else {
            console.log(`⚠️ Webhook recibido pero pago no aprobado (Status: ${paymentStatus.status})`);
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

// TEST ROUTE - SIMULAR PAGO FLOW (SOLO DESARROLLO)
router.get('/test-simulate/:cuota_id/:monto', async (req, res) => {
    try {
        const { cuota_id, monto } = req.params;

        // Simular lógica de webhook sin validación de token
        // Esto es SOLO para probar que la lógica de negocio (BD) funciona
        // En producción DEBE usarse el webhook real

        const db = require('../db/firebase');
        const { calcularMora, esVencida } = require('../services/moraService');

        const cuotaRef = db.collection('cuotas').doc(cuota_id);
        const cuotaSnap = await cuotaRef.get();

        if (!cuotaSnap.exists) return res.status(404).send('Cuota no encontrada');

        const cuota = cuotaSnap.data();
        const monto_pagado = Number(monto);

        const vencida = esVencida(cuota.fecha_vencimiento);
        const moraCalculada = calcularMora(cuota.saldo_pendiente, vencida);
        const saldo_actual = Number(cuota.saldo_pendiente);
        const total_con_mora = saldo_actual + moraCalculada;

        let abono_capital = 0;
        let abono_mora = 0;

        if (monto_pagado >= total_con_mora - 0.5) {
            abono_mora = moraCalculada;
            const remanente = monto_pagado - abono_mora;
            abono_capital = Math.min(remanente, saldo_actual);
        } else {
            abono_mora = 0;
            abono_capital = Math.min(monto_pagado, saldo_actual);
        }

        let nuevo_saldo = Number((saldo_actual - abono_capital).toFixed(2));
        if (nuevo_saldo < 0) nuevo_saldo = 0;

        const pagada = nuevo_saldo <= 0.50;
        if (pagada) nuevo_saldo = 0;

        const batch = db.batch();
        const pagoRef = db.collection('pagos').doc();

        batch.set(pagoRef, {
            cuota_id,
            fecha_pago: new Date().toISOString(),
            monto_pagado,
            medio_pago: 'FLOW_TEST',
            estado: 'APROBADO',
            desglose: { capital: abono_capital, mora: abono_mora }
        });

        batch.update(cuotaRef, {
            saldo_pendiente: nuevo_saldo,
            pagada: pagada
        });

        await batch.commit();

        res.json({
            mensaje: 'Simulación exitosa',
            anterior_saldo: saldo_actual,
            abono_capital,
            abono_mora,
            nuevo_saldo,
            pagada
        });

    } catch (err) {
        res.status(500).send(err.message);
    }
});

module.exports = router;

const admin = require('firebase-admin');
const { calcularMora, esVencida } = require('./moraService');

/**
 * Calcula estado de cuota (mora y totales).
 * @param {Object} cuota
 * @param {number|string} cuota.saldo_pendiente
 * @param {string} cuota.fecha_vencimiento - ISO yyyy-mm-dd
 */
function calcularEstadoCuota(cuota) {
    const saldoActual = Number(cuota.saldo_pendiente);
    const vencida = esVencida(cuota.fecha_vencimiento);
    const moraCalculada = calcularMora(saldoActual, vencida);

    return {
        saldoActual,
        vencida,
        moraCalculada,
        totalConMora: saldoActual + moraCalculada
    };
}

/**
 * Distribuye pago entre capital y mora.
 * Regla: si paga total+mora (tolerancia 0.5), se cobra mora; si es parcial, mora se condona.
 */
function distribuirPagoCuota({ montoPagado, saldoActual, moraCalculada }) {
    const pago = Number(montoPagado);
    let abonoMora = 0;
    let abonoCapital = 0;

    if (pago >= saldoActual + moraCalculada - 0.5) {
        abonoMora = moraCalculada;
        abonoCapital = Math.min(pago - abonoMora, saldoActual);
    } else {
        abonoMora = 0;
        abonoCapital = Math.min(pago, saldoActual);
    }

    let nuevoSaldo = Number((saldoActual - abonoCapital).toFixed(2));
    if (nuevoSaldo < 0) nuevoSaldo = 0;

    const pagada = nuevoSaldo <= 0.5;
    if (pagada) nuevoSaldo = 0;

    return {
        abonoMora,
        abonoCapital,
        nuevoSaldo,
        pagada
    };
}

/**
 * Recalcula saldo y estado del préstamo tomando todas sus cuotas.
 * Actualiza campos: saldo_restante, monto_pagado_total, estado, cancelado, fecha_cancelacion (si aplica).
 */
async function recalcularPrestamoDesdeCuotas(db, prestamoId, cuotaId) {
    const cuotasSnap = await db.collection('cuotas')
        .where('prestamo_id', '==', prestamoId)
        .get();

    let saldoRestante = 0;
    let montoTotal = 0;
    let pendientes = 0;

    cuotasSnap.docs.forEach((doc) => {
        const c = doc.data();
        saldoRestante += Number(c.saldo_pendiente || 0);
        montoTotal += Number(c.monto_cuota || 0);
        if (!c.pagada) pendientes += 1;
    });

    const cancelado = saldoRestante <= 0.5 || pendientes === 0;
    const estado = cancelado ? 'PAGADO' : 'PENDIENTE';
    const montoPagadoTotal = Math.max(0, Number((montoTotal - saldoRestante).toFixed(2)));

    const updateData = {
        saldo_restante: Number(saldoRestante.toFixed(2)),
        monto_pagado_total: montoPagadoTotal,
        estado,
        cancelado
    };

    if (cancelado) {
        updateData.fecha_cancelacion = new Date().toISOString();
    }

    await db.collection('prestamos').doc(prestamoId).set(updateData, { merge: true });

    return {
        saldoRestante: updateData.saldo_restante,
        montoTotal,
        montoPagadoTotal,
        cancelado,
        estado
    };
}

/**
 * Marca préstamo como cancelado si todas las cuotas están pagadas (compatibilidad previa).
 */
async function actualizarPrestamoSiPagado(db, prestamoId, cuotaId) {
    const resumen = await recalcularPrestamoDesdeCuotas(db, prestamoId, cuotaId);
    return resumen.cancelado;
}

/**
 * Agrega un pago al historial del préstamo (array `historial_pagos`).
 */
async function agregarPagoAHistorialPrestamo(db, prestamoId, pago) {
    const pagoReducido = {
        pago_id: pago.pago_id,
        cuota_id: pago.cuota_id,
        monto: Number(pago.monto),
        medio: pago.medio,
        flow_token: pago.flow_token || null,
        flow_order: pago.flow_order || null,
        fecha: pago.fecha || new Date().toISOString()
    };

    await db.collection('prestamos').doc(prestamoId).set({
        historial_pagos: admin.firestore.FieldValue.arrayUnion(pagoReducido)
    }, { merge: true });

    return pagoReducido;
}

module.exports = {
    calcularEstadoCuota,
    distribuirPagoCuota,
    recalcularPrestamoDesdeCuotas,
    actualizarPrestamoSiPagado,
    agregarPagoAHistorialPrestamo
};

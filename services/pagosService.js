const { calcularMora, esVencida } = require('./moraService');

/**
 * Calcula estado de cuota (mora y totales)
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
 * Marca préstamo como cancelado si todas las cuotas están pagadas.
 */
async function actualizarPrestamoSiPagado(db, prestamoId, cuotaId) {
    const todasCuotas = await db.collection('cuotas')
        .where('prestamo_id', '==', prestamoId)
        .get();

    const pendientes = todasCuotas.docs.filter(doc => {
        if (cuotaId && doc.id === cuotaId) return false;
        return doc.data().pagada === false;
    });

    if (pendientes.length === 0) {
        await db.collection('prestamos').doc(prestamoId).update({
            cancelado: true,
            estado: 'PAGADO',
            fecha_cancelacion: new Date().toISOString()
        });
        return true;
    }

    return false;
}

module.exports = {
    calcularEstadoCuota,
    distribuirPagoCuota,
    actualizarPrestamoSiPagado
};

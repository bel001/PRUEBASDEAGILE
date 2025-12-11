const { db } = require('../db/firebase');
const { getSystemDate } = require('../utils/dateHelper');

// Referencia a la colección de movimientos
const movimientosRef = db.collection('movimientos_caja');

/**
 * Registra un movimiento en la caja.
 * @param {string} tipo - 'ENTRADA' o 'SALIDA'
 * @param {number} monto - Monto del movimiento
 * @param {string} descripcion - Descripción del movimiento
 * @param {Object} metadata - Datos adicionales (e.g., pago_id, cuota_id, prestamo_id)
 * @returns {Promise<string>} - ID del documento creado
 */
async function registrarMovimientoCaja(tipo, monto, descripcion, metadata = {}) {
  try {
    if (!monto || monto <= 0) return null;

    const movimiento = {
      tipo,
      monto: Number(monto),
      descripcion,
      fecha: getSystemDate().toISOString(),
      ...metadata
    };

    const docRef = await movimientosRef.add(movimiento);
    console.log(`✅ Movimiento de caja registrado: [${tipo}] S/ ${monto} - ${descripcion}`);
    return docRef.id;
  } catch (error) {
    console.error('❌ Error registrando movimiento de caja:', error);
    throw error; // Propagar error para manejo superior si es crítico
  }
}

module.exports = { registrarMovimientoCaja };

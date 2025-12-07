/**
 * Script para corregir préstamos que ya están pagados pero no marcados como cancelados
 * Ejecutar con: node scripts/fixCanceladoLoans.js
 */

require('dotenv').config();
const db = require('../db/firebase');

async function fixCanceladoLoans() {
    console.log('🔍 Buscando préstamos no marcados como cancelados...\n');

    try {
        // Obtener todos los préstamos activos (cancelado = false)
        const prestamosSnap = await db.collection('prestamos')
            .where('cancelado', '==', false)
            .get();

        if (prestamosSnap.empty) {
            console.log('✅ No hay préstamos activos para revisar.');
            return;
        }

        console.log(`📋 Encontrados ${prestamosSnap.size} préstamos activos. Revisando cuotas...\n`);

        let corregidos = 0;

        for (const prestamoDoc of prestamosSnap.docs) {
            const prestamo = prestamoDoc.data();
            const prestamoId = prestamoDoc.id;

            // Obtener todas las cuotas del préstamo
            const cuotasSnap = await db.collection('cuotas')
                .where('prestamo_id', '==', prestamoId)
                .get();

            if (cuotasSnap.empty) {
                console.log(`⚠️ Préstamo ${prestamoId} no tiene cuotas asociadas.`);
                continue;
            }

            // Verificar si TODAS las cuotas están pagadas
            const todasPagadas = cuotasSnap.docs.every(cuotaDoc => {
                const cuota = cuotaDoc.data();
                return cuota.pagada === true;
            });

            if (todasPagadas) {
                // Marcar préstamo como cancelado
                await db.collection('prestamos').doc(prestamoId).update({
                    cancelado: true,
                    fecha_cancelacion: new Date().toISOString()
                });

                console.log(`✅ Préstamo ${prestamoId} (cliente: ${prestamo.cliente_id}) marcado como CANCELADO`);
                corregidos++;
            } else {
                const pagadas = cuotasSnap.docs.filter(d => d.data().pagada === true).length;
                const total = cuotasSnap.size;
                console.log(`📌 Préstamo ${prestamoId}: ${pagadas}/${total} cuotas pagadas - AÚN ACTIVO`);
            }
        }

        console.log(`\n🎉 Proceso completado. ${corregidos} préstamos corregidos.`);

    } catch (error) {
        console.error('❌ Error:', error.message);
    }

    process.exit(0);
}

fixCanceladoLoans();

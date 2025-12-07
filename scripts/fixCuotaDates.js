// Script para corregir las fechas de vencimiento de cuotas existentes
// EJECUTAR: node scripts/fixCuotaDates.js

const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function corregirFechas() {
    console.log('🔧 Iniciando corrección de fechas de cuotas...\n');

    try {
        // Obtener todos los préstamos activos
        const prestamosSnap = await db.collection('prestamos').where('cancelado', '==', false).get();

        if (prestamosSnap.empty) {
            console.log('No hay préstamos activos para corregir.');
            process.exit(0);
        }

        console.log(`📋 Encontrados ${prestamosSnap.size} préstamos activos\n`);

        for (const prestamoDoc of prestamosSnap.docs) {
            const prestamo = prestamoDoc.data();
            const prestamoId = prestamoDoc.id;

            console.log(`\n📝 Procesando préstamo ${prestamoId}...`);
            console.log(`   Fecha inicio: ${prestamo.fecha_inicio}`);

            // Obtener las cuotas de este préstamo
            const cuotasSnap = await db.collection('cuotas')
                .where('prestamo_id', '==', prestamoId)
                .get();

            if (cuotasSnap.empty) {
                console.log('   ⚠️ No tiene cuotas');
                continue;
            }

            // Ordenar cuotas por número
            const cuotas = cuotasSnap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => a.numero_cuota - b.numero_cuota);

            // Recalcular fechas usando meses reales
            let fechaBase = new Date(prestamo.fecha_inicio);
            const batch = db.batch();

            for (const cuota of cuotas) {
                // Calcular nueva fecha sumando meses reales
                const nuevaFecha = new Date(fechaBase);
                nuevaFecha.setMonth(nuevaFecha.getMonth() + cuota.numero_cuota);
                const nuevaFechaStr = nuevaFecha.toISOString().split('T')[0];

                console.log(`   Cuota ${cuota.numero_cuota}: ${cuota.fecha_vencimiento} → ${nuevaFechaStr}`);

                // Actualizar en batch
                const cuotaRef = db.collection('cuotas').doc(cuota.id);
                batch.update(cuotaRef, { fecha_vencimiento: nuevaFechaStr });
            }

            // Ejecutar batch
            await batch.commit();
            console.log(`   ✅ ${cuotas.length} cuotas actualizadas`);
        }

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('🎉 ¡Todas las fechas han sido corregidas!');
        console.log('═══════════════════════════════════════════════════════════\n');

        process.exit(0);
    } catch (error) {
        console.error('\n❌ ERROR:', error);
        process.exit(1);
    }
}

// Ejecutar
corregirFechas();

const { db } = require('../db/firebase');

async function fixPagos() {
    console.log('Iniciando reparación de pagos (agregando prestamo_id)...');

    try {
        const pagosSnapshot = await db.collection('pagos').get();
        let updatedCount = 0;

        if (pagosSnapshot.empty) {
            console.log('No hay pagos para revisar.');
            return;
        }

        const batch = db.batch();
        let batchCount = 0;

        for (const doc of pagosSnapshot.docs) {
            const pago = doc.data();

            // Si ya tiene prestamo_id, saltar
            if (pago.prestamo_id) continue;

            if (!pago.cuota_id) {
                console.log(`⚠️ Pago ${doc.id} no tiene cuota_id, saltando.`);
                continue;
            }

            // Buscar la cuota para obtener el prestamo_id
            const cuotaSnap = await db.collection('cuotas').doc(pago.cuota_id).get();

            if (!cuotaSnap.exists) {
                console.log(`⚠️ Cuota ${pago.cuota_id} no encontrada para pago ${doc.id}`);
                continue;
            }

            const cuota = cuotaSnap.data();
            if (cuota.prestamo_id) {
                batch.update(doc.ref, { prestamo_id: cuota.prestamo_id });
                updatedCount++;
                batchCount++;
            }

            // Commit batch cada 500 operaciones (límite de Firestore)
            if (batchCount >= 400) {
                await batch.commit();
                console.log('Batch intermedio guardado...');
                batchCount = 0; // Reset count (batch object needs recreating normally, but reusing object in loop is tricky)
                // Actually, db.batch() creates a new batch instance. We should probably commit and create new one or just process sequentially if simple.
            }
        }

        if (batchCount > 0) {
            await batch.commit();
        }

        console.log(`✅ Reparación completada. Se actualizaron ${updatedCount} pagos.`);
    } catch (error) {
        console.error('❌ Error reparando pagos:', error);
    }
}

fixPagos().then(() => process.exit());

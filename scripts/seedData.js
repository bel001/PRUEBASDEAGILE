// Script para poblar Firebase con datos de prueba para la exposición
// EJECUTAR: node scripts/seedData.js

const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function poblarDatos() {
    console.log('🌱 Iniciando población de datos de prueba...\n');

    try {
        // ============================================
        // Cliente 1: Juan Pérez - Para demostrar MORA
        // ============================================
        console.log('📝 Creando Cliente 1: Juan Pérez...');
        const cliente1Ref = await db.collection('clientes').add({
            tipo: 'NATURAL',
            documento: '12345678',
            nombre: 'PEREZ GARCIA JUAN CARLOS',
            direccion: 'Av. Larco 567, Miraflores',
            email: 'juan.perez@example.com',
            telefono: '999888777',
            creado_en: new Date().toISOString()
        });
        console.log('   ✅ Cliente creado con ID:', cliente1Ref.id);

        // Préstamo para Juan
        const prestamo1Ref = await db.collection('prestamos').add({
            cliente_id: cliente1Ref.id,
            monto_total: 1000,
            num_cuotas: 10,
            monto_por_cuota: 100,
            fecha_inicio: '2024-11-01',
            cancelado: false,
            creado_en: new Date().toISOString()
        });
        console.log('   ✅ Préstamo creado con ID:', prestamo1Ref.id);

        // Cuota 1: Pagada (ejemplo de cuota ya pagada)
        await db.collection('cuotas').add({
            prestamo_id: prestamo1Ref.id,
            cliente_id: cliente1Ref.id,
            numero_cuota: 1,
            fecha_vencimiento: '2024-12-01',
            monto_cuota: 100,
            saldo_pendiente: 0,
            pagada: true
        });

        // Cuota 2: Pagada
        await db.collection('cuotas').add({
            prestamo_id: prestamo1Ref.id,
            cliente_id: cliente1Ref.id,
            numero_cuota: 2,
            fecha_vencimiento: '2024-12-31',
            monto_cuota: 100,
            saldo_pendiente: 0,
            pagada: true
        });

        // Cuota 3: VENCIDA hace 30 días (para demo de mora)
        const hace30Dias = new Date();
        hace30Dias.setDate(hace30Dias.getDate() - 30);
        await db.collection('cuotas').add({
            prestamo_id: prestamo1Ref.id,
            cliente_id: cliente1Ref.id,
            numero_cuota: 3,
            fecha_vencimiento: hace30Dias.toISOString().split('T')[0],
            monto_cuota: 100,
            saldo_pendiente: 100,
            pagada: false
        });
        console.log('   ✅ Cuota VENCIDA creada (30 días de atraso)');

        // Cuota 4: Pendiente (vence en 10 días)
        const en10Dias = new Date();
        en10Dias.setDate(en10Dias.getDate() + 10);
        await db.collection('cuotas').add({
            prestamo_id: prestamo1Ref.id,
            cliente_id: cliente1Ref.id,
            numero_cuota: 4,
            fecha_vencimiento: en10Dias.toISOString().split('T')[0],
            monto_cuota: 100,
            saldo_pendiente: 100,
            pagada: false
        });

        // Cuota 5: MONTO BAJO para demo con transferencia real (S/ 0.10)
        const en40Dias = new Date();
        en40Dias.setDate(en40Dias.getDate() + 40);
        await db.collection('cuotas').add({
            prestamo_id: prestamo1Ref.id,
            cliente_id: cliente1Ref.id,
            numero_cuota: 5,
            fecha_vencimiento: en40Dias.toISOString().split('T')[0],
            monto_cuota: 0.10,
            saldo_pendiente: 0.10,
            pagada: false
        });
        console.log('   ✅ Cuota de S/ 0.10 creada para demo con pago real\n');

        // ============================================
        // Cliente 2: María López - Para demostrar REDONDEO
        // ============================================
        console.log('📝 Creando Cliente 2: María López...');
        const cliente2Ref = await db.collection('clientes').add({
            tipo: 'NATURAL',
            documento: '87654321',
            nombre: 'LOPEZ MARTINEZ MARIA ELENA',
            direccion: 'Jr. Los Olivos 456, San Isidro',
            email: 'maria.lopez@example.com',
            telefono: '988777666',
            creado_en: new Date().toISOString()
        });
        console.log('   ✅ Cliente creado con ID:', cliente2Ref.id);

        const prestamo2Ref = await db.collection('prestamos').add({
            cliente_id: cliente2Ref.id,
            monto_total: 500,
            num_cuotas: 15,
            monto_por_cuota: 33.33,
            fecha_inicio: new Date().toISOString().split('T')[0],
            cancelado: false,
            creado_en: new Date().toISOString()
        });
        console.log('   ✅ Préstamo creado con ID:', prestamo2Ref.id);

        // Cuota de S/ 33.33 para demostrar redondeo (33.33 -> 33.30 en efectivo)
        const hoy = new Date();
        await db.collection('cuotas').add({
            prestamo_id: prestamo2Ref.id,
            cliente_id: cliente2Ref.id,
            numero_cuota: 1,
            fecha_vencimiento: hoy.toISOString().split('T')[0],
            monto_cuota: 33.33,
            saldo_pendiente: 33.33,
            pagada: false
        });
        console.log('   ✅ Cuota de S/ 33.33 creada para demo de redondeo\n');

        // ============================================
        // Cliente 3: Carlos Ruiz - MORA 2 MESES (60 días)
        // ============================================
        console.log('📝 Creando Cliente 3: Carlos Ruiz (MORA GRAVE)...');
        const cliente3Ref = await db.collection('clientes').add({
            tipo: 'NATURAL',
            documento: '11111111',
            nombre: 'RUIZ SANCHEZ CARLOS ALBERTO',
            direccion: 'Av. Argentina 789, Cercado de Lima',
            email: 'carlos.ruiz@example.com',
            telefono: '977666555',
            creado_en: new Date().toISOString()
        });
        console.log('   ✅ Cliente creado con ID:', cliente3Ref.id);

        const prestamo3Ref = await db.collection('prestamos').add({
            cliente_id: cliente3Ref.id,
            monto_total: 2000,
            num_cuotas: 20,
            monto_por_cuota: 100,
            fecha_inicio: '2024-09-01',
            cancelado: false,
            creado_en: new Date().toISOString()
        });
        console.log('   ✅ Préstamo creado con ID:', prestamo3Ref.id);

        // Cuota VENCIDA hace 60 días (2 meses de mora)
        const hace60Dias = new Date();
        hace60Dias.setDate(hace60Dias.getDate() - 60);
        await db.collection('cuotas').add({
            prestamo_id: prestamo3Ref.id,
            cliente_id: cliente3Ref.id,
            numero_cuota: 1,
            fecha_vencimiento: hace60Dias.toISOString().split('T')[0],
            monto_cuota: 100,
            saldo_pendiente: 100,
            pagada: false
        });
        console.log('   ✅ Cuota VENCIDA creada (60 días = 2 MESES de atraso)\n');

        // ============================================
        // Cliente 4: Ana Torres - AL DÍA (sin mora)
        // ============================================
        console.log('📝 Creando Cliente 4: Ana Torres (AL DÍA)...');
        const cliente4Ref = await db.collection('clientes').add({
            tipo: 'NATURAL',
            documento: '22222222',
            nombre: 'TORRES MEDINA ANA LUCIA',
            direccion: 'Calle Las Flores 321, Miraflores',
            email: 'ana.torres@example.com',
            telefono: '966555444',
            creado_en: new Date().toISOString()
        });
        console.log('   ✅ Cliente creado con ID:', cliente4Ref.id);

        const prestamo4Ref = await db.collection('prestamos').add({
            cliente_id: cliente4Ref.id,
            monto_total: 500,
            num_cuotas: 5,
            monto_por_cuota: 100,
            fecha_inicio: new Date().toISOString().split('T')[0],
            cancelado: false,
            creado_en: new Date().toISOString()
        });
        console.log('   ✅ Préstamo creado con ID:', prestamo4Ref.id);

        // Cuota que vence en 15 días (SIN MORA)
        const en15Dias = new Date();
        en15Dias.setDate(en15Dias.getDate() + 15);
        await db.collection('cuotas').add({
            prestamo_id: prestamo4Ref.id,
            cliente_id: cliente4Ref.id,
            numero_cuota: 1,
            fecha_vencimiento: en15Dias.toISOString().split('T')[0],
            monto_cuota: 100,
            saldo_pendiente: 100,
            pagada: false
        });
        console.log('   ✅ Cuota AL DÍA creada (vence en 15 días, SIN MORA)\n');

        // ============================================
        // Cliente 5: Empresa SAC - Para probar RUC
        // ============================================
        console.log('📝 Creando Cliente 5: Empresa Demo SAC...');
        const cliente5Ref = await db.collection('clientes').add({
            tipo: 'JURIDICA',
            documento: '20512345678',
            nombre: 'DISTRIBUIDORA EL SOL S.A.C.',
            direccion: 'Av. Industrial 1500, Ate Vitarte',
            email: 'contacto@distribuidoraelsol.com',
            telefono: '016543210',
            creado_en: new Date().toISOString()
        });
        console.log('   ✅ Cliente EMPRESA creado con ID:', cliente5Ref.id);

        const prestamo5Ref = await db.collection('prestamos').add({
            cliente_id: cliente5Ref.id,
            monto_total: 5000,
            num_cuotas: 10,
            monto_por_cuota: 500,
            fecha_inicio: new Date().toISOString().split('T')[0],
            cancelado: false,
            creado_en: new Date().toISOString()
        });
        console.log('   ✅ Préstamo creado con ID:', prestamo5Ref.id);

        // Cuota de S/ 0.10 para demo con pago real
        const en30Dias = new Date();
        en30Dias.setDate(en30Dias.getDate() + 30);
        await db.collection('cuotas').add({
            prestamo_id: prestamo5Ref.id,
            cliente_id: cliente5Ref.id,
            numero_cuota: 1,
            fecha_vencimiento: en30Dias.toISOString().split('T')[0],
            monto_cuota: 0.10,
            saldo_pendiente: 0.10,
            pagada: false
        });
        console.log('   ✅ Cuota de S/ 0.10 creada para demo pago YAPE real\n');

        // ============================================
        // RESUMEN
        // ============================================
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🎉 ¡Datos semilla creados exitosamente!');
        console.log('═══════════════════════════════════════════════════════════\n');
        console.log('📋 CLIENTES CREADOS PARA LA EXPOSICIÓN:\n');
        console.log('1️⃣  JUAN PÉREZ (DNI: 12345678)');
        console.log('    - Cuota #3: S/ 100.00 VENCIDA hace 30 días');
        console.log('    - Mora esperada: S/ 1.00 (1%)');
        console.log('    - Cuota #5: S/ 0.10 (para pago real con Yape)\n');
        console.log('2️⃣  MARÍA LÓPEZ (DNI: 87654321)');
        console.log('    - Cuota #1: S/ 33.33 AL DÍA');
        console.log('    - Redondeo en efectivo: S/ 33.30');
        console.log('    - Ajuste: -S/ 0.03\n');
        console.log('3️⃣  CARLOS RUIZ (DNI: 11111111) [MORA GRAVE]');
        console.log('    - Cuota #1: S/ 100.00 VENCIDA hace 60 DÍAS (2 meses)');
        console.log('    - Mora esperada: S/ 2.00 (2%)\n');
        console.log('4️⃣  ANA TORRES (DNI: 22222222) [AL DÍA]');
        console.log('    - Cuota #1: S/ 100.00 vence en 15 días');
        console.log('    - SIN MORA (mora debe ser S/ 0.00)\n');
        console.log('5️⃣  DISTRIBUIDORA EL SOL S.A.C. (RUC: 20512345678) [EMPRESA]');
        console.log('    - Cuota #1: S/ 0.10 (para demo pago real Yape)');
        console.log('    - Demuestra soporte para personas jurídicas\n');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('✅ Base de datos lista para la exposición académica');
        console.log('═══════════════════════════════════════════════════════════\n');

        process.exit(0);
    } catch (error) {
        console.error('\n❌ ERROR al crear datos:', error);
        process.exit(1);
    }
}

// Ejecutar
poblarDatos();

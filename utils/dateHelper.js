const { db } = require('../db/firebase');

let timeOffset = 0;

async function initDateHelper() {
    try {
        const doc = await db.collection('configuracion').doc('sistema').get();
        if (doc.exists && doc.data().fecha_simulada) {
            const fechaSimulada = new Date(doc.data().fecha_simulada);
            const now = new Date();
            // Calculamos offset aproximado
            // Si la fecha guardada es vieja, el "ahora simulado" seguirá avanzando desde esa fecha.
            // Para ser precisos con lo que el usuario guardó la última vez:
            // Guardamos el offset directamente? No, porque si reinicio el server 1 hora después, el offset sirve.
            // Pero si guardo una fecha estática "2023-01-01", al reiniciar quiero seguir cerca de ahí.
            // El enfoque de offset es bueno. Recalculamos el offset respecto al 'ahora' del reinicio?
            // No, el offset debe ser: (FechaSimuladaDeseada - FechaRealEnEseMomento).
            // Pero si guardo solo fecha_simulada en la BD, cuando reinicie 1 dia despues,
            // "volvera" a la fecha simulada original (viajando al pasado 1 dia relativo).
            // Lo ideal es guardar el `timeOffset` en BD.

            if (doc.data().time_offset !== undefined) {
                timeOffset = Number(doc.data().time_offset);
            } else {
                // Migración o fallback
                timeOffset = fechaSimulada.getTime() - now.getTime();
            }

            console.log(`📅 Fecha sistema cargada con offset: ${timeOffset}ms. Fecha actual simulada: ${getSystemDate().toLocaleString()}`);
        }
    } catch (e) {
        console.error('Error inicializando fecha sistema:', e);
    }
}

function getSystemDate() {
    return new Date(Date.now() + timeOffset);
}

function getSystemDateString() {
    // Retorna YYYY-MM-DD
    // Usamos toLocaleDateString con formato sueco (ISO like) o manual para evitar líos de zona horaria local,
    // pero idealmente toISOString() usa UTC. 
    // Si queremos hora local simulada, ajustamos zona horaria.
    // Usaremos un truco: new Date(dt.getTime() - (dt.getTimezoneOffset() * 60000)).toISOString()
    const dt = getSystemDate();
    const localIso = new Date(dt.getTime() - (dt.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    return localIso;
}

async function setSystemDate(isoDateString) {
    // isoDateString es YYYY-MM-DD
    const targetDate = new Date(isoDateString + 'T12:00:00'); // Mediodía para evitar bordes de día
    const now = new Date();

    // Calculamos nuevo offset
    timeOffset = targetDate.getTime() - now.getTime();

    // Guardar offset en BD para persistencia
    await db.collection('configuracion').doc('sistema').set({
        fecha_simulada: targetDate.toISOString(),
        time_offset: timeOffset
    }, { merge: true });

    return getSystemDate();
}

module.exports = { initDateHelper, getSystemDate, getSystemDateString, setSystemDate };

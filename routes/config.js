const express = require('express');
const router = express.Router();
const { getSystemDate, setSystemDate, getSystemDateString } = require('../utils/dateHelper');

// GET /config/fecha - Obtener fecha actual del sistema
router.get('/fecha', (req, res) => {
    res.json({
        fecha: getSystemDateString(),
        iso: getSystemDate().toISOString(),
        timestamp: getSystemDate().getTime()
    });
});

const { db } = require('../db/firebase');

// POST /config/fecha - Cambiar fecha del sistema
router.post('/fecha', async (req, res) => {
    const { fecha } = req.body; // YYYY-MM-DD

    if (!fecha) {
        return res.status(400).json({ error: 'Se requiere fecha (YYYY-MM-DD)' });
    }

    try {
        // VALIDACIÓN DE CAJA ABIERTA
        // Obtener la última caja registrada
        const cajaSnapshot = await db.collection('cierre_caja')
            .orderBy('fecha', 'desc')
            .limit(1)
            .get();

        if (!cajaSnapshot.empty) {
            const ultimaCaja = cajaSnapshot.docs[0].data();

            // Si la caja existe y NO está cerrada, bloquemos el cambio
            if (ultimaCaja.cerrado === false) {
                return res.status(400).json({
                    error: '⚠️ Caja Abierta. Debe cerrar la caja del día actual antes de cambiar la fecha del sistema.'
                });
            }
        }

        await setSystemDate(fecha);
        res.json({
            mensaje: 'Fecha del sistema actualizada correctamente',
            nueva_fecha: getSystemDateString()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

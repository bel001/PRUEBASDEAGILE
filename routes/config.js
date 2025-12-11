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

// POST /config/fecha - Cambiar fecha del sistema
router.post('/fecha', async (req, res) => {
    const { fecha } = req.body; // YYYY-MM-DD

    if (!fecha) {
        return res.status(400).json({ error: 'Se requiere fecha (YYYY-MM-DD)' });
    }

    try {
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

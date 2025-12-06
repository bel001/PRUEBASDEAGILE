require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

const clientesRoutes = require('./routes/clientes');
const prestamosRoutes = require('./routes/prestamos');
const pagosRoutes = require('./routes/pagos');
const cajaRoutes = require('./routes/caja');

app.use(cors());
app.use(express.json());

// API Routes
app.use('/clientes', clientesRoutes);
app.use('/prestamos', prestamosRoutes);
app.use('/pagos', pagosRoutes);
app.use('/caja', cajaRoutes);

// Health check para Render
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'fronted')));

// Ruta catch-all: cualquier ruta no API sirve el frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'fronted', 'Index.html'));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API escuchando en puerto ${PORT}`);
});

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

const clientesRoutes = require('./routes/clientes');
const prestamosRoutes = require('./routes/prestamos');
const pagosRoutes = require('./routes/pagos');
const cajaRoutes = require('./routes/caja');
const flowRoutes = require('./routes/flow');

app.use(cors());
app.use(express.json());
// Soporte para datos de formularios (necesario para el retorno de Flow)
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/clientes', clientesRoutes);
app.use('/prestamos', prestamosRoutes);
app.use('/pagos', pagosRoutes);
app.use('/caja', cajaRoutes);
app.use('/flow', flowRoutes);

// Health check para Render
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Manejar retorno de Flow (POST a la raíz cuando vuelve del pago)
app.post('/', (req, res) => {
  console.log('📩 Retorno de Flow recibido:', req.body);
  // Redirigir al frontend con los parámetros
  const token = req.body.token || '';
  res.redirect(`/?pago=flow&token=${token}`);
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

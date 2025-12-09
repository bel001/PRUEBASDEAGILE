const axios = require('axios');

const TOKEN = process.env.DNI_API_TOKEN;
// URLs de la API V1 (La que te funcionó)
const URL_DNI = 'https://api.apis.net.pe/v1/dni?numero=';
const URL_RUC = 'https://api.apis.net.pe/v1/ruc?numero=';

// Cache para evitar llamadas repetidas (rate limiting)
const cache = new Map();
const CACHE_TTL = 60000; // 1 minuto

// Función para limpiar cache antigua
function cleanCache() {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      cache.delete(key);
    }
  }
}

async function consultarDni(numero) {
  // Limpiar cache antigua
  cleanCache();

  // Verificar si está en cache
  const cacheKey = `dni_${numero}`;
  if (cache.has(cacheKey)) {
    console.log(`📦 DNI ${numero} desde cache`);
    return cache.get(cacheKey).data;
  }

  try {
    console.log(`📡 Consultando DNI ${numero}...`);
    const response = await axios.get(`${URL_DNI}${numero}`, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Referer': 'https://apis.net.pe/api-tipo-cambio-v2',
        'Accept': 'application/json'
      },
      timeout: 5000
    });

    const data = response.data;
    console.log("✅ DNI Encontrado:", data.nombre);

    // Mapeo seguro para DNI
    const result = {
      nombre: data.nombre || `${data.nombres} ${data.apellidoPaterno} ${data.apellidoMaterno}`,
      nombres: data.nombres,
      apellidoPaterno: data.apellidoPaterno,
      apellidoMaterno: data.apellidoMaterno,
      direccion: data.direccion || ''
    };

    // Guardar en cache
    cache.set(cacheKey, { data: result, timestamp: Date.now() });

    return result;
  } catch (error) {
    console.error("❌ Error DNI:", error.message);

    // Si es error 429, retornar mensaje amigable
    if (error.response && error.response.status === 429) {
      throw new Error(`Demasiadas consultas. Espere un momento antes de intentar de nuevo.`);
    }

    throw new Error(`No se pudo consultar DNI ${numero}: ${error.message}`);
  }
}

async function consultarRuc(numero) {
  // Limpiar cache antigua
  cleanCache();

  // Verificar si está en cache
  const cacheKey = `ruc_${numero}`;
  if (cache.has(cacheKey)) {
    console.log(`📦 RUC ${numero} desde cache`);
    return cache.get(cacheKey).data;
  }

  try {
    console.log(`📡 Consultando RUC ${numero}...`);
    const response = await axios.get(`${URL_RUC}${numero}`, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Referer': 'https://apis.net.pe/api-tipo-cambio-v2',
        'Accept': 'application/json'
      },
      timeout: 5000
    });

    const data = response.data;
    console.log("✅ RUC Encontrado:", data.nombre || data.razonSocial);

    // Mapeo seguro para RUC
    const result = {
      razonSocial: data.nombre || data.razonSocial || `Empresa RUC ${numero}`,
      direccion: data.direccion || '',
      estado: data.estado || '',
      condicion: data.condicion || ''
    };

    // Guardar en cache
    cache.set(cacheKey, { data: result, timestamp: Date.now() });

    return result;
  } catch (error) {
    console.error("❌ Error RUC:", error.message);

    // Si es error 429, retornar mensaje amigable
    if (error.response && error.response.status === 429) {
      throw new Error(`Demasiadas consultas. Espere un momento antes de intentar de nuevo.`);
    }

    throw new Error(`No se pudo consultar RUC ${numero}: ${error.message}`);
  }
}

module.exports = { consultarDni, consultarRuc };
const axios = require('axios');

const TOKEN = process.env.DNI_API_TOKEN;
// URLs de la API V1 (La que te funcionó)
const URL_DNI = 'https://api.apis.net.pe/v1/dni?numero=';
const URL_RUC = 'https://api.apis.net.pe/v1/ruc?numero=';

async function consultarDni(numero) {
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
    return {
      nombre: data.nombre || `${data.nombres} ${data.apellidoPaterno} ${data.apellidoMaterno}`,
      nombres: data.nombres,
      apellidoPaterno: data.apellidoPaterno,
      apellidoMaterno: data.apellidoMaterno,
      direccion: data.direccion || ''
    };
  } catch (error) {
    console.error("❌ Error DNI:", error.message);
    // NO retornar datos falsos - lanzar error para que el frontend sepa que falló
    throw new Error(`No se pudo consultar DNI ${numero}: ${error.message}`);
  }
}

async function consultarRuc(numero) {
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

    // Mapeo seguro para RUC (A veces viene como 'nombre' o 'razonSocial')
    return {
      razonSocial: data.nombre || data.razonSocial || `Empresa RUC ${numero}`,
      direccion: data.direccion || '',
      estado: data.estado || '',
      condicion: data.condicion || ''
    };
  } catch (error) {
    console.error("❌ Error RUC:", error.message);
    // NO retornar datos falsos - lanzar error
    throw new Error(`No se pudo consultar RUC ${numero}: ${error.message}`);
  }
}

module.exports = { consultarDni, consultarRuc };

const axios = require('axios');

const BASE_URL = 'https://api.decolecta.com/api/v1';

async function consultarDni(dni) {
  const res = await axios.get(`${BASE_URL}/dni/${dni}`, {
    headers: { Authorization: `Bearer ${process.env.DNI_API_TOKEN}` }
  });
  return res.data;
}

async function consultarRuc(ruc) {
  const res = await axios.get(`${BASE_URL}/ruc/${ruc}`, {
    headers: { Authorization: `Bearer ${process.env.DNI_API_TOKEN}` }
  });
  return res.data;
}

module.exports = { consultarDni, consultarRuc };
const crypto = require('crypto');
const axios = require('axios');

const FLOW_BASE_URL = process.env.FLOW_ENV === 'sandbox'
    ? 'https://sandbox.flow.cl/api'
    : 'https://www.flow.cl/api';

const API_KEY = process.env.FLOW_API_KEY;
const SECRET_KEY = process.env.FLOW_SECRET_KEY;

/**
 * Genera firma HMAC-SHA256 de los parámetros
 */
function generateSignature(params) {
    // Ordenar alfabéticamente
    const sortedKeys = Object.keys(params).sort();

    // Concatenar: key1=value1&key2=value2
    const concatenated = sortedKeys
        .map(key => `${key}=${params[key]}`)
        .join('&');

    // Firmar con HMAC-SHA256
    const signature = crypto
        .createHmac('sha256', SECRET_KEY)
        .update(concatenated)
        .digest('hex');

    return signature;
    // Generar firma
    params.s = generateSignature(params);

    console.log('🔵 Flow createPayment params:', params);

    try {
        // Convertir objeto a URL-encoded string para el body
        const formData = new URLSearchParams();
        Object.keys(params).forEach(key => {
            formData.append(key, params[key]);
        });

        const response = await axios.post(`${FLOW_BASE_URL}/payment/create`, formData.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        console.log('✅ Flow payment created:', response.data);
        return response.data; // { flowOrder, url, token }
    } catch (error) {
        console.error('❌ Error Flow createPayment:', error.response?.data || error.message);
        throw new Error(error.response?.data?.message || 'Error creando pago en Flow');
    }
}

/**
 * Obtener estado del pago
 */
async function getPaymentStatus(token) {
    const params = {
        apiKey: API_KEY,
        token: token
    };

    params.s = generateSignature(params);

    try {
        const response = await axios.get(`${FLOW_BASE_URL}/payment/getStatus`, {
            params
        });

        console.log('✅ Flow payment status:', response.data);
        return response.data;
        /* 
        {
          flowOrder, commerceOrder, requestDate, status, subject,
          currency, amount, payer, paymentData, merchantId
        }
        status: 1 = Pendiente, 2 = Pagado, 3 = Rechazado, 4 = Anulado
        */
    } catch (error) {
        console.error('❌ Error Flow getStatus:', error.response?.data || error.message);
        throw new Error('Error consultando estado del pago');
    }
}

module.exports = { createPayment, getPaymentStatus };

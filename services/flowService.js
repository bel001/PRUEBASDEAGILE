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
}

/**
 * Crear orden de pago en Flow
 */
async function createPayment(data) {
    // Flow requiere mínimo S/. 2.00 PEN
    const finalAmount = Math.max(Math.round(data.amount), 2);

    const params = {
        apiKey: API_KEY,
        commerceOrder: data.commerceOrder,
        subject: data.subject,
        currency: 'PEN', // Soles peruanos
        amount: finalAmount,
        email: data.email,
        urlConfirmation: data.urlConfirmation,
        urlReturn: data.urlReturn,
        paymentMethod: 9
    };

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
        return response.data;
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
        const formData = new URLSearchParams();
        Object.keys(params).forEach(key => {
            formData.append(key, params[key]);
        });

        const response = await axios.post(`${FLOW_BASE_URL}/payment/getStatus`, formData.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        console.log('✅ Flow payment status:', response.data);
        return response.data;
    } catch (error) {
        console.error('❌ Error Flow getStatus:', error.response?.data || error.message);
        throw new Error('Error consultando estado del pago');
    }
}

module.exports = { createPayment, getPaymentStatus };

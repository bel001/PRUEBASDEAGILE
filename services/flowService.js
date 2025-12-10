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
    const sortedKeys = Object.keys(params).sort();
    const concatenated = sortedKeys
        .map(key => `${key}=${params[key]}`)
        .join('&');

    const signature = crypto
        .createHmac('sha256', SECRET_KEY)
        .update(concatenated)
        .digest('hex');

    return signature;
}

/**
 * Función de espera para reintentos
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Crea una orden de pago en Flow
 * @param {Object} data - Datos del pago (monto, email, orden, etc.)
 */
async function createPayment(data) {
    // MODO MOCK LOCAL: Si estamos en entorno de pruebas local, no llamar a Flow
    if (process.env.FLOW_ENV === 'local_mock') {
        console.log('🧪 MODO MOCK: Simulando creación de pago Flow');
        // Codificar commerceOrder en el token para recuperarlo después
        const mockToken = `MOCK_${data.commerceOrder}_${Date.now()}`;

        // Retornamos una URL local para "pagar"
        const baseUrl = process.env.BASE_URL || 'http://localhost:4000';
        return {
            token: mockToken,
            url: `${baseUrl}/flow/mock/pay?token=${mockToken}`, // Token en query param
            flowOrder: 123456
        };
    }

    // MODO NORMAL (Sandbox/Producción)
    // Flow requiere mínimo S/. 2.00 PEN
    const finalAmount = Math.max(Math.round(data.amount), 2);

    const params = {
        apiKey: API_KEY,
        commerceOrder: data.commerceOrder,
        subject: data.subject,
        currency: 'PEN',
        amount: finalAmount,
        email: data.email,
        paymentMethod: 9, // 9 = All methods
        urlConfirmation: data.urlConfirmation,
        urlReturn: data.urlReturn,
    };

    params.s = generateSignature(params);

    console.log('🔵 Flow createPayment params:', params);

    try {
        const formData = new URLSearchParams();
        Object.keys(params).forEach(key => {
            formData.append(key, params[key]);
        });

        const response = await axios.post(`${FLOW_BASE_URL}/payment/create`, formData.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 30000
        });

        console.log('✅ Flow payment created:', response.data);
        return response.data;
    } catch (error) {
        console.error('❌ Error Flow createPayment:', error.response?.data || error.message);
        throw new Error(error.response?.data?.message || 'Error creando pago en Flow');
    }
}

/**
 * Obtener estado del pago CON REINTENTOS
 * @param {string} token - Token del pago
 * @param {number} maxRetries - Máximo de reintentos (default: 2 para respuesta rápida)
 * @param {number} delayMs - Delay entre reintentos en ms (default: 2000)
 */
async function getPaymentStatus(token, maxRetries = 2, delayMs = 2000) {
    // MODO MOCK LOCAL: Si el token es de simulación
    if (token.startsWith('MOCK_')) {
        console.log('🧪 MODO MOCK: Simulando consulta de estado para', token);
        // Token formato: MOCK_XXX_TIMESTAMP
        const parts = token.split('_');
        const commerceOrder = parts[1] || '123456';

        return {
            status: 2, // 2 = Pagada
            commerceOrder: commerceOrder,
            amount: 100, // Dummy (deberíamos guardarla si queremos exactitud, pero para mock ok)
            subject: 'Pago Simulado (Mock)',
            payer: 'tester@localhost',
            token: token
        };
    }

    const params = {
        apiKey: API_KEY,
        token: token
    };

    params.s = generateSignature(params);

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🔄 Consultando estado pago Flow (intento ${attempt}/${maxRetries})...`);

            const formData = new URLSearchParams();
            Object.keys(params).forEach(key => {
                formData.append(key, params[key]);
            });

            const response = await axios.post(`${FLOW_BASE_URL}/payment/getStatus`, formData.toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 15000
            });

            console.log('✅ Flow payment status:', response.data);
            return response.data;

        } catch (error) {
            lastError = error;
            const errorData = error.response?.data;
            const errorCode = errorData?.code;
            const errorMsg = errorData?.message || error.message;

            console.error(`❌ Error Flow getStatus (intento ${attempt}):`, errorData || errorMsg);

            // Errores que NO merecen reintento
            const noRetryErrors = [1, 2, 3, 4]; // errores de autenticación/parámetros
            if (noRetryErrors.includes(errorCode)) {
                console.error('❌ Error permanente de Flow, no se reintentará');
                throw new Error(`Flow Error ${errorCode}: ${errorMsg}`);
            }

            // Error 105 (No services available) y otros temporales - reintentar
            if (attempt < maxRetries) {
                console.log(`⏳ Esperando ${delayMs}ms antes de reintentar...`);
                await sleep(delayMs);
                delayMs *= 1.5; // Backoff exponencial suave
            }
        }
    }

    // Si llegamos aquí, agotamos reintentos
    console.error('❌ Agotados los reintentos para getPaymentStatus');
    throw new Error(`Error consultando estado del pago después de ${maxRetries} intentos`);
}

/**
 * Verificar si Flow está disponible
 */
async function checkFlowHealth() {
    try {
        // Intentar hacer una consulta simple
        const response = await axios.get(`${FLOW_BASE_URL}/../`, {
            timeout: 5000
        });
        return { available: true };
    } catch (error) {
        return { available: false, error: error.message };
    }
}

module.exports = { createPayment, getPaymentStatus, checkFlowHealth };

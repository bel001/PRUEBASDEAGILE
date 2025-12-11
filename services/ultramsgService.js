const axios = require('axios');
require('dotenv').config(); // Asegurar variables de entorno

/**
 * Servicio para integrar con UltraMSG API (WhatsApp Gateway)
 * Documentación: https://docs.ultramsg.com/
 */

const INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN = process.env.ULTRAMSG_TOKEN;
const API_URL = 'https://api.ultramsg.com';

/**
 * Normaliza el número de teléfono
 * @param {string} phone - Número original
 * @returns {string} - Número limpio y formateado para UltraMSG (sin +)
 */
function normalizePhone(phone) {
    if (!phone) return '';
    // Quitar todo lo que no sea número
    let clean = phone.toString().replace(/\D/g, '');

    // Ajuste básico para Perú (si el usuario ingresa 999111222, agregar 51)
    if (clean.length === 9 && clean.startsWith('9')) {
        clean = '51' + clean;
    }

    return clean; // UltraMSG espera 51999111222
}

/**
 * Envía un mensaje de texto por WhatsApp
 * @param {string} to - Número destino
 * @param {string} message - Texto del mensaje
 */
async function sendWhatsAppText(to, message) {
    try {
        if (!INSTANCE_ID || !TOKEN) {
            console.warn('⚠️ UltraMSG: Faltan variables de entorno ULTRAMSG_INSTANCE_ID o ULTRAMSG_TOKEN');
            return;
        }

        const cleanNumber = normalizePhone(to);
        if (!cleanNumber) {
            console.warn('⚠️ UltraMSG: Número de destino inválido o vacío');
            return;
        }

        const endpoint = `${API_URL}/${INSTANCE_ID}/messages/chat`;

        const params = new URLSearchParams();
        params.append('token', TOKEN);
        params.append('to', cleanNumber);
        params.append('body', message);
        params.append('priority', '10');

        console.log(`📤 Enviando WhatsApp Text a ${cleanNumber}...`);

        const response = await axios.post(endpoint, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        console.log('✅ UltraMSG Text Status:', response.data);
        return response.data;

    } catch (error) {
        console.error('❌ Error enviando WhatsApp Text:', error.response ? error.response.data : error.message);
        // No lanzamos el error para no interrumpir el flujo principal del pago
    }
}

/**
 * Envía un documento (PDF, Imagen) por WhatsApp
 * @param {string} to - Número destino
 * @param {string} pdfUrl - URL pública del archivo
 * @param {string} filename - Nombre del archivo a mostrar
 * @param {string} caption - Texto opcional acompañando la imagen
 */
async function sendWhatsAppPdf(to, pdfUrl, filename = 'comprobante.pdf', caption = '') {
    try {
        if (!INSTANCE_ID || !TOKEN) {
            console.warn('⚠️ UltraMSG: Faltan variables de entorno');
            return;
        }

        const cleanNumber = normalizePhone(to);
        if (!cleanNumber || !pdfUrl) return;

        const endpoint = `${API_URL}/${INSTANCE_ID}/messages/document`;

        const params = new URLSearchParams();
        params.append('token', TOKEN);
        params.append('to', cleanNumber);
        params.append('document', pdfUrl);
        params.append('filename', filename);
        params.append('caption', caption);

        // Nota: Para enviar base64, se usaría el endpoint /messages/image o /messages/document
        // pasando el base64 directamente en el body, pero UltraMSG prefiere URL pública.

        console.log(`📤 Enviando WhatsApp Document a ${cleanNumber}...`);

        const response = await axios.post(endpoint, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        console.log('✅ UltraMSG Generic Doc Status:', response.data);
        return response.data;

    } catch (error) {
        console.error('❌ Error enviando WhatsApp PDF:', error.response ? error.response.data : error.message);
    }
}

module.exports = {
    sendWhatsAppText,
    sendWhatsAppPdf
};

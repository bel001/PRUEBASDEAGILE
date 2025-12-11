const PDFDocument = require('pdfkit');
const { storage, db } = require('../db/firebase');
const { v4: uuidv4 } = require('uuid');

/**
 * Genera un PDF de comprobante, lo sube a Firebase Storage y retorna la URL pública.
 * @param {Object} data - Datos del pago y cliente
 * @returns {Promise<string>} - URL pública del PDF
 */
async function generarReciboPDF(data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', margin: 50 });
            let buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', async () => {
                try {
                    const pdfBuffer = Buffer.concat(buffers);
                    const bucket = storage.bucket();
                    const filename = `comprobantes/${data.numero_serie}-${data.numero_comprobante}.pdf`;
                    const file = bucket.file(filename);
                    const uuidToken = uuidv4();

                    await file.save(pdfBuffer, {
                        metadata: {
                            contentType: 'application/pdf',
                            metadata: {
                                firebaseStorageDownloadTokens: uuidToken
                            }
                        }
                    });

                    const bucketName = bucket.name;
                    const encodedPath = encodeURIComponent(filename);
                    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${uuidToken}`;

                    console.log('✅ Comprobante generado y subido:', publicUrl);
                    resolve(publicUrl);

                } catch (uploadError) {
                    console.error('❌ Error subiendo PDF:', uploadError);
                    reject(uploadError);
                }
            });

            // --- DISEÑO DEL PDF (REPLICANDO IMAGEN) ---
            const blueColor = '#0056b3';
            const cyanColor = '#00d2d3';
            const darkColor = '#2c3e50';
            const greyColor = '#555555';

            // 1. LOGO (Texto AGILE-PRESTAMOS)
            doc.font('Helvetica-Bold').fontSize(24).fillColor(darkColor).text('agile', 50, 50, { continued: true });
            doc.fillColor(cyanColor).text('-prestamos');

            // Detalles Empresa
            doc.fontSize(8).fillColor(greyColor).font('Helvetica');
            doc.text('AGILE PRESTAMOS S.A.C.', 50, 85);
            doc.text('Av. Siempreviva 123, Of 402', 50, 97);
            doc.text('Trujillo, La Libertad', 50, 109);
            doc.text('contacto@agileprestamos.com', 50, 121);

            // 2. CAJA RUC (Derecha Sup)
            doc.roundedRect(350, 45, 200, 70, 5).strokeColor('#dddddd').stroke();
            doc.font('Helvetica-Bold').fontSize(10).fillColor('black');
            doc.text('R.U.C. 20609998877', 350, 60, { width: 200, align: 'center' });

            doc.fillColor(greyColor).fontSize(12).text('BOLETA ELECTRÓNICA', 350, 75, { width: 200, align: 'center' });
            doc.fillColor('black').fontSize(11).text(`${data.numero_serie}-${data.numero_comprobante}`, 350, 95, { width: 200, align: 'center' });

            // 3. SEPARADOR LÍNEA AZUL
            doc.moveTo(50, 145).lineTo(550, 145).lineWidth(2).strokeColor(blueColor).stroke();

            // 4. DATOS DEL CLIENTE (Con barra lateral cyan)
            // Barra lateral
            doc.moveTo(50, 165).lineTo(50, 225).lineWidth(4).strokeColor(cyanColor).stroke();

            let yInfo = 170;
            doc.font('Helvetica').fontSize(7).fillColor(greyColor);

            // Columna Izquierda
            doc.text('CLIENTE', 65, yInfo);
            doc.font('Helvetica-Bold').fontSize(10).fillColor(darkColor);
            doc.text(data.cliente_nombre.toUpperCase(), 65, yInfo + 10);

            doc.font('Helvetica').fontSize(7).fillColor(greyColor);
            doc.text('DIRECCIÓN', 65, yInfo + 30);
            doc.font('Helvetica').fontSize(9).fillColor('black');
            doc.text(data.direccion || 'Inambari', 65, yInfo + 40);

            // Columna Derecha
            doc.font('Helvetica').fontSize(7).fillColor(greyColor);
            doc.text('DOC. IDENTIDAD', 350, yInfo);
            doc.font('Helvetica').fontSize(10).fillColor('black');
            doc.text(data.cliente_doc, 350, yInfo + 10);

            doc.font('Helvetica').fontSize(7).fillColor(greyColor);
            doc.text('FECHA DE EMISIÓN', 350, yInfo + 30);
            doc.font('Helvetica').fontSize(10).fillColor('black');
            doc.text(new Date().toLocaleDateString('es-PE'), 350, yInfo + 40);

            // 5. TABLA ITEMS
            let yTable = 260;
            const subTotal = (data.monto_total).toFixed(2);

            // Headers
            doc.font('Helvetica-Bold').fontSize(8).fillColor(greyColor);
            doc.text('CANT.', 50, yTable);
            doc.text('U.M.', 90, yTable);
            doc.text('DESCRIPCIÓN', 130, yTable);
            doc.text('V. UNITARIO', 420, yTable, { align: 'right', width: 60 });
            doc.text('TOTAL', 500, yTable, { align: 'right', width: 40 });

            // Línea gris header
            doc.moveTo(50, yTable + 12).lineTo(550, yTable + 12).lineWidth(1).strokeColor('#eeeeee').stroke();

            // Row Item
            yTable += 25;
            doc.font('Helvetica').fontSize(9).fillColor('black');
            doc.text('1', 50, yTable);
            doc.text('ZZ', 90, yTable);

            doc.font('Helvetica-Bold').text(`CUOTA DE PRÉSTAMO N° ${data.numero_cuota}`, 130, yTable);
            doc.font('Helvetica').fontSize(8).fillColor(greyColor);
            const textoMedio = data.medio_pago === 'FLOW' ? 'Pago vía Flow (Pasarela Digital)' : 'Pago en Efectivo';
            doc.text(textoMedio, 130, yTable + 12);

            doc.font('Helvetica').fontSize(9).fillColor('black');
            doc.text(subTotal, 420, yTable, { align: 'right', width: 60 });
            doc.text(subTotal, 500, yTable, { align: 'right', width: 40 });

            // Línea cierre tabla
            doc.moveTo(50, yTable + 30).lineTo(550, yTable + 30).lineWidth(0.5).strokeColor('#eeeeee').stroke();

            // 6. TOTALES (Alineado derecha bottom)
            let yTotal = yTable + 50;

            function printTotalRow(label, value, bold = false, color = greyColor, size = 9) {
                doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(greyColor);
                doc.text(label, 350, yTotal, { width: 100, align: 'left' });
                doc.fillColor(color);
                doc.text(value, 460, yTotal, { width: 80, align: 'right' });
                yTotal += 15;
            }

            printTotalRow('Op. Gravada:', 'S/ 0.00');
            printTotalRow('Op. Exonerada:', `S/ ${subTotal}`);
            printTotalRow('I.G.V.:', 'S/ 0.00');

            doc.moveTo(350, yTotal).lineTo(550, yTotal).lineWidth(0.5).strokeColor('#eeeeee').stroke();
            yTotal += 10;

            // Importe Total Grande Azul
            doc.font('Helvetica-Bold').fontSize(12).fillColor(blueColor);
            doc.text('IMPORTE TOTAL:', 350, yTotal);
            doc.text(`S/ ${subTotal}`, 460, yTotal, { width: 80, align: 'right' });

            // NUEVO: Mostrar Vuelto si es efectivo
            if (data.medio_pago === 'EFECTIVO' && data.monto_entregado != null) {
                yTotal += 15;
                doc.font('Helvetica').fontSize(9).fillColor(greyColor);
                doc.text('Efectivo Recibido:', 350, yTotal, { width: 100, align: 'left' });
                doc.text(`S/ ${Number(data.monto_entregado).toFixed(2)}`, 460, yTotal, { width: 80, align: 'right' });

                yTotal += 12;
                doc.text('Vuelto:', 350, yTotal, { width: 100, align: 'left' });
                doc.text(`S/ ${Number(data.vuelto || 0).toFixed(2)}`, 460, yTotal, { width: 80, align: 'right' });
            }

            // 7. PIE DE PÁGINA
            doc.fontSize(7).fillColor(greyColor);
            doc.text('Representación Impresa de la Boleta de Venta Electrónica', 50, 700, { align: 'center' });
            doc.text('Autorizado mediante Resolución de Intendencia N° 034-005-00123/SUNAT', 50, 712, { align: 'center' });
            doc.text('Gracias por su preferencia.', 50, 724, { align: 'center' });

            doc.end();

        } catch (err) {
            reject(err);
        }
    });
}

module.exports = { generarReciboPDF };

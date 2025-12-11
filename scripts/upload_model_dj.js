const { storage } = require('../db/firebase');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

async function uploadModel() {
    try {
        const filePath = path.join(__dirname, '../fronted/assets/declaracion_jurada.pdf');

        if (!fs.existsSync(filePath)) {
            console.error('❌ El archivo no existe en:', filePath);
            return;
        }

        console.log('📤 Subiendo archivo a Firebase Storage...');

        const bucket = storage.bucket();
        const filename = 'plantillas/MODELO_DECLARACION_JURADA.pdf';
        const fileUpload = bucket.file(filename);
        const uuidToken = uuidv4();

        const fileBuffer = fs.readFileSync(filePath);

        await fileUpload.save(fileBuffer, {
            metadata: {
                contentType: 'application/pdf',
                metadata: {
                    firebaseStorageDownloadTokens: uuidToken
                }
            }
        });

        const bucketName = bucket.name;
        const encodedPath = encodeURIComponent(filename);
        const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${uuidToken}`;

        console.log('✅ Archivo subido exitosamente!');
        console.log('URL_FINAL: ' + downloadUrl);
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

uploadModel();

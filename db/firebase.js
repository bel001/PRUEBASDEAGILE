const admin = require('firebase-admin');

// Configuración usando variables de entorno (Render) o archivo local (desarrollo)
let serviceAccount;

if (process.env.FIREBASE_PRIVATE_KEY) {
  // Producción: usar variables de entorno
  serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL
  };
  console.log('🔥 Firebase: Usando variables de entorno');
} else {
  // Desarrollo local: usar archivo JSON
  serviceAccount = require('../serviceAccountKey.json');
  console.log('🔥 Firebase: Usando serviceAccountKey.json');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
console.log("✅ Base de datos Firebase conectada");

module.exports = db;
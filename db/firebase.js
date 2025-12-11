const admin = require('firebase-admin');

// Configuración usando variables de entorno (Render/Producción)
// El archivo serviceAccountKey.json NO existe en producción
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
  try {
    serviceAccount = require('../serviceAccountKey.json');
    console.log('🔥 Firebase: Usando serviceAccountKey.json');
  } catch (e) {
    console.error('❌ ERROR: No se encontraron credenciales de Firebase.');
    console.error('Para desarrollo local: Agrega serviceAccountKey.json');
    console.error('Para producción: Configura FIREBASE_PRIVATE_KEY, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL');
    process.exit(1);
  }
}

// Determinar bucket name
// Determinar bucket name
const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'agile-prestamos.firebasestorage.app';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: bucketName
});

const db = admin.firestore();
const storage = admin.storage();

console.log("✅ Base de datos Firebase conectada");
console.log("✅ Firebase Storage configurado:", bucketName);

module.exports = { db, storage, admin };
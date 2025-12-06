const admin = require('firebase-admin');
// Importamos tu llave maestra
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
console.log("🔥 Base de datos conectada: Firebase");

module.exports = db;
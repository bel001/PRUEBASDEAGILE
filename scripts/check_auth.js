const admin = require("firebase-admin");
const serviceAccount = require("../serviceAccountKey.json");

console.log("Initializing Firebase...");
try {
    if (admin.apps.length === 0) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }

    const db = admin.firestore();

    console.log("Attempting to list collections...");
    db.listCollections()
        .then(collections => {
            console.log("Connected successfully! Found " + collections.length + " collections.");
            process.exit(0);
        })
        .catch(error => {
            console.error("Connection failed!");
            console.error("Error code:", error.code);
            console.error("Error message:", error.message);
            console.error("Full error:", JSON.stringify(error, null, 2));
            process.exit(1);
        });

} catch (e) {
    console.error("Initialization error:", e.message);
    process.exit(1);
}

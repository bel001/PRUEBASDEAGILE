# 🚀 Guía de Despliegue en Render.com

## ✅ Archivos Ya Preparados

He modificado tu proyecto para que funcione en Render:

1. ✅ `.gitignore` - No sube archivos sensibles
2. ✅ `index.js` - Ahora sirve el frontend
3. ✅ `App.js` - URL dinámica (local/producción)

---

## 📋 PASOS PARA DESPLEGAR

### Paso 1: Crear Repositorio en GitHub

1. Ve a https://github.com/new
2. Nombre: `agile-prestamos`
3. Descripción: `Sistema de Gestión de Cobranzas`
4. **NO** marques "Add README"
5. Click "Create repository"

### Paso 2: Subir tu código a GitHub

Abre PowerShell en tu carpeta del proyecto y ejecuta:

```powershell
cd "d:\Codigos\AGILE\agile-prestamos-completo"

# Inicializar git
git init

# Configurar tu usuario (primera vez)
git config --global user.name "Tu Nombre"
git config --global user.email "tu@email.com"

# Agregar archivos
git add .
git commit -m "First commit - Sistema de Cobranzas"

# Conectar con GitHub (reemplaza TU_USUARIO)
git remote add origin https://github.com/TU_USUARIO/agile-prestamos.git
git branch -M main
git push -u origin main
```

**Nota:** GitHub te pedirá autenticación. Usa un Personal Access Token.

### Paso 3: Obtener credenciales de Firebase

Abre tu archivo `serviceAccountKey.json` y copia estos valores:

```json
{
  "project_id": "COPIA_ESTE_VALOR",
  "private_key": "COPIA_TODO_ESTO",
  "client_email": "COPIA_ESTE_EMAIL"
}
```

### Paso 4: Crear cuenta en Render

1. Ve a https://render.com
2. Click "Get Started"
3. Regístrate con GitHub
4. Autoriza a Render acceder a tus repositorios

### Paso 5: Crear Web Service

1. Click "New +" (arriba derecha)
2. Selecciona "Web Service"
3. Click "Connect" en tu repositorio `agile-prestamos`
4. Configuración:

```
Name: agile-prestamos
Region: Oregon (US West)
Branch: main
Root Directory: (dejar vacío)
Runtime: Node
Build Command: npm install
Start Command: npm start
Instance Type: Free
```

### Paso 6: Agregar Variables de Entorno

En la página de configuración:

1. Click en "Advanced"
2. Click "Add Environment Variable"
3. Agregar estas 3 variables (copiadas del paso 3):

```
KEY: FIREBASE_PROJECT_ID
VALUE: (tu project_id)

KEY: FIREBASE_PRIVATE_KEY  
VALUE: (tu private_key completo, con \n incluidos)

KEY: FIREBASE_CLIENT_EMAIL
VALUE: (tu client_email)
```

### Paso 7: Modificar Firebase Config

Antes de desplegar, necesitas modificar cómo se carga Firebase.

**IMPORTANTE:** Crea un archivo `d:\Codigos\AGILE\agile-prestamos-completo\config\firebase.js`

```javascript
const admin = require('firebase-admin');

// Configuración usando variables de entorno
const serviceAccount = process.env.FIREBASE_PRIVATE_KEY ? {
  projectId: process.env.FIREBASE_PROJECT_ID,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL
} : require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

module.exports = { db, admin };
```

Luego actualiza tus routes para usar este archivo en lugar de crear la conexión localmente.

### Paso 8: Deploy

1. Click "Create Web Service"
2. Render comenzará a construir...
3. Espera 3-5 minutos

**Tu app estará en:** `https://agile-prestamos.onrender.com`

---

## 🔧 Actualizar después de cambios

```bash
# Hacer cambios en tu código

git add .
git commit -m "Descripción del cambio"
git push

# Render detecta el push y redespliega automáticamente
```

---

## ⚠️ IMPORTANTE

1. **Primera visita lenta:** El servicio gratis se duerme tras 15 min de inactividad. La primera carga puede tardar 30-60 segundos.

2. **Keep Alive (opcional):** Para que no se duerma, puedes usar un servicio como:
   - https://cron-job.org
   - Configurar ping cada 10 minutos a `https://tu-app.onrender.com/health`

3. **Límites Free:**
   - 750 horas/mes (suficiente si solo hay una app)
   - Se duerme tras 15 min sin uso
   - 100 GB bandwidth/mes

---

## ✅ Verificación

Después del deploy:

1. Ve a `https://agile-prestamos.onrender.com`
2. Deberías ver tu pantalla de login
3. Prueba iniciar sesión: `cajero` / `123`
4. Verifica que todo funcione

---

## 🆘 Problemas Comunes

**Error 500:**
- Revisa las variables de entorno de Firebase
- Verifica los logs en Render Dashboard

**No carga el frontend:**
- Verifica que `fronted/Index.html` esté con mayúscula
- Revisa que `index.js` tenga el código de static files

**Firebase no conecta:**
- El `FIREBASE_PRIVATE_KEY` debe tener los `\n` literales
- Cópialo tal cual del archivo JSON, entre comillas

---

¿Necesitas ayuda con algún paso específico? 🚀

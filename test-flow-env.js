require('dotenv').config();

console.log('=== Diagnóstico de Variables de Entorno ===\n');

console.log('FLOW_API_KEY:', process.env.FLOW_API_KEY || '❌ NO CONFIGURADA');
console.log('FLOW_SECRET_KEY:', process.env.FLOW_SECRET_KEY ? '✅ Configurada' : '❌ NO CONFIGURADA');
console.log('FLOW_ENV:', process.env.FLOW_ENV || '❌ NO CONFIGURADA');
console.log('FRONTEND_URL:', process.env.FRONTEND_URL || '❌ NO CONFIGURADA');

console.log('\n=== Solución ===');
if (!process.env.FLOW_API_KEY || !process.env.FLOW_SECRET_KEY) {
    console.log('❌ FALTA configurar las credenciales de Flow en el archivo .env');
    console.log('\nAgrega estas líneas al archivo .env:\n');
    console.log('FLOW_API_KEY=70E05C1F-8884-43F5-8FC5-448BL1D3BCF1');
    console.log('FLOW_SECRET_KEY=706fcc6ae7debdd6027bc25d6df33877783397fa');
    console.log('FLOW_ENV=production');
    console.log('FRONTEND_URL=http://localhost:4000');
} else {
    console.log('✅ Todas las variables están configuradas correctamente');
}

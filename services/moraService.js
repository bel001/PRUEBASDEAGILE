// 1% de mora si está vencida
function esVencida(fecha_vencimiento) {
  const hoy = new Date().toISOString().split('T')[0];
  return fecha_vencimiento < hoy;
}

function calcularMora(saldo_pendiente, vencida) {
  if (!vencida) return 0;
  const mora = Number((saldo_pendiente * 0.01).toFixed(2));
  return mora;
}

module.exports = { esVencida, calcularMora };

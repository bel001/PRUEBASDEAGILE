// Redondeo solo para EFECTIVO a múltiplos de 0.10
function aplicarRedondeo(monto, medio_pago) {
  if (medio_pago !== 'EFECTIVO') {
    return { montoCobrar: monto, ajuste: 0 };
  }
  const redondeado = Math.round(monto * 10) / 10;
  const ajuste = Number((redondeado - monto).toFixed(2));
  return {
    montoCobrar: Number(redondeado.toFixed(2)),
    ajuste
  };
}

module.exports = { aplicarRedondeo };
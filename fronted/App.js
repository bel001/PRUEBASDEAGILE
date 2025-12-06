// API URL - funciona tanto en local como en producción
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:4000' : '';

// ==================== SISTEMA DE LOGIN ====================
// Validar sesión al cargar la página
document.addEventListener('DOMContentLoaded', function () {
    verificarSesion();
});

function verificarSesion() {
    const usuarioGuardado = localStorage.getItem('cajero_usuario');

    if (usuarioGuardado) {
        // Ya hay sesión activa
        mostrarAplicacion(usuarioGuardado);
    } else {
        // Mostrar pantalla de login
        document.getElementById('pantalla-login').style.display = 'flex';
        document.getElementById('app-principal').style.display = 'none';
    }
}

function iniciarSesion() {
    const usuario = document.getElementById('login-usuario').value.trim();
    const password = document.getElementById('login-password').value;
    const mensajeDiv = document.getElementById('login-mensaje');

    mensajeDiv.innerText = '';

    if (!usuario || !password) {
        mensajeDiv.innerText = '⚠️ Ingrese usuario y contraseña';
        return;
    }

    // Validación simple (en producción sería contra el backend)
    const usuariosValidos = {
        'cajero': '123',
        'admin': 'admin123',
        'usuario': 'usuario123'
    };

    if (usuariosValidos[usuario] && usuariosValidos[usuario] === password) {
        // Login exitoso
        localStorage.setItem('cajero_usuario', usuario);
        mostrarAplicacion(usuario);
    } else {
        mensajeDiv.innerText = '❌ Usuario o contraseña incorrectos';
    }
}

function mostrarAplicacion(usuario) {
    // Ocultar login y mostrar app
    document.getElementById('pantalla-login').style.display = 'none';
    document.getElementById('app-principal').style.display = 'block';

    // Mostrar nombre del cajero
    document.getElementById('nombre-cajero').innerText = usuario.charAt(0).toUpperCase() + usuario.slice(1);

    // Cargar datos iniciales
    cargarClientes();
}

function cerrarSesion() {
    if (confirm('¿Está seguro de cerrar sesión?')) {
        localStorage.removeItem('cajero_usuario');
        location.reload();
    }
}

// ==================== MÓDULO CLIENTES ====================


async function cargarClientes() {
    const lista = document.getElementById('listaClientes');
    lista.innerHTML = '<tr><td colspan="4" style="text-align:center">Cargando datos...</td></tr>';

    try {
        const res = await fetch(`${API_URL}/clientes`);
        const clientes = await res.json();

        lista.innerHTML = ''; // Limpiar

        if (clientes.length === 0) {
            lista.innerHTML = '<tr><td colspan="4" style="text-align:center">No hay clientes registrados</td></tr>';
            return;
        }

        // Ordenar: Los más recientes primero
        clientes.sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en));

        clientes.forEach(c => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>${c.documento}</strong></td>
                <td>${c.nombre}</td>
                <td><span style="font-size:0.8em; padding:3px 8px; background:#eee; border-radius:10px;">${c.tipo}</span></td>
                <td>
                    <button class="btn-small" onclick="verPrestamo('${c.id}')">Ver Préstamos</button>
                </td>
            `;
            lista.appendChild(row);
        });
    } catch (error) {
        console.error("Error cargando clientes:", error);
        lista.innerHTML = '<tr><td colspan="4" style="color:red; text-align:center">Error conectando con el servidor. ¿Está prendido?</td></tr>';
    }
}

async function crearCliente() {
    const documento = document.getElementById('documento').value.trim();
    const tipo = document.getElementById('tipo').value;
    const mensajeDiv = document.getElementById('mensaje');

    // Limpiar mensajes previos
    mensajeDiv.className = 'mensaje';
    mensajeDiv.innerText = '';

    if (!documento) {
        alert("Por favor escribe un número de documento");
        return;
    }

    mensajeDiv.innerText = "⏳ Consultando RENIEC/SUNAT y guardando...";

    try {
        const res = await fetch(`${API_URL}/clientes/crear-desde-api`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tipo,
                documento,
                email: "", // Opcionales por ahora
                telefono: ""
            })
        });

        const data = await res.json();

        if (res.ok) {
            mensajeDiv.innerText = `✅ ¡Éxito! Cliente guardado: ${data.nombre}`;
            mensajeDiv.classList.add('exito');
            document.getElementById('documento').value = ''; // Limpiar input
            cargarClientes(); // Recargar la tabla
        } else {
            mensajeDiv.innerText = `❌ Error: ${data.error}`;
            mensajeDiv.classList.add('error');
        }
    } catch (error) {
        console.error(error);
        mensajeDiv.innerText = "❌ Error de conexión con el Backend";
        mensajeDiv.classList.add('error');
    }
}

// ==================== NAVEGACIÓN ====================
function mostrarSeccion(seccionId) {
    // Ocultar todas las secciones
    document.querySelectorAll('.seccion').forEach(sec => sec.style.display = 'none');

    // Mostrar la sección seleccionada
    document.getElementById(`seccion-${seccionId}`).style.display = 'block';

    // Actualizar botones activos
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    // Cargar datos específicos si es necesario
    if (seccionId === 'caja') {
        cargarEstadoCaja();
    }
}

// ==================== MÓDULO PRÉSTAMOS ====================
let clienteSeleccionado = null;

async function buscarClienteParaPrestamo() {
    const busqueda = document.getElementById('buscar-cliente-doc').value.trim();
    const mensajeDiv = document.getElementById('mensaje-prestamo');

    mensajeDiv.className = 'mensaje';
    mensajeDiv.innerText = '';

    if (!busqueda) {
        alert('Ingrese un número de documento o nombre');
        return;
    }

    try {
        const res = await fetch(`${API_URL}/clientes`);
        const clientes = await res.json();

        // BÚSQUEDA MEJORADA: Por DNI o NOMBRE
        const cliente = clientes.find(c =>
            c.documento === busqueda ||
            c.nombre.toLowerCase().includes(busqueda.toLowerCase())
        );

        if (!cliente) {
            mensajeDiv.innerText = '❌ Cliente no encontrado. Por favor regístrelo primero en la sección Clientes.';
            mensajeDiv.classList.add('error');
            document.getElementById('info-cliente').style.display = 'none';
            document.getElementById('form-prestamo').style.display = 'none';
            return;
        }

        // Mostrar información del cliente
        clienteSeleccionado = cliente;
        document.getElementById('cliente-nombre').innerText = cliente.nombre;
        document.getElementById('cliente-doc').innerText = cliente.documento;
        document.getElementById('info-cliente').style.display = 'block';
        document.getElementById('form-prestamo').style.display = 'block';

    } catch (error) {
        console.error(error);
        mensajeDiv.innerText = '❌ Error conectando con el servidor';
        mensajeDiv.classList.add('error');
    }
}

async function crearPrestamo() {
    if (!clienteSeleccionado) {
        alert('Primero busque un cliente');
        return;
    }

    const monto = parseFloat(document.getElementById('monto-prestamo').value);
    const cuotas = parseInt(document.getElementById('num-cuotas').value);
    const mensajeDiv = document.getElementById('mensaje-prestamo');

    mensajeDiv.className = 'mensaje';
    mensajeDiv.innerText = '';

    if (!monto || !cuotas) {
        alert('Complete todos los campos');
        return;
    }

    if (monto > 20000) {
        alert('El monto máximo es S/ 20,000');
        return;
    }

    if (cuotas > 24) {
        alert('El número máximo de cuotas es 24');
        return;
    }

    mensajeDiv.innerText = '⏳ Creando préstamo...';

    try {
        const res = await fetch(`${API_URL}/prestamos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cliente_id: clienteSeleccionado.id,
                monto_total: monto,
                num_cuotas: cuotas
            })
        });

        const data = await res.json();

        if (res.ok) {
            mensajeDiv.innerText = `✅ Préstamo creado exitosamente. ID: ${data.prestamo_id}`;
            mensajeDiv.classList.add('exito');

            // Limpiar formulario
            document.getElementById('monto-prestamo').value = '';
            document.getElementById('num-cuotas').value = '';
            document.getElementById('buscar-cliente-doc').value = '';
            document.getElementById('info-cliente').style.display = 'none';
            document.getElementById('form-prestamo').style.display = 'none';

            // Mostrar detalle del préstamo creado
            setTimeout(() => mostrarDetallePrestamo(clienteSeleccionado.id, data), 2000);

        } else {
            mensajeDiv.innerText = `❌ Error: ${data.error}`;
            mensajeDiv.classList.add('error');
        }
    } catch (error) {
        console.error(error);
        mensajeDiv.innerText = '❌ Error de conexión con el Backend';
        mensajeDiv.classList.add('error');
    }
}

async function mostrarDetallePrestamo(clienteId, prestamoData) {
    try {
        const res = await fetch(`${API_URL}/prestamos/cliente/${clienteId}`);
        const data = await res.json();

        if (res.ok) {
            const { prestamo, cuotas } = data;

            // Mostrar información del préstamo
            document.getElementById('detalle-prestamo-info').innerHTML = `
                <p><strong>Cliente:</strong> ${prestamo.cliente_nombre || 'N/A'}</p>
                <p><strong>Monto Total:</strong> S/ ${prestamo.monto_total}</p>
                <p><strong>Número de Cuotas:</strong> ${prestamo.num_cuotas}</p>
                <p><strong>Monto por Cuota:</strong> S/ ${prestamo.monto_por_cuota}</p>
                <p><strong>Fecha Inicio:</strong> ${prestamo.fecha_inicio}</p>
            `;

            // Mostrar cronograma de cuotas CON RESALTADO PARA VENCIDAS
            const tablaCuotas = document.getElementById('tabla-cuotas');
            tablaCuotas.innerHTML = '';

            const hoy = new Date().toISOString().split('T')[0];

            cuotas.forEach(cuota => {
                const vencida = cuota.fecha_vencimiento < hoy && !cuota.pagada;

                let diasAtraso = 0;
                if (vencida) {
                    const fechaVenc = new Date(cuota.fecha_vencimiento);
                    const hoyDate = new Date(hoy);
                    diasAtraso = Math.floor((hoyDate - fechaVenc) / (1000 * 60 * 60 * 24));
                }

                const estado = cuota.pagada ?
                    '<span class="badge-pagada">✅ Pagada</span>' :
                    vencida ?
                        `<span class="badge-vencida">🔴 VENCIDA (${diasAtraso}d)</span>` :
                        '<span class="badge-pendiente">⏳ Pendiente</span>';

                const row = document.createElement('tr');
                if (vencida) {
                    row.className = 'cuota-vencida';
                }

                row.innerHTML = `
                    <td>${cuota.numero_cuota}</td>
                    <td>${cuota.fecha_vencimiento}</td>
                    <td>S/ ${cuota.monto_cuota}</td>
                    <td>S/ ${cuota.saldo_pendiente}</td>
                    <td>${estado}</td>
                `;
                tablaCuotas.appendChild(row);
            });

            document.getElementById('detalle-prestamo-card').style.display = 'block';
        }
    } catch (error) {
        console.error(error);
    }
}

function ocultarDetallePrestamo() {
    document.getElementById('detalle-prestamo-card').style.display = 'none';
}

// ==================== MÓDULO PAGOS/COBRANZA ====================
let prestamoActivo = null;
let cuotaSeleccionada = null;

async function buscarClienteParaPago() {
    const busqueda = document.getElementById('buscar-pago-doc').value.trim();
    const mensajeDiv = document.getElementById('mensaje-pago');

    mensajeDiv.className = 'mensaje';
    mensajeDiv.innerText = '';

    if (!busqueda) {
        alert('Ingrese un número de documento o nombre');
        return;
    }

    try {
        // Buscar cliente POR DNI O NOMBRE
        const resClientes = await fetch(`${API_URL}/clientes`);
        const clientes = await resClientes.json();
        const cliente = clientes.find(c =>
            c.documento === busqueda ||
            c.nombre.toLowerCase().includes(busqueda.toLowerCase())
        );

        if (!cliente) {
            mensajeDiv.innerText = '❌ Cliente no encontrado';
            mensajeDiv.classList.add('error');
            return;
        }

        // Buscar préstamo activo
        const resPrestamo = await fetch(`${API_URL}/prestamos/cliente/${cliente.id}`);

        if (!resPrestamo.ok) {
            mensajeDiv.innerText = '❌ El cliente no tiene préstamos activos';
            mensajeDiv.classList.add('error');
            return;
        }

        const data = await resPrestamo.json();
        prestamoActivo = data;

        // Mostrar información
        document.getElementById('pago-cliente-nombre').innerText = data.prestamo.cliente_nombre;
        document.getElementById('pago-monto-total').innerText = data.prestamo.monto_total;
        document.getElementById('pago-num-cuotas').innerText = data.prestamo.num_cuotas;

        // Llenar selector de cuotas
        const selectCuota = document.getElementById('select-cuota');
        selectCuota.innerHTML = '<option value="">-- Seleccione una cuota --</option>';

        data.cuotas.forEach((cuota, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.text = `Cuota ${cuota.numero_cuota} - S/ ${cuota.saldo_pendiente} - ${cuota.pagada ? 'PAGADA' : 'PENDIENTE'}`;
            option.disabled = cuota.saldo_pendiente <= 0;
            selectCuota.appendChild(option);
        });

        document.getElementById('info-pago-cliente').style.display = 'block';

    } catch (error) {
        console.error(error);
        mensajeDiv.innerText = '❌ Error de conexión';
        mensajeDiv.classList.add('error');
    }
}

function seleccionarCuota() {
    const selectCuota = document.getElementById('select-cuota');
    const index = selectCuota.value;

    if (!index) {
        document.getElementById('detalle-cuota').style.display = 'none';
        return;
    }

    cuotaSeleccionada = prestamoActivo.cuotas[index];

    // Calcular mora si está vencida
    const hoy = new Date().toISOString().split('T')[0];
    const vencida = cuotaSeleccionada.fecha_vencimiento < hoy && !cuotaSeleccionada.pagada;
    const mora = vencida ? (cuotaSeleccionada.saldo_pendiente * 0.01).toFixed(2) : 0;
    const totalDebido = (parseFloat(cuotaSeleccionada.saldo_pendiente) + parseFloat(mora)).toFixed(2);

    // Calcular días de atraso
    let diasAtraso = 0;
    if (vencida) {
        const fechaVenc = new Date(cuotaSeleccionada.fecha_vencimiento);
        const hoyDate = new Date(hoy);
        diasAtraso = Math.floor((hoyDate - fechaVenc) / (1000 * 60 * 60 * 24));
    }

    // DESGLOSE VISUAL MEJORADO
    document.getElementById('cuota-monto-capital').innerText = cuotaSeleccionada.monto_cuota;
    document.getElementById('cuota-saldo').innerText = cuotaSeleccionada.saldo_pendiente;
    document.getElementById('cuota-vencimiento').innerText = cuotaSeleccionada.fecha_vencimiento;
    document.getElementById('cuota-total-pagar').innerText = totalDebido;

    // Mostrar/ocultar mora
    const lineaMora = document.getElementById('linea-mora');
    if (vencida) {
        lineaMora.style.display = 'flex';
        document.getElementById('cuota-mora-monto').innerText = mora;

        // Mostrar días de atraso
        document.getElementById('cuota-dias-atraso').innerHTML =
            `<span style="color: #e74c3c;">🔴 VENCIDA - ${diasAtraso} días de atraso</span>`;
    } else {
        lineaMora.style.display = 'none';
        document.getElementById('cuota-dias-atraso').innerHTML =
            `<span style="color: #27ae60;">✅ Al día - Sin mora</span>`;
    }

    document.getElementById('monto-pagar').value = totalDebido;
    document.getElementById('detalle-cuota').style.display = 'block';

    // Actualizar redondeo inicial
    actualizarRedondeo();
}

// FUNCIÓN PARA ACTUALIZAR REDONDEO
function actualizarRedondeo() {
    const medioPago = document.getElementById('medio-pago').value;
    const montoInput = document.getElementById('monto-pagar');
    const mensajeRedondeo = document.getElementById('mensaje-redondeo');

    if (!montoInput.value) return;

    const monto = parseFloat(montoInput.value);

    if (medioPago === 'EFECTIVO') {
        // Calcular redondeo
        const redondeado = Math.round(monto * 10) / 10;
        const ajuste = (redondeado - monto).toFixed(2);

        // Mostrar mensaje
        mensajeRedondeo.style.display = 'block';
        if (ajuste == 0) {
            mensajeRedondeo.innerText = `✓ Monto exacto: S/ ${redondeado.toFixed(2)}`;
            mensajeRedondeo.style.color = '#27ae60';
        } else if (ajuste > 0) {
            mensajeRedondeo.innerText = `↑ Se cobrará S/ ${redondeado.toFixed(2)} (redondeo +S/ ${ajuste})`;
            mensajeRedondeo.style.color = '#f57c00';
        } else {
            mensajeRedondeo.innerText = `↓ Se cobrará S/ ${redondeado.toFixed(2)} (redondeo S/ ${ajuste})`;
            mensajeRedondeo.style.color = '#27ae60';
        }
    } else {
        mensajeRedondeo.style.display = 'none';
    }
}

async function procesarPago() {
    if (!cuotaSeleccionada) {
        alert('Seleccione una cuota');
        return;
    }

    const montoPagar = parseFloat(document.getElementById('monto-pagar').value);
    const medioPago = document.getElementById('medio-pago').value;
    const mensajeDiv = document.getElementById('mensaje-pago');

    mensajeDiv.className = 'mensaje';
    mensajeDiv.innerText = '';

    if (!montoPagar || montoPagar <= 0) {
        alert('Ingrese un monto válido');
        return;
    }

    mensajeDiv.innerText = '⏳ Procesando pago...';

    try {
        const res = await fetch(`${API_URL}/pagos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cuota_id: cuotaSeleccionada.id,
                monto_pagado: montoPagar,
                medio_pago: medioPago
            })
        });

        const data = await res.json();

        if (res.ok) {
            mensajeDiv.innerText = `✅ Pago procesado exitosamente. Nuevo saldo: S/ ${data.nuevo_saldo}`;
            mensajeDiv.classList.add('exito');

            // GENERAR COMPROBANTE PDF
            const hoy = new Date().toISOString().split('T')[0];
            const vencida = cuotaSeleccionada.fecha_vencimiento < hoy && !cuotaSeleccionada.pagada;
            const mora = vencida ? (cuotaSeleccionada.saldo_pendiente * 0.01).toFixed(2) : 0;

            const datoPago = {
                cliente_nombre: prestamoActivo.prestamo.cliente_nombre,
                cliente_doc: document.getElementById('buscar-pago-doc').value.trim(),
                numero_cuota: cuotaSeleccionada.numero_cuota,
                capital: cuotaSeleccionada.monto_cuota,
                mora: mora,
                total: data.monto_cobrado || montoPagar,
                medio_pago: medioPago,
                ajuste: data.redondeo_ajuste || 0,
                comprobante_id: data.pago_id
            };

            // Preguntar si quiere descargar el comprobante
            setTimeout(() => {
                if (confirm('✅ ¡Pago registrado exitosamente!\n\n¿Desea descargar el comprobante en PDF?')) {
                    generarComprobantePDF(datoPago);
                }
            }, 500);

            // Limpiar formulario
            document.getElementById('buscar-pago-doc').value = '';
            document.getElementById('info-pago-cliente').style.display = 'none';
            document.getElementById('detalle-cuota').style.display = 'none';
            prestamoActivo = null;
            cuotaSeleccionada = null;

        } else {
            mensajeDiv.innerText = `❌ Error: ${data.error}`;
            mensajeDiv.classList.add('error');
        }
    } catch (error) {
        console.error(error);
        mensajeDiv.innerText = '❌ Error de conexión con el Backend';
        mensajeDiv.classList.add('error');
    }
}

// ==================== GENERACIÓN DE COMPROBANTE PDF ====================
function generarComprobantePDF(datoPago) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Configuración
    const margen = 20;
    let y = 20;

    // Título
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('AGILE PRÉSTAMOS', 105, y, { align: 'center' });

    y += 10;
    doc.setFontSize(14);
    doc.text('Comprobante de Pago', 105, y, { align: 'center' });

    // Línea separadora
    y += 10;
    doc.line(margen, y, 190, y);

    // Datos del cliente
    y += 15;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Cliente: ${datoPago.cliente_nombre}`, margen, y);

    y += 7;
    doc.text(`DNI/RUC: ${datoPago.cliente_doc}`, margen, y);

    y += 7;
    const fecha = new Date().toLocaleString('es-PE');
    doc.text(`Fecha: ${fecha}`, margen, y);

    // Línea separadora
    y += 10;
    doc.line(margen, y, 190, y);

    // DETALLE DEL PAGO
    y += 15;
    doc.setFont(undefined, 'bold');
    doc.text('DETALLE DEL PAGO:', margen, y);

    y += 10;
    doc.setFont(undefined, 'normal');
    doc.text(`Cuota Nº: ${datoPago.numero_cuota}`, margen, y);

    y += 7;
    doc.text(`Monto Capital:`, margen, y);
    doc.text(`S/ ${datoPago.capital}`, 150, y, { align: 'right' });

    if (datoPago.mora > 0) {
        y += 7;
        doc.setTextColor(231, 76, 60); // Rojo
        doc.text(`Mora (1%):`, margen, y);
        doc.text(`S/ ${datoPago.mora}`, 150, y, { align: 'right' });
        doc.setTextColor(0, 0, 0); // Negro
    }

    // Total
    y += 10;
    doc.line(margen, y, 150, y);

    y += 7;
    doc.setFont(undefined, 'bold');
    doc.setFontSize(12);
    doc.text(`TOTAL PAGADO:`, margen, y);
    doc.text(`S/ ${datoPago.total}`, 150, y, { align: 'right' });

    // Medio de pago
    y += 12;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Medio de Pago: ${datoPago.medio_pago}`, margen, y);

    if (datoPago.ajuste != 0) {
        y += 7;
        doc.text(`Ajuste Redondeo: S/ ${datoPago.ajuste}`, margen, y);
    }

    // Línea separadora
    y += 10;
    doc.line(margen, y, 190, y);

    // Footer
    y += 10;
    doc.setFontSize(8);
    doc.text(`Nº Comprobante: ${datoPago.comprobante_id}`, margen, y);

    y += 7;
    doc.text('Cajero: Sistema', margen, y);

    y += 15;
    doc.setFontSize(10);
    doc.text('Gracias por su pago', 105, y, { align: 'center' });

    // Descargar
    const nombreArchivo = `comprobante_${datoPago.comprobante_id.substring(0, 8)}.pdf`;
    doc.save(nombreArchivo);

    console.log(`✅ Comprobante PDF generado: ${nombreArchivo}`);
}

// ==================== MÓDULO CAJA ====================
async function cargarEstadoCaja() {
    const mensajeDiv = document.getElementById('mensaje-caja');
    mensajeDiv.className = 'mensaje';
    mensajeDiv.innerText = '';

    try {
        const res = await fetch(`${API_URL}/caja/resumen-actual`);

        if (res.ok) {
            const data = await res.json();

            // Caja está abierta
            document.getElementById('resumen-inicial').innerText = data.monto_inicial.toFixed(2);
            document.getElementById('resumen-efectivo').innerText = data.EFECTIVO.toFixed(2);
            document.getElementById('resumen-yape').innerText = data.YAPE.toFixed(2);
            document.getElementById('resumen-plin').innerText = data.PLIN.toFixed(2);
            document.getElementById('resumen-tarjeta').innerText = data.TARJETA.toFixed(2);
            document.getElementById('resumen-total').innerText = data.total_teorico.toFixed(2);

            document.getElementById('caja-cerrada').style.display = 'none';
            document.getElementById('caja-abierta').style.display = 'block';

        } else {
            // Caja está cerrada
            document.getElementById('caja-cerrada').style.display = 'block';
            document.getElementById('caja-abierta').style.display = 'none';
        }
    } catch (error) {
        console.error(error);
        document.getElementById('caja-cerrada').style.display = 'block';
        document.getElementById('caja-abierta').style.display = 'none';
    }
}

async function abrirCaja() {
    const montoInicial = parseFloat(document.getElementById('monto-inicial-caja').value);
    const mensajeDiv = document.getElementById('mensaje-caja');

    mensajeDiv.className = 'mensaje';
    mensajeDiv.innerText = '';

    if (!montoInicial || montoInicial < 0) {
        alert('Ingrese un monto inicial válido');
        return;
    }

    mensajeDiv.innerText = '⏳ Abriendo caja...';

    try {
        const res = await fetch(`${API_URL}/caja/apertura`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ monto_inicial: montoInicial })
        });

        const data = await res.json();

        if (res.ok) {
            mensajeDiv.innerText = '✅ Caja abierta exitosamente';
            mensajeDiv.classList.add('exito');
            document.getElementById('monto-inicial-caja').value = '';
            setTimeout(() => cargarEstadoCaja(), 1000);
        } else {
            mensajeDiv.innerText = `❌ Error: ${data.error}`;
            mensajeDiv.classList.add('error');
        }
    } catch (error) {
        console.error(error);
        mensajeDiv.innerText = '❌ Error de conexión';
        mensajeDiv.classList.add('error');
    }
}

async function cerrarCaja() {
    const montoReal = parseFloat(document.getElementById('monto-real-caja').value);
    const mensajeDiv = document.getElementById('mensaje-caja');

    mensajeDiv.className = 'mensaje';
    mensajeDiv.innerText = '';

    if (!montoReal || montoReal < 0) {
        alert('Ingrese el monto real contado');
        return;
    }

    if (!confirm('¿Está seguro de cerrar la caja? Esta acción generará el reporte del día.')) {
        return;
    }

    mensajeDiv.innerText = '⏳ Cerrando caja...';

    try {
        const res = await fetch(`${API_URL}/caja/cierre`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ total_real: montoReal })
        });

        const data = await res.json();

        if (res.ok) {
            const diferencia = data.diferencia;
            let msg = '✅ Caja cerrada exitosamente. ';

            if (diferencia > 0) {
                msg += `Sobrante: S/ ${diferencia.toFixed(2)}`;
            } else if (diferencia < 0) {
                msg += `Faltante: S/ ${Math.abs(diferencia).toFixed(2)}`;
            } else {
                msg += '✨ Caja cuadra perfectamente - Sin diferencias';
            }

            mensajeDiv.innerText = msg;
            mensajeDiv.classList.add('exito');
            document.getElementById('monto-real-caja').value = '';
            setTimeout(() => cargarEstadoCaja(), 2000);
        } else {
            mensajeDiv.innerText = `❌ Error: ${data.error}`;
            mensajeDiv.classList.add('error');
        }
    } catch (error) {
        console.error(error);
        mensajeDiv.innerText = '❌ Error de conexión';
        mensajeDiv.classList.add('error');
    }
}

function verPrestamo(clienteId) {
    // Cambiar a la sección de préstamos y mostrar el detalle
    mostrarSeccion('prestamos');
    mostrarDetallePrestamo(clienteId);
}

// ==================== MÓDULO EMPLEADOS ====================
function cargarEmpleados() {
    const lista = document.getElementById('lista-empleados');

    // Obtener empleados de localStorage
    const empleados = JSON.parse(localStorage.getItem('empleados') || '[]');

    // Agregar empleados predeterminados si no existen
    if (empleados.length === 0) {
        empleados.push(
            { usuario: 'cajero', password: '123', rol: 'cajero' },
            { usuario: 'admin', password: 'admin123', rol: 'admin' },
            { usuario: 'usuario', password: 'usuario123', rol: 'cajero' }
        );
        localStorage.setItem('empleados', JSON.stringify(empleados));
    }

    lista.innerHTML = '';

    if (empleados.length === 0) {
        lista.innerHTML = '<tr><td colspan="3" style="text-align:center">No hay empleados registrados</td></tr>';
        return;
    }

    empleados.forEach((emp, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${emp.usuario}</strong></td>
            <td><span style="padding: 3px 8px; background: ${emp.rol === 'admin' ? '#e74c3c' : '#3498db'}; color: white; border-radius: 10px; font-size: 0.8em;">${emp.rol.toUpperCase()}</span></td>
            <td>
                <button class="btn-small" onclick="editarEmpleado(${index})" style="background: #f39c12;">✏️ Editar</button>
                <button class="btn-small" onclick="eliminarEmpleado(${index})" style="background: #e74c3c;">🗑️ Eliminar</button>
            </td>
        `;
        lista.appendChild(row);
    });
}

function agregarEmpleado() {
    const usuario = document.getElementById('nuevo-empleado-usuario').value.trim();
    const password = document.getElementById('nuevo-empleado-password').value;
    const rol = document.getElementById('nuevo-empleado-rol').value;
    const mensajeDiv = document.getElementById('mensaje-empleados');

    mensajeDiv.className = 'mensaje';
    mensajeDiv.innerText = '';

    if (!usuario || !password) {
        mensajeDiv.innerText = '❌ Complete todos los campos';
        mensajeDiv.classList.add('error');
        return;
    }

    // Obtener empleados actuales
    const empleados = JSON.parse(localStorage.getItem('empleados') || '[]');

    // Verificar si ya existe
    if (empleados.find(e => e.usuario === usuario)) {
        mensajeDiv.innerText = '❌ Ya existe un empleado con ese usuario';
        mensajeDiv.classList.add('error');
        return;
    }

    // Agregar nuevo empleado
    empleados.push({ usuario, password, rol });
    localStorage.setItem('empleados', JSON.stringify(empleados));

    mensajeDiv.innerText = `✅ Empleado ${usuario} agregado exitosamente`;
    mensajeDiv.classList.add('exito');

    // Limpiar formulario
    document.getElementById('nuevo-empleado-usuario').value = '';
    document.getElementById('nuevo-empleado-password').value = '';

    // Recargar lista
    cargarEmpleados();
}

function editarEmpleado(index) {
    const empleados = JSON.parse(localStorage.getItem('empleados') || '[]');
    const empleado = empleados[index];

    const nuevoPassword = prompt(`Editar contraseña de ${empleado.usuario}:`, empleado.password);

    if (nuevoPassword && nuevoPassword.trim()) {
        empleados[index].password = nuevoPassword.trim();
        localStorage.setItem('empleados', JSON.stringify(empleados));
        alert('✅ Contraseña actualizada');
        cargarEmpleados();
    }
}

function eliminarEmpleado(index) {
    const empleados = JSON.parse(localStorage.getItem('empleados') || '[]');
    const empleado = empleados[index];

    if (confirm(`¿Está seguro de eliminar al empleado "${empleado.usuario}"?`)) {
        empleados.splice(index, 1);
        localStorage.setItem('empleados', JSON.stringify(empleados));
        alert('✅ Empleado eliminado');
        cargarEmpleados();
    }
}

// Modificar la función de inicio de sesión para usar la lista de empleados
function iniciarSesion() {
    const usuario = document.getElementById('login-usuario').value.trim();
    const password = document.getElementById('login-password').value;
    const mensajeDiv = document.getElementById('login-mensaje');

    mensajeDiv.innerText = '';

    if (!usuario || !password) {
        mensajeDiv.innerText = '⚠️ Ingrese usuario y contraseña';
        return;
    }

    // Obtener empleados de localStorage
    const empleados = JSON.parse(localStorage.getItem('empleados') || '[]');

    // Si no hay empleados, crear los predeterminados
    if (empleados.length === 0) {
        empleados.push(
            { usuario: 'cajero', password: '123', rol: 'cajero' },
            { usuario: 'admin', password: 'admin123', rol: 'admin' },
            { usuario: 'usuario', password: 'usuario123', rol: 'cajero' }
        );
        localStorage.setItem('empleados', JSON.stringify(empleados));
    }

    // Buscar empleado
    const empleado = empleados.find(e => e.usuario === usuario && e.password === password);

    if (empleado) {
        // Login exitoso
        localStorage.setItem('cajero_usuario', usuario);
        localStorage.setItem('cajero_rol', empleado.rol);
        mostrarAplicacion(usuario);
    } else {
        mensajeDiv.innerText = '❌ Usuario o contraseña incorrectos';
    }
}

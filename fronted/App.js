// API URL - funciona tanto en local como en producción
// Si estamos en localhost o abriendo como archivo, usamos localhost:4000
// Si estamos en producción (Render), usamos URL relativa (vacía)
const API_URL = (window.location.hostname === 'localhost' || window.location.protocol === 'file:')
    ? 'http://localhost:4000'
    : '';

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

// La función iniciarSesion() está al final del archivo (módulo de empleados)

function mostrarAplicacion(usuario) {
    // Ocultar login y mostrar app
    document.getElementById('pantalla-login').style.display = 'none';
    document.getElementById('app-principal').style.display = 'block';

    // Mostrar nombre del cajero
    const nombre = usuario.charAt(0).toUpperCase() + usuario.slice(1);
    const rol = localStorage.getItem('cajero_rol') || 'cajero';
    document.getElementById('nombre-cajero').innerText = `${nombre} (${rol.toUpperCase()})`;

    // CONTROL DE ROLES: Ocultar botones de Admin si es Cajero
    const botonesAdmin = document.querySelectorAll('.btn-admin');
    if (rol !== 'admin') {
        botonesAdmin.forEach(btn => btn.style.display = 'none');
    } else {
        botonesAdmin.forEach(btn => btn.style.display = 'inline-block');
    }

    // Cargar datos iniciales
    cargarClientes();
}

function cerrarSesion() {
    if (confirm('¿Está seguro de cerrar sesión?')) {
        localStorage.removeItem('cajero_usuario');
        location.reload();
    }
}

// Función para cambiar de sección
function mostrarSeccion(id) {
    // Ocultar todas las secciones
    const secciones = document.querySelectorAll('.seccion');
    secciones.forEach(s => s.style.display = 'none');

    // Mostrar la seleccionada
    const seccion = document.getElementById(`seccion-${id}`);
    if (seccion) seccion.style.display = 'block';

    // Actualizar botones de navegación
    const botones = document.querySelectorAll('.nav-btn');
    botones.forEach(b => b.classList.remove('active'));

    // Botón específico para caja tiene su propia función, pero para otros:
    const btnMap = {
        'clientes': 0, 'prestamos': 1, 'pagos': 2, 'caja': 3, 'empleados': 4, 'config': 5
    };
    if (botones[btnMap[id]]) botones[btnMap[id]].classList.add('active');

    // Cargar datos si es necesario
    if (id === 'clientes') cargarClientes();
    if (id === 'empleados') cargarEmpleados();
    if (id === 'config') cargarConfiguracion();
}

function mostrarCaja() {
    mostrarSeccion('caja');
    cargarEstadoCaja();
}

// ==================== MÓDULO CLIENTES ====================
let filtroMorososActivo = false;

// Función para mostrar Toast Notifications
function mostrarToast(mensaje, tipo = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;

    let icon = 'ℹ️';
    if (tipo === 'success') icon = '✅';
    if (tipo === 'error') icon = '❌';
    if (tipo === 'warning') icon = '⚠️';

    toast.innerHTML = `
        <div class="toast-icon">${icon}</div>
        <div class="toast-content">
            <div class="toast-title">${tipo.charAt(0).toUpperCase() + tipo.slice(1)}</div>
            <div class="toast-message">${mensaje}</div>
        </div>
        <div class="toast-close" onclick="this.parentElement.remove()">✕</div>
    `;

    container.appendChild(toast);

    // Auto eliminar después de 3 segundos
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function toggleFiltroMorosos() {
    filtroMorososActivo = !filtroMorososActivo;
    const btn = document.getElementById('btn-filtro-morosos');
    const stats = document.getElementById('stats-morosos');

    if (filtroMorososActivo) {
        btn.classList.add('active');
        btn.innerHTML = '📋 Ver Todos';
        stats.style.display = 'flex';
        mostrarToast('Mostrando solo clientes con deudas vencidas', 'warning');
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '⚠️ Ver Solo Morosos';
        stats.style.display = 'none';
        mostrarToast('Mostrando todos los clientes', 'info');
    }
    cargarClientes();
}


async function cargarClientes() {
    const lista = document.getElementById('listaClientes');
    lista.innerHTML = '<tr><td colspan="4" style="text-align:center">Cargando datos...</td></tr>';

    try {
        const res = await fetch(`${API_URL}/clientes`);
        let clientes = await res.json(); // Usamos let para poder filtrar

        lista.innerHTML = ''; // Limpiar

        if (clientes.length === 0) {
            lista.innerHTML = '<tr><td colspan="4" style="text-align:center">No hay clientes registrados</td></tr>';
            return;
        }

        // LÓGICA DE FILTRO DE MOROSOS
        if (filtroMorososActivo) {
            // Obtener préstamos para verificar morosidad
            const morosos = [];
            let totalMoraAcumulada = 0;
            const hoy = new Date().toISOString().split('T')[0];

            for (const cliente of clientes) {
                try {
                    // Buscar préstamo activo del cliente
                    const resP = await fetch(`${API_URL}/prestamos/cliente/${cliente.id}`);
                    if (!resP.ok) continue; // No tiene préstamo activo

                    const data = await resP.json();
                    const cuotas = data.cuotas || [];

                    let tieneVencidas = false;
                    let diasMaxAtraso = 0;
                    let moraTotalCliente = 0;

                    cuotas.forEach(cuota => {
                        if (!cuota.pagada && cuota.fecha_vencimiento < hoy) {
                            tieneVencidas = true;
                            const fechaVenc = new Date(cuota.fecha_vencimiento);
                            const diff = Math.ceil((new Date() - fechaVenc) / (1000 * 60 * 60 * 24));
                            if (diff > diasMaxAtraso) diasMaxAtraso = diff;

                            // Calcular mora (1% del saldo pendiente)
                            const mora = cuota.saldo_pendiente * obtenerPorcentajeMora();
                            moraTotalCliente += mora;
                        }
                    });

                    if (tieneVencidas) {
                        cliente.diasAtraso = diasMaxAtraso;
                        cliente.moraTotal = moraTotalCliente;
                        totalMoraAcumulada += moraTotalCliente;
                        morosos.push(cliente);
                    }
                } catch (e) {
                    // Cliente sin préstamo, ignorar
                }
            }

            // Ordenar por días de atraso (mayor a menor)
            morosos.sort((a, b) => b.diasAtraso - a.diasAtraso);
            clientes = morosos;

            // Actualizar stats
            document.getElementById('total-mora-acumulada').innerText = `Total Mora: S/ ${totalMoraAcumulada.toFixed(2)}`;
        } else {
            // Ordenar por fecha de creación (default)
            clientes.sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en));
        }

        if (filtroMorososActivo && clientes.length === 0) {
            lista.innerHTML = '<tr><td colspan="4" style="text-align:center; color: #27ae60;">✨ ¡Excelente! No hay clientes morosos</td></tr>';
            return;
        }

        clientes.forEach(c => {
            const row = document.createElement('tr');

            let extraInfo = '';
            let btnRecordar = '';
            if (filtroMorososActivo) {
                row.style.backgroundColor = '#fff3e0';
                row.style.borderLeft = '4px solid #e74c3c';
                extraInfo = `<br><span class="badge-vencida">📅 ${c.diasAtraso} días atraso</span> <span style="font-size:0.8em; color:#c0392b;">(Mora: S/ ${c.moraTotal.toFixed(2)})</span>`;
                // Botón WhatsApp
                const mensaje = encodeURIComponent(`Hola ${c.nombre}, le recordamos que tiene una cuota vencida hace ${c.diasAtraso} días. Su mora acumulada es S/ ${c.moraTotal.toFixed(2)}. Por favor acercarse a regularizar su pago. Gracias.`);
                btnRecordar = `<button class="btn-small" style="background:#25D366; margin-left:5px;" onclick="window.open('https://wa.me/?text=${mensaje}', '_blank')">📱 Recordar</button>`;
            }

            row.innerHTML = `
                <td><strong>${c.documento}</strong></td>
                <td>
                    ${c.nombre}
                    ${extraInfo}
                </td>
                <td><span style="font-size:0.8em; padding:3px 8px; background:#eee; border-radius:10px;">${c.tipo}</span></td>
                <td>
                    <button class="btn-small" onclick="verPrestamo('${c.id}')">Ver Préstamos</button>
                    ${btnRecordar}
                </td>
            `;
            lista.appendChild(row);
        });
    } catch (error) {
        console.error("Error cargando clientes:", error);
        lista.innerHTML = '<tr><td colspan="4" style="color:red; text-align:center">Error conectando con el servidor. ¿Está prendido?</td></tr>';
        mostrarToast('Error de conexión con el servidor', 'error');
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
        mostrarToast("Por favor escribe un número de documento", "warning");
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
        mostrarToast('Ingrese un número de documento o nombre', 'warning');
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
        mostrarToast('Primero busque un cliente', 'warning');
        return;
    }

    const monto = parseFloat(document.getElementById('monto-prestamo').value);
    const cuotas = parseInt(document.getElementById('num-cuotas').value);
    const mensajeDiv = document.getElementById('mensaje-prestamo');

    mensajeDiv.className = 'mensaje';
    mensajeDiv.innerText = '';

    if (!monto || !cuotas) {
        mostrarToast('Complete todos los campos', 'warning');
        return;
    }

    if (monto > 20000) {
        mostrarToast('El monto máximo es S/ 20,000', 'error');
        return;
    }

    if (cuotas > 24) {
        mostrarToast('El número máximo de cuotas es 24', 'error');
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
                    <td>
                        <button class="btn-small" style="background: #3498db; padding: 2px 5px; font-size: 0.8em;" 
                            onclick="verHistorial('${cuota.id}', ${cuota.numero_cuota}, '${prestamo.cliente_nombre}', '${prestamo.cliente_documento}')">
                            📜 Historial
                        </button>
                    </td>
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
        mostrarToast('Ingrese un número de documento o nombre', 'warning');
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
        mostrarToast('Seleccione una cuota', 'warning');
        return;
    }

    const montoPagar = parseFloat(document.getElementById('monto-pagar').value);
    const medioPago = document.getElementById('medio-pago').value;
    const mensajeDiv = document.getElementById('mensaje-pago');

    mensajeDiv.className = 'mensaje';
    mensajeDiv.innerText = '';

    if (!montoPagar || montoPagar <= 0) {
        mostrarToast('Ingrese un monto válido', 'warning');
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

    // CABECERA FORMAL
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text('AGILE PRÉSTAMOS S.A.C.', 105, y, { align: 'center' });

    y += 7;
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text('RUC: 20612345678', 105, y, { align: 'center' });

    y += 5;
    doc.text('Av. Principal 123, Lima - Perú', 105, y, { align: 'center' });

    y += 5;
    doc.text('Tel: (01) 234-5678', 105, y, { align: 'center' });

    y += 10;
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('COMPROBANTE DE PAGO', 105, y, { align: 'center' });

    y += 5;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Nº: ${datoPago.comprobante_id || 'N/A'}`, 105, y, { align: 'center' });

    // Línea separadora
    y += 8;
    doc.line(margen, y, 190, y);

    // DATOS DEL CLIENTE (FORMAL)
    y += 10;
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text('DATOS DEL CLIENTE:', margen, y);

    y += 7;
    doc.setFont(undefined, 'normal');
    doc.text(`Nombre/Razón Social: ${datoPago.cliente_nombre}`, margen, y);

    y += 6;
    doc.text(`DNI/RUC: ${datoPago.cliente_doc}`, margen, y);

    y += 6;
    doc.text(`Dirección: ${datoPago.cliente_direccion || 'No registrada'}`, margen, y);

    y += 6;
    const fecha = new Date().toLocaleString('es-PE');
    doc.text(`Fecha de Pago: ${fecha}`, margen, y);

    // Línea separadora
    y += 8;
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

            // Caja está abierta - ACTUALIZADO CON NUEVA LÓGICA
            document.getElementById('resumen-inicial').innerText = data.monto_inicial.toFixed(2);
            document.getElementById('resumen-efectivo').innerText = data.EFECTIVO.toFixed(2);

            // Total Digital (Yape + Plin)
            const totalDigital = (data.YAPE || 0) + (data.PLIN || 0);
            document.getElementById('resumen-digital').innerText = totalDigital.toFixed(2);

            document.getElementById('resumen-tarjeta').innerText = data.TARJETA.toFixed(2);

            // TOTAL DEBE HABER CAJÓN (Inicial + Efectivo)
            document.getElementById('resumen-total-cajon').innerText = data.saldo_teorico_cajon.toFixed(2);

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
    const montoReal = parseFloat(document.getElementById('monto-real-cierre').value);
    const mensajeDiv = document.getElementById('mensaje-caja');

    mensajeDiv.className = 'mensaje';
    mensajeDiv.innerText = '';

    if (isNaN(montoReal) || montoReal < 0) {
        alert('Por favor, ingrese el dinero físico que contó en el cajón');
        return;
    }

    if (!confirm('¿Está seguro de cerrar la caja? Esta acción generará el reporte final y cerrará el turno.')) {
        return;
    }

    mensajeDiv.innerText = '⏳ Cerrando caja...';

    try {
        const res = await fetch(`${API_URL}/caja/cierre`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ total_real_efectivo: montoReal })
        });

        const data = await res.json();

        if (res.ok) {
            const diferencia = data.diferencia;
            let msg = '✅ Caja cerrada exitosamente.\n';

            // Usar saldo_teorico_cajon que viene del backend
            const saldoEsperado = data.saldo_teorico_cajon || 0;

            if (diferencia > 0) {
                msg += `⚠️ SOBRANTE: S/ ${diferencia.toFixed(2)} (Había más dinero del esperado)`;
            } else if (diferencia < 0) {
                msg += `❌ FALTANTE: S/ ${Math.abs(diferencia).toFixed(2)} (Falta dinero según el sistema)`;
            } else {
                msg += '✨ CAJA CUADRADA: El dinero físico coincide exactamente.';
            }

            // Mostrar Toast también para mejor visibilidad
            mostrarToast(msg, diferencia < 0 ? 'error' : 'success');

            mensajeDiv.innerText = msg;
            mensajeDiv.className = diferencia === 0 ? 'mensaje exito' : (diferencia > 0 ? 'mensaje warning' : 'mensaje error');

            document.getElementById('monto-real-cierre').value = '';
            setTimeout(() => cargarEstadoCaja(), 4000);
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

// ==================== HISTORIAL DE PAGOS Y ANULACIONES ====================
async function verHistorial(cuotaId, numeroCuota, clienteNombre, clienteDoc) {
    document.getElementById('historial-num-cuota').innerText = numeroCuota;
    const lista = document.getElementById('historial-lista');
    lista.innerHTML = '<p style="text-align: center; color: #666;">Cargando...</p>';
    document.getElementById('modal-historial').style.display = 'flex';

    // Guardar datos temporalmente en el modal para reuso (simple hack)
    lista.setAttribute('data-cliente-nombre', clienteNombre);
    lista.setAttribute('data-cliente-doc', clienteDoc);

    try {
        const res = await fetch(`${API_URL}/pagos/historial/${cuotaId}`);
        const pagos = await res.json();

        lista.innerHTML = '';

        if (pagos.length === 0) {
            lista.innerHTML = '<p style="text-align: center; color: #666;">No hay pagos registrados para esta cuota.</p>';
            return;
        }

        const rol = localStorage.getItem('cajero_rol');
        const esAdmin = rol === 'admin';

        pagos.forEach(pago => {
            const fecha = new Date(pago.fecha_pago).toLocaleString('es-PE');
            const esAnulado = pago.estado === 'ANULADO';

            const item = document.createElement('div');
            item.style.borderBottom = '1px solid #eee';
            item.style.padding = '10px 0';
            item.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div>
                        <div style="font-weight: bold; color: ${esAnulado ? '#e74c3c' : '#2c3e50'};">
                            ${esAnulado ? '🔴 ANULADO' : '✅ PAGO REALIZADO'}
                        </div>
                        <div style="font-size: 0.9em; color: #555;">
                            Fecha: ${fecha}<br>
                            Monto: <strong>S/ ${pago.monto_pagado}</strong> (${pago.medio_pago})<br>
                            ID: <span style="font-family: monospace; font-size: 0.8em;">${pago.id.substring(0, 8)}...</span>
                        </div>
                    </div>
                    <div>
                        ${!esAnulado && esAdmin ? `
                            <button class="btn-small" style="background: #e74c3c;" onclick="anularPago('${pago.id}')">
                                ❌ Anular
                            </button>
                        ` : ''}
                        <button class="btn-small" style="background: #95a5a6; margin-left: 5px;" onclick="reimprimirComprobante('${pago.id}', '${pago.monto_pagado}', '${pago.medio_pago}')">
                            🖨️
                        </button>
                    </div>
                </div>
            `;
            lista.appendChild(item);
        });

    } catch (error) {
        console.error(error);
        lista.innerHTML = '<p style="text-align: center; color: red;">Error cargando historial.</p>';
    }
}

function cerrarHistorial() {
    document.getElementById('modal-historial').style.display = 'none';
}

async function anularPago(pagoId) {
    if (!confirm('⚠️ ¿ESTÁ SEGURO DE ANULAR ESTE PAGO?\n\nEsta acción es irreversible:\n1. El dinero se restará de la caja.\n2. La deuda volverá a estar pendiente.')) {
        return;
    }

    const usuario = localStorage.getItem('cajero_usuario');

    try {
        const res = await fetch(`${API_URL}/pagos/anular`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pago_id: pagoId, usuario_solicitante: usuario })
        });

        const data = await res.json();

        if (res.ok) {
            mostrarToast(`✅ ${data.mensaje}. Nuevo saldo: S/ ${data.nuevo_saldo}`, 'success');
            cerrarHistorial();
            // Recargar detalles del préstamo para ver cambios
            if (clienteSeleccionado) {
                const resPrestamo = await fetch(`${API_URL}/prestamos/cliente/${clienteSeleccionado.id}`);
                const dataPrestamo = await resPrestamo.json();
                mostrarDetallePrestamo(clienteSeleccionado.id, dataPrestamo);
            }
        } else {
            alert(`❌ Error: ${data.error}`);
        }
    } catch (error) {
        console.error(error);
        alert('❌ Error de conexión');
    }
}

// Función para reimpresión de comprobante
function reimprimirComprobante(id, monto, medio) {
    const lista = document.getElementById('historial-lista');
    const clienteNombre = lista.getAttribute('data-cliente-nombre');
    const clienteDoc = lista.getAttribute('data-cliente-doc');

    if (!clienteNombre) {
        alert('❌ Error: Datos del cliente no disponibles. Recargue la página.');
        return;
    }

    const numCuota = document.getElementById('historial-num-cuota').innerText;

    // Reconstruir objeto de datos para el PDF
    const datoPago = {
        cliente_nombre: clienteNombre,
        cliente_doc: clienteDoc || 'N/A',
        numero_cuota: numCuota,
        capital: monto,
        mora: 0,
        total: monto,
        medio_pago: medio,
        ajuste: 0,
        comprobante_id: id
    };

    if (confirm('¿Desea volver a descargar el comprobante?')) {
        generarComprobantePDF(datoPago);
    }
}

// ==================== EXPORTACIÓN A CSV ====================
function exportarClientesCSV() {
    const tabla = document.querySelector('.tabla-clientes');
    if (!tabla) {
        alert('No hay datos para exportar');
        return;
    }

    let csv = [];
    const filas = tabla.querySelectorAll('tr');

    filas.forEach(fila => {
        const celdas = fila.querySelectorAll('th, td');
        const fila_csv = [];
        celdas.forEach(celda => {
            // Limpiar texto (quitar HTML y saltos de línea)
            let texto = celda.innerText.replace(/"/g, '""').replace(/\n/g, ' ').trim();
            fila_csv.push(`"${texto}"`);
        });
        csv.push(fila_csv.join(','));
    });

    const contenido = csv.join('\n');
    const blob = new Blob(['\ufeff' + contenido], { type: 'text/csv;charset=utf-8;' }); // BOM para Excel
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `clientes_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();

    mostrarToast('📄 Archivo CSV descargado', 'success');
}

// ==================== CONFIGURACIÓN DEL SISTEMA ====================
function cargarConfiguracion() {
    // Cargar mora desde localStorage (o default 1%)
    const moraPorcentaje = localStorage.getItem('config_mora') || '1';
    document.getElementById('config-mora-porcentaje').value = moraPorcentaje;

    // Mostrar info del sistema
    document.getElementById('config-servidor-url').innerText = API_URL || window.location.origin;
    document.getElementById('config-usuario-actual').innerText = localStorage.getItem('cajero_usuario') || '-';
    document.getElementById('config-rol-actual').innerText = (localStorage.getItem('cajero_rol') || 'cajero').toUpperCase();
}

function guardarConfigMora() {
    const porcentaje = parseFloat(document.getElementById('config-mora-porcentaje').value);

    if (isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100) {
        mostrarToast('❌ Ingrese un porcentaje válido (0-100)', 'error');
        return;
    }

    localStorage.setItem('config_mora', porcentaje.toString());
    mostrarToast(`✅ Mora actualizada a ${porcentaje}%`, 'success');

    document.getElementById('mensaje-config').innerText = `✅ Configuración guardada. Nueva mora: ${porcentaje}%`;
    document.getElementById('mensaje-config').classList.add('exito');
}

// Función helper para obtener el porcentaje de mora configurado
function obtenerPorcentajeMora() {
    return parseFloat(localStorage.getItem('config_mora') || '1') / 100;
}

// ==================== ESTADO DE CUENTA DEL CLIENTE ====================
function verEstadoCuenta() {
    if (!prestamoActivo) {
        mostrarToast('Primero busque un cliente', 'warning');
        return;
    }

    const { prestamo, cuotas } = prestamoActivo;

    // Actualizar título
    document.getElementById('estado-cuenta-cliente').innerText = prestamo.cliente_nombre;

    // Calcular resumen
    const cuotasPagadas = cuotas.filter(c => c.pagada).length;
    const cuotasPendientes = cuotas.filter(c => !c.pagada).length;
    const totalPagado = cuotas.filter(c => c.pagada).reduce((sum, c) => sum + c.monto_cuota, 0);
    const totalPendiente = cuotas.filter(c => !c.pagada).reduce((sum, c) => sum + c.saldo_pendiente, 0);

    document.getElementById('estado-cuenta-resumen').innerHTML = `
        <div style="display: flex; justify-content: space-around; text-align: center;">
            <div>
                <div style="font-size: 2em; font-weight: bold; color: #27ae60;">${cuotasPagadas}</div>
                <div>Cuotas Pagadas</div>
            </div>
            <div>
                <div style="font-size: 2em; font-weight: bold; color: #e74c3c;">${cuotasPendientes}</div>
                <div>Cuotas Pendientes</div>
            </div>
            <div>
                <div style="font-size: 1.5em; font-weight: bold; color: #2c3e50;">S/ ${totalPendiente.toFixed(2)}</div>
                <div>Deuda Total</div>
            </div>
        </div>
    `;

    // Llenar tabla
    const tbody = document.getElementById('estado-cuenta-lista');
    tbody.innerHTML = '';

    const hoy = new Date().toISOString().split('T')[0];

    cuotas.forEach(cuota => {
        const vencida = cuota.fecha_vencimiento < hoy && !cuota.pagada;
        let estado = '';
        let detalle = '';

        if (cuota.pagada) {
            estado = '<span style="color: #27ae60; font-weight: bold;">✅ PAGADA</span>';
            detalle = 'A tiempo';
        } else if (vencida) {
            const fechaVenc = new Date(cuota.fecha_vencimiento);
            const diasAtraso = Math.floor((new Date(hoy) - fechaVenc) / (1000 * 60 * 60 * 24));
            estado = `<span style="color: #e74c3c; font-weight: bold;">🔴 VENCIDA</span>`;
            detalle = `${diasAtraso} días de atraso`;
        } else {
            estado = '<span style="color: #f39c12;">⏳ Pendiente</span>';
            detalle = 'Por vencer';
        }

        const row = document.createElement('tr');
        if (vencida) row.style.backgroundColor = '#ffebee';
        if (cuota.pagada) row.style.backgroundColor = '#e8f5e9';

        row.innerHTML = `
            <td>${cuota.fecha_vencimiento}</td>
            <td>Cuota ${cuota.numero_cuota}</td>
            <td>S/ ${cuota.monto_cuota}</td>
            <td>${estado}</td>
            <td>${detalle}</td>
        `;
        tbody.appendChild(row);
    });

    document.getElementById('modal-estado-cuenta').style.display = 'flex';
}

function cerrarEstadoCuenta() {
    document.getElementById('modal-estado-cuenta').style.display = 'none';
}

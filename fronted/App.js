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

    // Detectar callback de Flow
    const urlParams = new URLSearchParams(window.location.search);
    const pagoStatus = urlParams.get('pago');

    if (pagoStatus === 'flow') {
        setTimeout(() => {
            mostrarToast('✅ Pago procesado exitosamente vía Flow. El comprobante se generó automáticamente.', 'success');
            // Limpiar URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }, 1500);
    } else if (pagoStatus === 'fallido') {
        setTimeout(() => {
            mostrarToast('❌ El pago no pudo ser procesado. Intente nuevamente.', 'error');
            window.history.replaceState({}, document.title, window.location.pathname);
        }, 1500);
    } else if (pagoStatus === 'pendiente') {
        setTimeout(() => {
            mostrarToast('⏳ Pago pendiente de confirmación.', 'warning');
            window.history.replaceState({}, document.title, window.location.pathname);
        }, 1500);
    }
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
    // Ocultar login y mostrar app con el nuevo layout
    document.getElementById('pantalla-login').style.display = 'none';
    document.getElementById('app-principal').style.display = 'flex';

    // Mostrar nombre del cajero
    const nombre = usuario.charAt(0).toUpperCase() + usuario.slice(1);
    const rol = localStorage.getItem('cajero_rol') || 'cajero';

    // Actualizar sidebar con info del usuario
    const sidebarUserName = document.getElementById('sidebar-user-name');
    const sidebarUserRole = document.getElementById('sidebar-user-role');
    const userAvatar = document.getElementById('user-avatar');

    if (sidebarUserName) sidebarUserName.innerText = nombre;
    if (sidebarUserRole) sidebarUserRole.innerText = rol === 'admin' ? 'Administrador' : 'Operador';
    if (userAvatar) userAvatar.innerText = nombre.charAt(0).toUpperCase();

    // CONTROL DE ROLES: Ocultar botones de Admin si es Cajero
    const botonesAdmin = document.querySelectorAll('.btn-admin');
    if (rol !== 'admin') {
        botonesAdmin.forEach(btn => btn.style.display = 'none');
    } else {
        botonesAdmin.forEach(btn => btn.style.display = 'flex');
    }

    // Cargar dashboard como sección inicial
    mostrarSeccion('dashboard');
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

    // Actualizar botones de navegación del sidebar
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(b => b.classList.remove('active'));

    // Encontrar y activar el botón correcto
    navItems.forEach(btn => {
        if (btn.onclick && btn.onclick.toString().includes(`'${id}'`)) {
            btn.classList.add('active');
        }
    });

    // Actualizar título de página
    const titles = {
        'dashboard': 'Dashboard',
        'clientes': 'Gestión de Clientes',
        'prestamos': 'Gestión de Préstamos',
        'pagos': 'Cobranza',
        'caja': 'Control de Caja',
        'empleados': 'Gestión de Empleados',
        'config': 'Configuración'
    };
    const pageTitle = document.getElementById('page-title');
    if (pageTitle) pageTitle.innerText = titles[id] || id;

    // Actualizar fecha en header
    const headerDate = document.getElementById('header-date');
    if (headerDate) {
        const hoy = new Date();
        headerDate.innerText = hoy.toLocaleDateString('es-PE', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
    }

    // Cargar datos si es necesario
    if (id === 'dashboard') cargarDashboard();
    if (id === 'clientes') cargarClientes();
    if (id === 'empleados') cargarEmpleados();
    if (id === 'config') cargarConfiguracion();
}

function mostrarCaja() {
    mostrarSeccion('caja');
    cargarEstadoCaja();
}

// ==================== MÓDULO DASHBOARD ====================
async function cargarDashboard() {
    try {
        // Cargar estadísticas
        const [clientesRes, prestamosRes, cajaRes] = await Promise.all([
            fetch(`${API_URL}/clientes`),
            fetch(`${API_URL}/prestamos`),
            fetch(`${API_URL}/caja/resumen-actual`).catch(() => ({ ok: false }))
        ]);

        // Total clientes
        if (clientesRes.ok) {
            const clientes = await clientesRes.json();
            document.getElementById('stat-clientes').innerText = clientes.length;
        }

        // Préstamos activos
        if (prestamosRes.ok) {
            const prestamos = await prestamosRes.json();
            const activos = prestamos.filter(p => !p.cancelado);
            document.getElementById('stat-prestamos').innerText = activos.length;
        }

        // Cobrado hoy (si hay caja abierta)
        if (cajaRes.ok) {
            const caja = await cajaRes.json();
            const totalHoy = (caja.EFECTIVO || 0) + (caja.YAPE || 0) + (caja.PLIN || 0) + (caja.TARJETA || 0);
            document.getElementById('stat-cobrado').innerText = `S/ ${totalHoy.toFixed(2)}`;
        }

        // Cargar cuotas vencidas
        await cargarCuotasVencidas();

    } catch (err) {
        console.error('Error cargando dashboard:', err);
    }
}

async function cargarCuotasVencidas() {
    try {
        const res = await fetch(`${API_URL}/clientes`);
        if (!res.ok) return;

        const clientes = await res.json();
        const hoy = new Date().toISOString().split('T')[0];
        let morosos = 0;
        let cuotasVencidas = [];

        for (const cliente of clientes) {
            const prestamoRes = await fetch(`${API_URL}/prestamos/cliente/${cliente.id}`);
            if (!prestamoRes.ok) continue;

            const data = await prestamoRes.json();
            if (!data.cuotas) continue;

            data.cuotas.forEach(cuota => {
                if (!cuota.pagada && cuota.fecha_vencimiento < hoy) {
                    const diasAtraso = Math.floor((new Date(hoy) - new Date(cuota.fecha_vencimiento)) / (1000 * 60 * 60 * 24));
                    cuotasVencidas.push({
                        cliente: cliente.nombre,
                        cuota: cuota.numero_cuota,
                        monto: cuota.saldo_pendiente,
                        dias: diasAtraso
                    });
                }
            });
        }

        // Actualizar contador de morosos
        const clientesMorosos = [...new Set(cuotasVencidas.map(c => c.cliente))].length;
        document.getElementById('stat-morosos').innerText = clientesMorosos;

        // Mostrar lista de cuotas vencidas
        const lista = document.getElementById('lista-cuotas-vencidas');
        if (cuotasVencidas.length === 0) {
            lista.innerHTML = '<p style="text-align: center; color: var(--secondary);">✅ No hay cuotas vencidas hoy</p>';
        } else {
            lista.innerHTML = cuotasVencidas.slice(0, 5).map(c => `
                <div style="padding: 10px; border-left: 3px solid var(--danger); margin-bottom: 10px; background: rgba(229,62,62,0.05); border-radius: 4px;">
                    <strong>${c.cliente}</strong> - Cuota ${c.cuota} - 
                    <span style="color: var(--danger);">S/ ${c.monto.toFixed(2)}</span> - 
                    <span style="font-size: 0.85em; color: var(--text-muted);">${c.dias} días de atraso</span>
                </div>
            `).join('');
        }

    } catch (err) {
        console.error('Error cargando cuotas vencidas:', err);
    }
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

// === VALIDACIONES DE FORMULARIO CLIENTE ===
function actualizarMaxLengthDocumento() {
    const tipo = document.getElementById('tipo').value;
    const docInput = document.getElementById('documento');
    const mensaje = document.getElementById('doc-mensaje');

    if (tipo === 'DNI') {
        docInput.maxLength = 8;
        mensaje.innerText = 'DNI debe tener exactamente 8 dígitos.';
    } else if (tipo === 'RUC') {
        docInput.maxLength = 11;
        mensaje.innerText = 'RUC debe tener exactamente 11 dígitos.';
    } else {
        docInput.maxLength = 20;
        mensaje.innerText = 'Ingrese el número de pasaporte.';
    }
    docInput.value = '';
    document.getElementById('doc-validacion').innerText = '';
}

function validarDocumento() {
    const tipo = document.getElementById('tipo').value;
    const docInput = document.getElementById('documento');
    const validacion = document.getElementById('doc-validacion');
    const valor = docInput.value.replace(/[^0-9]/g, '');
    docInput.value = valor;

    let valido = false;
    if (tipo === 'DNI' && valor.length === 8) valido = true;
    if (tipo === 'RUC' && valor.length === 11) valido = true;
    if (tipo === 'PASAPORTE' && valor.length >= 6) valido = true;

    validacion.innerText = valido ? '✅' : (valor.length > 0 ? '❌' : '');
    validacion.style.color = valido ? 'var(--secondary)' : 'var(--danger)';
}

// Timer para debounce (evitar múltiples llamadas)
let busquedaDNITimeout = null;

async function buscarDatosCliente() {
    const tipo = document.getElementById('tipo').value;
    const documento = document.getElementById('documento').value.trim();

    // Cancelar búsqueda anterior si existe
    if (busquedaDNITimeout) {
        clearTimeout(busquedaDNITimeout);
    }

    // Validar longitud antes de buscar
    if (tipo === 'DNI' && documento.length !== 8) return;
    if (tipo === 'RUC' && documento.length !== 11) return;
    if (!documento) return;

    // Primero verificar si el cliente ya existe localmente
    try {
        const resClientes = await fetch(`${API_URL}/clientes`);
        const clientes = await resClientes.json();
        const existe = clientes.find(c => c.documento === documento);

        if (existe) {
            // Si existe, llenar con datos guardados
            document.getElementById('nombre').value = existe.nombre;
            document.getElementById('direccion').value = existe.direccion || '';
            document.getElementById('telefono').value = existe.telefono || '';
            document.getElementById('email').value = existe.email || '';
            document.getElementById('doc-validacion').innerText = '⚠️ Ya existe';
            document.getElementById('doc-validacion').style.color = 'var(--warning)';
            document.getElementById('doc-mensaje').innerText = `Cliente ya registrado: ${existe.nombre}`;
            mostrarToast(`Cliente ya existe: ${existe.nombre}`, 'warning');
            return;
        }
    } catch (err) {
        console.error('Error verificando cliente:', err);
    }

    // Si no existe localmente, consultar API externa
    document.getElementById('doc-validacion').innerText = '⏳';
    document.getElementById('doc-validacion').style.color = 'var(--info)';
    document.getElementById('doc-mensaje').innerText = 'Consultando datos...';

    try {
        const res = await fetch(`${API_URL}/clientes/consulta-externa/${tipo}/${documento}`);

        if (res.ok) {
            const datos = await res.json();

            // Llenar automáticamente el formulario
            if (datos.nombre) {
                document.getElementById('nombre').value = datos.nombre;
            }
            if (datos.direccion) {
                document.getElementById('direccion').value = datos.direccion;
            }

            document.getElementById('doc-validacion').innerText = '✅';
            document.getElementById('doc-validacion').style.color = 'var(--secondary)';
            document.getElementById('doc-mensaje').innerText = '✅ Datos encontrados. Complete el resto del formulario.';
            mostrarToast('Datos encontrados en RENIEC/SUNAT', 'success');
        } else {
            // No se encontró en API externa
            document.getElementById('doc-validacion').innerText = '❌';
            document.getElementById('doc-validacion').style.color = 'var(--danger)';
            document.getElementById('doc-mensaje').innerText = 'No se encontraron datos. Complete manualmente.';
            mostrarToast('No se encontraron datos. Complete manualmente', 'warning');
        }
    } catch (error) {
        console.error('Error consultando datos:', error);
        document.getElementById('doc-validacion').innerText = '❌';
        document.getElementById('doc-validacion').style.color = 'var(--danger)';
        document.getElementById('doc-mensaje').innerText = 'Error de conexión. Complete manualmente.';
        mostrarToast('Error de conexión con servicio externo', 'error');
    }
}

async function verificarDuplicado() {
    const documento = document.getElementById('documento').value.trim();
    if (documento.length < 6) return;

    try {
        const res = await fetch(`${API_URL}/clientes`);
        const clientes = await res.json();
        const existe = clientes.find(c => c.documento === documento);

        if (existe) {
            document.getElementById('doc-validacion').innerText = '⚠️ Ya existe';
            document.getElementById('doc-validacion').style.color = 'var(--warning)';
            document.getElementById('doc-mensaje').innerText = `Cliente ya registrado: ${existe.nombre}`;
            document.getElementById('nombre').value = existe.nombre;
            document.getElementById('telefono').value = existe.telefono || '';
            document.getElementById('direccion').value = existe.direccion || '';
            document.getElementById('email').value = existe.email || '';
            mostrarToast(`Este cliente ya existe: ${existe.nombre}`, 'warning');
        }
    } catch (err) {
        console.error('Error verificando duplicado:', err);
    }
}

function limpiarFormularioCliente() {
    document.getElementById('tipo').value = 'DNI';
    document.getElementById('documento').value = '';
    document.getElementById('nombre').value = '';
    document.getElementById('direccion').value = '';
    document.getElementById('telefono').value = '';
    document.getElementById('email').value = '';
    document.getElementById('doc-validacion').innerText = '';
    document.getElementById('doc-mensaje').innerText = 'DNI debe tener exactamente 8 dígitos.';
    document.getElementById('mensaje').innerText = '';
    document.getElementById('mensaje').className = 'mensaje';
    actualizarMaxLengthDocumento();
}

async function crearCliente() {
    const tipo = document.getElementById('tipo').value;
    const documento = document.getElementById('documento').value.trim();
    const nombre = document.getElementById('nombre').value.trim();
    const direccion = document.getElementById('direccion').value.trim();
    const telefono = document.getElementById('telefono').value.trim();
    const email = document.getElementById('email').value.trim();
    const mensajeDiv = document.getElementById('mensaje');

    // Limpiar mensajes previos
    mensajeDiv.className = 'mensaje';
    mensajeDiv.innerText = '';

    // Validaciones
    const errores = [];

    if (!documento) errores.push('Número de documento');
    if (tipo === 'DNI' && documento.length !== 8) errores.push('DNI debe tener 8 dígitos');
    if (tipo === 'RUC' && documento.length !== 11) errores.push('RUC debe tener 11 dígitos');
    if (!nombre) errores.push('Nombre completo');
    if (!direccion) errores.push('Dirección');
    if (!telefono) errores.push('Teléfono/WhatsApp');
    if (telefono && telefono.length !== 9) errores.push('Teléfono debe tener 9 dígitos');
    if (email && !email.includes('@')) errores.push('Email inválido');

    if (errores.length > 0) {
        mostrarToast(`Campos faltantes o inválidos: ${errores.join(', ')}`, 'warning');
        mensajeDiv.innerText = `❌ Complete los campos obligatorios: ${errores.join(', ')}`;
        mensajeDiv.classList.add('error');
        return;
    }

    mensajeDiv.innerText = '⏳ Guardando cliente...';

    try {
        const res = await fetch(`${API_URL}/clientes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tipo,
                documento,
                nombre,
                direccion,
                telefono,
                email
            })
        });

        const data = await res.json();

        if (res.ok) {
            mensajeDiv.innerText = `✅ ¡Cliente registrado exitosamente!`;
            mensajeDiv.classList.add('exito');
            mostrarToast(`Cliente ${nombre} guardado correctamente`, 'success');
            limpiarFormularioCliente();
            cargarClientes();
        } else {
            mensajeDiv.innerText = `❌ Error: ${data.error}`;
            mensajeDiv.classList.add('error');
            mostrarToast(data.error, 'error');
        }
    } catch (error) {
        console.error(error);
        mensajeDiv.innerText = '❌ Error de conexión con el servidor';
        mensajeDiv.classList.add('error');
        mostrarToast('Error de conexión', 'error');
    }
}

// ==================== NAVEGACIÓN ====================
function mostrarSeccion(seccionId) {
    // Ocultar todas las secciones
    document.querySelectorAll('.seccion').forEach(sec => sec.style.display = 'none');

    // Mostrar la sección seleccionada
    const seccion = document.getElementById(`seccion-${seccionId}`);
    if (seccion) {
        seccion.style.display = 'block';
    }

    // Actualizar título de la página
    const titulos = {
        'dashboard': 'Dashboard',
        'clientes': 'Clientes',
        'prestamos': 'Préstamos',
        'pagos': 'Cobranza',
        'caja': 'Control de Caja',
        'calendario': 'Calendario de Vencimientos',
        'empleados': 'Empleados',
        'config': 'Configuración del Sistema'
    };
    const pageTitle = document.getElementById('page-title');
    if (pageTitle) pageTitle.innerText = titulos[seccionId] || 'Dashboard';

    // Actualizar botones activos en sidebar
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    // Buscar el botón que corresponde a esta sección
    document.querySelectorAll('.nav-item').forEach(btn => {
        if (btn.getAttribute('onclick')?.includes(seccionId)) {
            btn.classList.add('active');
        }
    });

    // Cargar datos específicos según la sección
    switch (seccionId) {
        case 'dashboard':
            cargarDashboard();
            break;
        case 'clientes':
            cargarClientes();
            break;
        case 'caja':
            cargarEstadoCaja();
            break;
        case 'calendario':
            cargarCalendario();
            break;
        case 'empleados':
            cargarEmpleados();
            break;
        case 'config':
            cargarConfiguracion();
            break;
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

                const esParcial = !cuota.pagada && cuota.saldo_pendiente < cuota.monto_cuota;
                const porcentajePagado = esParcial ? Math.round(((cuota.monto_cuota - cuota.saldo_pendiente) / cuota.monto_cuota) * 100) : 0;

                const estado = cuota.pagada ?
                    '<span class="badge-pagada">✅ Pagada</span>' :
                    vencida ?
                        `<span class="badge-vencida">🔴 VENCIDA (${diasAtraso}d)</span>` :
                        esParcial ?
                            `<span class="badge-pendiente" style="background:#e67e22; color:white;">📉 Pendiente (Falta S/ ${cuota.saldo_pendiente.toFixed(2)})</span>` :
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

    // FLOW: Redirigir a página de pago externa
    if (medioPago === 'FLOW') {
        try {
            const flowRes = await fetch(`${API_URL}/flow/crear-pago`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cuota_id: cuotaSeleccionada.id,
                    monto: montoPagar,
                    cliente_nombre: prestamoActivo.prestamo.cliente_nombre,
                    cliente_email: prestamoActivo.prestamo.cliente_email || 'cliente@example.com'
                })
            });

            const flowData = await flowRes.json();

            if (flowRes.ok && flowData.url) {
                mensajeDiv.innerHTML = `
                    <p>🔵 Redirigiendo a Flow...</p>
                    <p style="font-size: 0.9em; color: #666;">Si no se abre automáticamente, 
                    <a href="${flowData.url}" target="_blank" style="color: #3498db;">haz clic aquí</a></p>
                `;
                // Redirigir a Flow
                window.open(flowData.url, '_blank');
                return;
            } else {
                mensajeDiv.innerText = `❌ Error con Flow: ${flowData.error || 'Intente nuevamente'}`;
                mensajeDiv.classList.add('error');
                return;
            }
        } catch (err) {
            console.error('Error Flow:', err);
            mensajeDiv.innerText = '❌ Error conectando con Flow';
            mensajeDiv.classList.add('error');
            return;
        }
    }

    // PAGO NORMAL (Efectivo, Yape, Plin, Tarjeta)
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


            // Guardar datos para reimpresión temporal (opcional)
            // ...

            // Preguntar acciones de comprobante (RF3)
            setTimeout(() => {
                const opcion = prompt(
                    `✅ ¡Pago registrado correctamente!\n\n` +
                    `Elija una opción de comprobante:\n` +
                    `1️⃣ Descargar PDF\n` +
                    `2️⃣ Enviar por WhatsApp\n` +
                    `3️⃣ Ambos\n\n` +
                    `Cualquier otra tecla para salir.`
                );

                if (opcion === '1' || opcion === '3') {
                    generarComprobantePDF(datoPago);
                }
                if (opcion === '2' || opcion === '3') {
                    compartirWhatsApp(datoPago);
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
    const margen = 15;
    let y = 15;
    const anchoDoc = 210;
    const altoPagina = 297;

    // Determinar tipo de documento: FACTURA (RUC 11 dígitos) o BOLETA (DNI 8 dígitos)
    const docCliente = (datoPago.cliente_doc || '').replace(/\D/g, '');
    const esFactura = docCliente.length === 11;
    const tipoDoc = esFactura ? 'FACTURA ELECTRÓNICA' : 'BOLETA DE VENTA ELECTRÓNICA';
    const serieDoc = esFactura ? 'F001' : 'B001';
    const numDoc = datoPago.comprobante_id ? datoPago.comprobante_id.substring(0, 8).toUpperCase() : '00000001';

    // ==================== CABECERA ====================
    // Logo placeholder (izquierda)
    doc.setFillColor(240, 240, 240);
    doc.rect(margen, y, 40, 25, 'F');
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text('CAPITAL RISE', margen + 20, y + 10, { align: 'center' });
    doc.text('LOANS', margen + 20, y + 15, { align: 'center' });

    // Datos de empresa (centro)
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('CAPITAL RISE LOANS S.A.C.', 105, y + 5, { align: 'center' });

    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text('Av. Javier Prado Este 4200, San Isidro', 105, y + 12, { align: 'center' });
    doc.text('Lima - Perú', 105, y + 17, { align: 'center' });
    doc.text('Tel: (01) 555-0123 | info@capitalrise.pe', 105, y + 22, { align: 'center' });

    // Recuadro tipo documento (derecha)
    doc.setDrawColor(0, 100, 180);
    doc.setLineWidth(1);
    doc.rect(145, y, 50, 25);

    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 100, 180);
    doc.text('R.U.C. 20612345678', 170, y + 7, { align: 'center' });

    doc.setFontSize(10);
    doc.text(tipoDoc, 170, y + 14, { align: 'center' });

    doc.setFontSize(11);
    doc.text(`${serieDoc} - ${numDoc}`, 170, y + 21, { align: 'center' });

    // ==================== DATOS DEL CLIENTE ====================
    y += 35;
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.rect(margen, y, anchoDoc - 30, 30);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');

    y += 7;
    doc.text('Fecha de Emisión:', margen + 3, y);
    doc.setFont(undefined, 'normal');
    const fechaEmision = new Date().toLocaleDateString('es-PE');
    doc.text(fechaEmision, margen + 40, y);

    doc.setFont(undefined, 'bold');
    doc.text('Forma de Pago:', 120, y);
    doc.setFont(undefined, 'normal');
    doc.text(datoPago.medio_pago || 'Contado', 155, y);

    y += 8;
    doc.setFont(undefined, 'bold');
    doc.text('Señor(es):', margen + 3, y);
    doc.setFont(undefined, 'normal');
    doc.text(datoPago.cliente_nombre || 'Cliente', margen + 25, y);

    y += 8;
    doc.setFont(undefined, 'bold');
    doc.text(esFactura ? 'RUC:' : 'DNI:', margen + 3, y);
    doc.setFont(undefined, 'normal');
    doc.text(datoPago.cliente_doc || '-', margen + 25, y);

    doc.setFont(undefined, 'bold');
    doc.text('Dirección:', 90, y);
    doc.setFont(undefined, 'normal');
    doc.text(datoPago.cliente_direccion || 'Lima, Perú', 115, y);

    // ==================== TABLA DE DETALLE ====================
    y += 15;

    // Cabecera tabla
    doc.setFillColor(0, 100, 180);
    doc.rect(margen, y, anchoDoc - 30, 8, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(8);
    doc.text('CANTIDAD', margen + 5, y + 5.5);
    doc.text('U.M.', margen + 30, y + 5.5);
    doc.text('DESCRIPCIÓN', margen + 50, y + 5.5);
    doc.text('P. UNIT.', margen + 125, y + 5.5);
    doc.text('IMPORTE', margen + 155, y + 5.5);

    // Fila de detalle
    y += 8;
    doc.setTextColor(0, 0, 0);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);

    doc.rect(margen, y, anchoDoc - 30, 10);
    doc.text('1', margen + 10, y + 6.5, { align: 'center' });
    doc.text('UND', margen + 32, y + 6.5);
    doc.text(`Pago Cuota ${datoPago.numero_cuota} - Préstamo`, margen + 50, y + 6.5);
    doc.text(`S/ ${parseFloat(datoPago.capital).toFixed(2)}`, margen + 130, y + 6.5);
    doc.text(`S/ ${parseFloat(datoPago.capital).toFixed(2)}`, margen + 160, y + 6.5);

    // Fila de mora si existe
    if (parseFloat(datoPago.mora) > 0) {
        y += 10;
        doc.rect(margen, y, anchoDoc - 30, 10);
        doc.text('1', margen + 10, y + 6.5, { align: 'center' });
        doc.text('UND', margen + 32, y + 6.5);
        doc.setTextColor(200, 50, 50);
        doc.text('Mora por atraso', margen + 50, y + 6.5);
        doc.text(`S/ ${parseFloat(datoPago.mora).toFixed(2)}`, margen + 130, y + 6.5);
        doc.text(`S/ ${parseFloat(datoPago.mora).toFixed(2)}`, margen + 160, y + 6.5);
        doc.setTextColor(0, 0, 0);
    }

    // ==================== TOTALES ====================
    y += 25;

    // Recuadro totales
    doc.rect(120, y, 75, 40);

    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');

    const subTotal = parseFloat(datoPago.capital) + parseFloat(datoPago.mora || 0);
    const igv = 0; // Préstamos exonerados de IGV
    const total = parseFloat(datoPago.total);

    doc.text('Op. Gravada:', 125, y + 8);
    doc.text(`S/ 0.00`, 185, y + 8, { align: 'right' });

    doc.text('Op. Exonerada:', 125, y + 16);
    doc.text(`S/ ${subTotal.toFixed(2)}`, 185, y + 16, { align: 'right' });

    doc.text('IGV (18%):', 125, y + 24);
    doc.text(`S/ ${igv.toFixed(2)}`, 185, y + 24, { align: 'right' });

    doc.setFontSize(11);
    doc.text('IMPORTE TOTAL:', 125, y + 34);
    doc.text(`S/ ${total.toFixed(2)}`, 185, y + 34, { align: 'right' });

    // Monto en letras (izquierda)
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    const montoEntero = Math.floor(total);
    const centavos = Math.round((total - montoEntero) * 100);
    doc.text(`SON: ${numeroALetras(montoEntero)} CON ${centavos}/100 SOLES`, margen, y + 10);

    // ==================== PIE DE PÁGINA ====================
    y += 55;
    doc.setDrawColor(200, 200, 200);
    doc.line(margen, y, anchoDoc - margen, y);

    y += 8;
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text('Representación impresa de la ' + tipoDoc.toLowerCase() + ', generada en el Sistema AGILE.', 105, y, { align: 'center' });

    y += 5;
    doc.text(`Cajero: ${localStorage.getItem('cajero_usuario') || 'Sistema'} | Fecha: ${new Date().toLocaleString('es-PE')}`, 105, y, { align: 'center' });

    y += 5;
    doc.text('Gracias por su preferencia - www.capitalrise.pe', 105, y, { align: 'center' });

    // ==================== GUARDAR ====================
    const nombreArchivo = `${serieDoc}-${numDoc}.pdf`;
    doc.save(nombreArchivo);

    console.log(`✅ ${tipoDoc} generada: ${nombreArchivo}`);
}

// Función auxiliar para convertir número a letras
function numeroALetras(num) {
    const unidades = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
    const decenas = ['', 'DIEZ', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
    const especiales = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
    const centenas = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

    if (num === 0) return 'CERO';
    if (num === 100) return 'CIEN';

    let resultado = '';

    if (num >= 1000) {
        const miles = Math.floor(num / 1000);
        resultado += miles === 1 ? 'MIL ' : numeroALetras(miles) + ' MIL ';
        num %= 1000;
    }

    if (num >= 100) {
        resultado += centenas[Math.floor(num / 100)] + ' ';
        num %= 100;
    }

    if (num >= 10 && num < 20) {
        resultado += especiales[num - 10];
        return resultado.trim();
    }

    if (num >= 20) {
        resultado += decenas[Math.floor(num / 10)];
        num %= 10;
        if (num > 0) resultado += ' Y ';
    }

    if (num > 0) {
        resultado += unidades[num];
    }

    return resultado.trim();
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

        const esParcial = !cuota.pagada && cuota.saldo_pendiente < cuota.monto_cuota;

        if (cuota.pagada) {
            estado = '<span style="color: #27ae60; font-weight: bold;">✅ PAGADA</span>';
            detalle = 'A tiempo';
        } else if (vencida) {
            const fechaVenc = new Date(cuota.fecha_vencimiento);
            const diasAtraso = Math.floor((new Date(hoy) - fechaVenc) / (1000 * 60 * 60 * 24));
            estado = `<span style="color: #e74c3c; font-weight: bold;">🔴 VENCIDA</span>`;
            detalle = `${diasAtraso} días de atraso`;
        } else if (esParcial) {
            estado = '<span style="color: #e67e22; font-weight: bold;">📉 PARCIAL</span>';
            detalle = `Falta S/ ${cuota.saldo_pendiente.toFixed(2)}`;
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

// ==================== BÚSQUEDA GLOBAL ====================
let searchTimeout;
async function buscarGlobal(query) {
    const resultados = document.getElementById('resultados-busqueda');

    if (query.length < 2) {
        resultados.style.display = 'none';
        return;
    }

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`${API_URL}/clientes`);
            if (!res.ok) return;

            const clientes = await res.json();
            const termino = query.toLowerCase();

            const coincidencias = clientes.filter(c =>
                c.nombre.toLowerCase().includes(termino) ||
                c.documento.includes(termino) ||
                (c.telefono && c.telefono.includes(termino))
            ).slice(0, 8);

            if (coincidencias.length === 0) {
                resultados.innerHTML = '<div class="search-result-item">No se encontraron resultados</div>';
            } else {
                resultados.innerHTML = coincidencias.map(c => `
                    <div class="search-result-item" onclick="irACliente('${c.id}')">
                        <span class="search-result-type">Cliente</span>
                        <strong>${c.nombre}</strong> - ${c.documento}
                    </div>
                `).join('');
            }

            resultados.style.display = 'block';
        } catch (err) {
            console.error('Error en búsqueda:', err);
        }
    }, 300);
}

function irACliente(clienteId) {
    document.getElementById('resultados-busqueda').style.display = 'none';
    document.getElementById('busqueda-global').value = '';
    mostrarSeccion('clientes');
    // Resaltar el cliente encontrado
    setTimeout(() => {
        const fila = document.querySelector(`tr[data-cliente-id="${clienteId}"]`);
        if (fila) {
            fila.style.background = 'rgba(214, 158, 46, 0.3)';
            fila.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => fila.style.background = '', 2000);
        }
    }, 500);
}

// Cerrar búsqueda al hacer clic fuera
document.addEventListener('click', (e) => {
    const searchBox = document.querySelector('.search-global');
    if (searchBox && !searchBox.contains(e.target)) {
        document.getElementById('resultados-busqueda').style.display = 'none';
    }
});

// ==================== MODO OSCURO ====================
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const icon = document.getElementById('dark-mode-icon');
    const isDark = document.body.classList.contains('dark-mode');

    icon.innerText = isDark ? '☀️' : '🌙';
    localStorage.setItem('darkMode', isDark ? 'true' : 'false');
}

// Cargar preferencia de modo oscuro al iniciar
if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
    const icon = document.getElementById('dark-mode-icon');
    if (icon) icon.innerText = '☀️';
}

// ==================== CALENDARIO ====================
let calendarioFechaActual = new Date();
let vencimientosCalendario = {};

async function cargarCalendario() {
    const grid = document.getElementById('calendario-grid');
    if (!grid) return;

    const año = calendarioFechaActual.getFullYear();
    const mes = calendarioFechaActual.getMonth();

    // Actualizar título del mes
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    document.getElementById('calendario-mes-actual').innerText = `${meses[mes]} ${año}`;

    // Cargar vencimientos del mes
    await cargarVencimientosMes(año, mes);

    // Generar calendario
    const primerDia = new Date(año, mes, 1);
    const ultimoDia = new Date(año, mes + 1, 0);
    const diasEnMes = ultimoDia.getDate();
    const primerDiaSemana = primerDia.getDay();

    const hoy = new Date();
    const hoyStr = hoy.toISOString().split('T')[0];

    let html = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(d =>
        `<div class="calendario-header">${d}</div>`
    ).join('');

    // Días vacíos al inicio
    for (let i = 0; i < primerDiaSemana; i++) {
        html += '<div class="calendario-dia otro-mes"></div>';
    }

    // Días del mes
    for (let dia = 1; dia <= diasEnMes; dia++) {
        const fechaStr = `${año}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
        const esHoy = fechaStr === hoyStr;
        const venc = vencimientosCalendario[fechaStr] || [];
        const tieneVencimientos = venc.length > 0;
        const vencidos = venc.some(v => v.vencido);

        let clases = 'calendario-dia';
        if (esHoy) clases += ' hoy';
        if (tieneVencimientos && vencidos) clases += ' vencidos';
        else if (tieneVencimientos) clases += ' con-vencimientos';

        html += `
            <div class="${clases}" onclick="mostrarVencimientosDia('${fechaStr}')">
                <span class="num-dia">${dia}</span>
                ${tieneVencimientos ? `<span class="num-vencimientos">${venc.length}</span>` : ''}
            </div>
        `;
    }

    grid.innerHTML = html;
}

async function cargarVencimientosMes(año, mes) {
    vencimientosCalendario = {};

    try {
        const res = await fetch(`${API_URL}/clientes`);
        if (!res.ok) return;

        const clientes = await res.json();
        const hoy = new Date().toISOString().split('T')[0];

        for (const cliente of clientes) {
            const prestamoRes = await fetch(`${API_URL}/prestamos/cliente/${cliente.id}`);
            if (!prestamoRes.ok) continue;

            const data = await prestamoRes.json();
            if (!data.cuotas) continue;

            data.cuotas.forEach(cuota => {
                if (cuota.pagada) return;

                const fechaVenc = cuota.fecha_vencimiento;
                const [cAño, cMes] = fechaVenc.split('-').map(Number);

                if (cAño === año && cMes - 1 === mes) {
                    if (!vencimientosCalendario[fechaVenc]) {
                        vencimientosCalendario[fechaVenc] = [];
                    }
                    vencimientosCalendario[fechaVenc].push({
                        cliente: cliente.nombre,
                        clienteId: cliente.id,
                        telefono: cliente.telefono,
                        cuota: cuota.numero_cuota,
                        monto: cuota.saldo_pendiente,
                        vencido: fechaVenc < hoy
                    });
                }
            });
        }
    } catch (err) {
        console.error('Error cargando vencimientos:', err);
    }
}

function cambiarMesCalendario(delta) {
    calendarioFechaActual.setMonth(calendarioFechaActual.getMonth() + delta);
    cargarCalendario();
}

function mostrarVencimientosDia(fecha) {
    const venc = vencimientosCalendario[fecha] || [];
    const container = document.getElementById('vencimientos-dia');
    const titulo = document.getElementById('vencimientos-dia-titulo');
    const lista = document.getElementById('lista-vencimientos-dia');

    if (venc.length === 0) {
        container.style.display = 'none';
        return;
    }

    titulo.innerText = `Vencimientos del ${fecha}`;
    lista.innerHTML = venc.map(v => `
        <div style="padding: 12px; border-left: 3px solid ${v.vencido ? 'var(--danger)' : 'var(--warning)'}; 
                    margin-bottom: 10px; background: var(--bg-main); border-radius: 4px;">
            <strong>${v.cliente}</strong> - Cuota ${v.cuota}<br>
            <span style="color: ${v.vencido ? 'var(--danger)' : 'var(--text-secondary)'};">
                S/ ${v.monto.toFixed(2)} ${v.vencido ? '(VENCIDO)' : ''}
            </span>
            ${v.telefono ? `
                <button class="btn-small" style="margin-left: 10px;" 
                    onclick="enviarRecordatorioWhatsApp('${v.telefono}', '${v.cliente}', ${v.cuota}, ${v.monto})">
                    📱 WhatsApp
                </button>
            ` : ''}
        </div>
    `).join('');

    container.style.display = 'block';
}

// ==================== RECORDATORIOS MASIVOS ====================
async function enviarRecordatoriosMasivos() {
    const mensaje = document.getElementById('mensaje-recordatorios');
    mensaje.innerText = '⏳ Buscando clientes morosos...';
    mensaje.className = 'mensaje';

    try {
        const res = await fetch(`${API_URL}/clientes`);
        if (!res.ok) throw new Error('Error cargando clientes');

        const clientes = await res.json();
        const hoy = new Date().toISOString().split('T')[0];
        let morosos = [];

        for (const cliente of clientes) {
            if (!cliente.telefono) continue;

            const prestamoRes = await fetch(`${API_URL}/prestamos/cliente/${cliente.id}`);
            if (!prestamoRes.ok) continue;

            const data = await prestamoRes.json();
            if (!data.cuotas) continue;

            const cuotasVencidas = data.cuotas.filter(c => !c.pagada && c.fecha_vencimiento < hoy);
            if (cuotasVencidas.length > 0) {
                const totalDeuda = cuotasVencidas.reduce((sum, c) => sum + c.saldo_pendiente, 0);
                morosos.push({
                    nombre: cliente.nombre,
                    telefono: cliente.telefono,
                    cuotas: cuotasVencidas.length,
                    deuda: totalDeuda
                });
            }
        }

        if (morosos.length === 0) {
            mensaje.innerText = '✅ No hay clientes morosos para notificar';
            mensaje.classList.add('exito');
            return;
        }

        // Generar links de WhatsApp para cada moroso
        const links = morosos.map(m => {
            const texto = encodeURIComponent(
                `Estimado(a) ${m.nombre}, le recordamos que tiene ${m.cuotas} cuota(s) pendiente(s) ` +
                `por un total de S/ ${m.deuda.toFixed(2)}. Por favor acérquese a regularizar su situación. ` +
                `Gracias - Capital Rise Loans`
            );
            return `https://wa.me/51${m.telefono}?text=${texto}`;
        });

        mensaje.innerHTML = `
            <p>📱 Se encontraron <strong>${morosos.length}</strong> clientes morosos:</p>
            <div style="max-height: 200px; overflow-y: auto; margin-top: 10px;">
                ${morosos.map((m, i) => `
                    <div style="padding: 8px; border-bottom: 1px solid var(--border);">
                        ${m.nombre} - S/ ${m.deuda.toFixed(2)} 
                        <a href="${links[i]}" target="_blank" class="btn-small" style="font-size: 0.8em;">Enviar</a>
                    </div>
                `).join('')}
            </div>
        `;
        mensaje.classList.add('exito');

    } catch (err) {
        console.error('Error:', err);
        mensaje.innerText = '❌ Error al procesar recordatorios';
        mensaje.classList.add('error');
    }
}

function enviarRecordatorioWhatsApp(telefono, nombre, cuota, monto) {
    const texto = encodeURIComponent(
        `Estimado(a) ${nombre}, le recordamos que su cuota #${cuota} por S/ ${monto.toFixed(2)} ` +
        `se encuentra pendiente de pago. Por favor acérquese a regularizar. Gracias - Capital Rise Loans`
    );
    window.open(`https://wa.me/51${telefono}?text=${texto}`, '_blank');
}

// ==================== ESTADO DE CUENTA PDF ====================
async function generarEstadoCuentaPDF(clienteId, clienteNombre, clienteDoc) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Obtener datos del préstamo
    const res = await fetch(`${API_URL}/prestamos/cliente/${clienteId}`);
    if (!res.ok) {
        mostrarToast('Error cargando datos del préstamo', 'error');
        return;
    }

    const data = await res.json();
    if (!data.prestamo || !data.cuotas) {
        mostrarToast('No hay préstamo activo para este cliente', 'warning');
        return;
    }

    const margen = 15;
    let y = 15;

    // Cabecera
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('CAPITAL RISE LOANS S.A.C.', 105, y, { align: 'center' });

    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    y += 7;
    doc.text('R.U.C. 20612345678 | Av. Javier Prado Este 4200, San Isidro', 105, y, { align: 'center' });

    y += 12;
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('ESTADO DE CUENTA', 105, y, { align: 'center' });

    // Datos del cliente
    y += 15;
    doc.setFontSize(10);
    doc.text('DATOS DEL CLIENTE', margen, y);
    doc.line(margen, y + 2, 195, y + 2);

    y += 10;
    doc.setFont(undefined, 'normal');
    doc.text(`Cliente: ${clienteNombre}`, margen, y);
    doc.text(`Documento: ${clienteDoc}`, 120, y);

    y += 7;
    doc.text(`Monto Préstamo: S/ ${data.prestamo.monto_total}`, margen, y);
    doc.text(`Cuotas: ${data.prestamo.cuotas}`, 120, y);

    y += 7;
    doc.text(`Fecha Emisión: ${new Date().toLocaleDateString('es-PE')}`, margen, y);

    // Tabla de cuotas
    y += 15;
    doc.setFont(undefined, 'bold');
    doc.text('CRONOGRAMA DE PAGOS', margen, y);
    doc.line(margen, y + 2, 195, y + 2);

    y += 10;
    // Cabecera de tabla
    doc.setFillColor(26, 54, 93);
    doc.rect(margen, y - 5, 180, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.text('N°', margen + 5, y);
    doc.text('VENCIMIENTO', margen + 20, y);
    doc.text('MONTO', margen + 60, y);
    doc.text('PAGADO', margen + 95, y);
    doc.text('SALDO', margen + 130, y);
    doc.text('ESTADO', margen + 160, y);

    doc.setTextColor(0, 0, 0);
    y += 8;

    const hoy = new Date().toISOString().split('T')[0];
    let totalPagado = 0;
    let totalPendiente = 0;

    data.cuotas.forEach((cuota, index) => {
        const vencida = cuota.fecha_vencimiento < hoy && !cuota.pagada;
        const estado = cuota.pagada ? 'PAGADA' : (vencida ? 'VENCIDA' : 'PENDIENTE');

        if (cuota.pagada) {
            totalPagado += cuota.monto_cuota;
        } else {
            totalPendiente += cuota.saldo_pendiente;
        }

        if (vencida) {
            doc.setFillColor(255, 230, 230);
            doc.rect(margen, y - 4, 180, 7, 'F');
        } else if (index % 2 === 0) {
            doc.setFillColor(245, 247, 250);
            doc.rect(margen, y - 4, 180, 7, 'F');
        }

        doc.setFontSize(8);
        doc.text(String(cuota.numero_cuota), margen + 5, y);
        doc.text(cuota.fecha_vencimiento, margen + 20, y);
        doc.text(`S/ ${cuota.monto_cuota.toFixed(2)}`, margen + 60, y);
        doc.text(`S/ ${(cuota.monto_cuota - cuota.saldo_pendiente).toFixed(2)}`, margen + 95, y);
        doc.text(`S/ ${cuota.saldo_pendiente.toFixed(2)}`, margen + 130, y);
        doc.text(estado, margen + 160, y);

        y += 7;
    });

    // Totales
    y += 5;
    doc.setFont(undefined, 'bold');
    doc.setFontSize(10);
    doc.line(margen, y, 195, y);
    y += 8;
    doc.text(`Total Pagado: S/ ${totalPagado.toFixed(2)}`, margen, y);
    doc.text(`Total Pendiente: S/ ${totalPendiente.toFixed(2)}`, 120, y);

    // Pie de página
    y += 20;
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.text(`Generado el ${new Date().toLocaleString('es-PE')} - Sistema AGILE`, 105, y, { align: 'center' });

    // Guardar
    const nombreArchivo = `EstadoCuenta_${clienteDoc}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(nombreArchivo);
    mostrarToast('Estado de cuenta generado', 'success');
}

// Actualizar mostrarSeccion para incluir calendario
const originalMostrarSeccion = mostrarSeccion;
mostrarSeccion = function (id) {
    // Llamar a la función original (definida antes)
    const secciones = document.querySelectorAll('.seccion');
    secciones.forEach(s => s.style.display = 'none');

    const seccion = document.getElementById(`seccion-${id}`);
    if (seccion) seccion.style.display = 'block';

    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(b => b.classList.remove('active'));
    navItems.forEach(btn => {
        if (btn.onclick && btn.onclick.toString().includes(`'${id}'`)) {
            btn.classList.add('active');
        }
    });

    const titles = {
        'dashboard': 'Dashboard',
        'clientes': 'Gestión de Clientes',
        'prestamos': 'Gestión de Préstamos',
        'pagos': 'Cobranza',
        'caja': 'Control de Caja',
        'calendario': 'Calendario de Vencimientos',
        'empleados': 'Gestión de Empleados',
        'config': 'Configuración'
    };
    const pageTitle = document.getElementById('page-title');
    if (pageTitle) pageTitle.innerText = titles[id] || id;

    const headerDate = document.getElementById('header-date');
    if (headerDate) {
        const hoy = new Date();
        headerDate.innerText = hoy.toLocaleDateString('es-PE', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
    }

    if (id === 'dashboard') cargarDashboard();
    if (id === 'clientes') cargarClientes();
    if (id === 'calendario') cargarCalendario();
    if (id === 'empleados') cargarEmpleados();
    if (id === 'config') cargarConfiguracion();
};

// API URL - funciona tanto en local como en producción
// Si estamos en localhost o abriendo como archivo, usamos localhost:4000
// Si estamos en producción (Render), usamos URL relativa (vacía)
const API_URL = 'https://agile-prestamos-nn7p.onrender.com';

// ==================== SISTEMA DE LOGIN ====================
// Variables globales de sistema (Fecha simulada)
let FECHA_SISTEMA_OFFSET = 0; // Diferencia en ms respecto a la fecha real
let FECHA_SISTEMA_CACHED = null; // String YYYY-MM-DD para input

function obtenerFechaHoy() {
    return new Date(Date.now() + FECHA_SISTEMA_OFFSET);
}

// Validar sesión al cargar la página
document.addEventListener('DOMContentLoaded', function () {
    // 1. Cargar fecha del sistema antes de nada
    cargarFechaSistema().then(() => {
        verificarSesion();

        // Actualizar header con la fecha del sistema (si hay sesión)
        // Se actualizará también en 'mostrarSeccion'
    });

    // Detectar callback de Flow
    const urlParams = new URLSearchParams(window.location.search);
    const pagoStatus = urlParams.get('pago');
    const token = urlParams.get('token');

    if (pagoStatus === 'flow' && token) {
        // Verificar el estado REAL del pago en el backend
        // (Por si el webhook falló, cosa común en localhost)
        mostrarToast('🔄 Verificando pago con el banco...', 'info');

        fetch(`${API_URL}/flow/verificar-pago`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        })
            .then(res => res.json())
            .then(data => {
                if (data.success || data.pagada) {
                    mostrarToast('✅ Pago confirmado y registrado correctamente.', 'success');

                    // Recargar la vista de cobros automáticamente
                    if (document.getElementById('seccion-pagos').style.display !== 'none') {
                        // Si estamos en la vista de pagos, recargar la búsqueda del cliente actual
                        // Usamos un pequeño timeout para asegurar que el backend haya procesado todo
                        setTimeout(() => {
                            if (document.getElementById('buscar-pago-doc').value) {
                                buscarClienteParaPago();
                            }
                        }, 1000);
                    }
                } else {
                    mostrarToast('⚠️ El pago no se pudo verificar completamente. Revise el estado.', 'warning');
                    console.error("Resultado verificación:", data);
                }
                // Limpiar URL
                window.history.replaceState({}, document.title, window.location.pathname);
            })
            .catch(err => {
                console.error("Error verificando pago al retornar:", err);
                mostrarToast('❌ Error de conexión al verificar pago.', 'error');
            });

    } else if (pagoStatus === 'fallido') {
        setTimeout(() => {
            mostrarToast('❌ El pago no pudo ser procesado. Intente nuevamente.', 'error');
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

    // Cargar clientes como sección inicial
    mostrarSeccion('clientes');
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

    // Actualizar fecha en header - SOLO VISIBLE EN CONFIGURACIÓN
    const headerDate = document.getElementById('header-date');
    if (headerDate) {
        if (id === 'config') {
            headerDate.style.display = 'block';
            const hoy = obtenerFechaHoy();
            headerDate.innerText = hoy.toLocaleDateString('es-PE', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });
        } else {
            headerDate.style.display = 'none';
        }
    }

    // Cargar datos si es necesario
    // if (id === 'dashboard') cargarDashboard();
    if (id === 'clientes') cargarClientes();
    // if (id === 'empleados') cargarEmpleados(); // Eliminado
    if (id === 'config') cargarConfiguracion();
}

function mostrarCaja() {
    mostrarSeccion('caja');
    cargarEstadoCaja();
    cargarHistorialCaja(); // Cargar historial de movimientos
}

// ==================== MÓDULO DASHBOARD (ELIMINADO) ====================
// Las funciones cargarDashboard y cargarCuotasVencidas han sido eliminadas.

// ==================== MÓDULO CLIENTES ====================
let filtroMorososActivo = false;
let clienteEnEdicionId = null;

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
            const hoy = obtenerFechaHoy().toISOString().split('T')[0];

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
                            const diff = Math.ceil((obtenerFechaHoy() - fechaVenc) / (1000 * 60 * 60 * 24));
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

            // Escapar comillas para el JSON en el onclick
            const clienteStr = JSON.stringify(c).replace(/"/g, '&quot;');

            // Definir badge de condición (Natural vs Jurídica)
            const condText = c.es_juridica ? 'Jurídica' : 'Natural';
            const condColor = c.es_juridica ? '#8e44ad' : '#27ae60'; // Morado para Jurídica, Verde para Natural
            const condBadge = `<span style="font-size:0.8em; padding:3px 8px; background:${condColor}; color:white; border-radius:10px;">${condText}</span>`;

            row.innerHTML = `
                <td><strong>${c.documento}</strong></td>
                <td>
                    ${c.nombre}
                    ${extraInfo}
                </td>
                <td><span style="font-size:0.8em; padding:3px 8px; background:#eee; border-radius:10px;">${c.tipo}</span></td>
                <td>${condBadge}</td>
                <td>
                    <button class="btn-small" onclick="verDetalleCliente(${clienteStr})" style="background: #3498db; margin-right: 5px;">👁️ Ver</button>
                    <button class="btn-small" onclick="prepararEdicionCliente(${clienteStr})" style="background: #f39c12; margin-right: 5px;">✏️ Editar</button>
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

function toggleJuridica() {
    const check = document.getElementById('check-juridica');
    const seccion = document.getElementById('seccion-juridica');
    if (check && seccion) {
        seccion.style.display = check.checked ? 'block' : 'none';
        if (!check.checked) {
            document.getElementById('archivo-dj').value = ''; // Limpiar archivo al desmarcar
        }
    }
}

function limpiarFormularioCliente() {
    clienteEnEdicionId = null; // Resetear edición
    document.getElementById('tipo').value = 'DNI';
    document.getElementById('tipo').disabled = false; // Habilitar
    document.getElementById('documento').value = '';
    document.getElementById('documento').disabled = false; // Habilitar
    document.getElementById('nombre').value = '';
    document.getElementById('direccion').value = '';
    document.getElementById('telefono').value = '';
    document.getElementById('email').value = '';

    // Resetear Juridica
    const checkJuridica = document.getElementById('check-juridica');
    if (checkJuridica) {
        checkJuridica.checked = false;
        checkJuridica.disabled = false;
        toggleJuridica();
    }
    const archivoDj = document.getElementById('archivo-dj');
    if (archivoDj) archivoDj.value = '';

    document.getElementById('doc-validacion').innerText = '';
    document.getElementById('doc-mensaje').innerText = 'DNI debe tener exactamente 8 dígitos.';
    document.getElementById('mensaje').innerText = '';
    document.getElementById('mensaje').className = 'mensaje';

    // Restaurar botones
    const btnGuardar = document.querySelector('button[onclick="crearCliente()"]');
    if (btnGuardar) btnGuardar.innerText = '💾 Registrar Cliente';

    const cardHeader = document.querySelector('#seccion-clientes .card-header h3');
    if (cardHeader) cardHeader.innerText = '➕ Registrar Nuevo Cliente';

    actualizarMaxLengthDocumento();
}

function prepararEdicionCliente(cliente) {
    clienteEnEdicionId = cliente.id;

    // Llenar campos
    document.getElementById('tipo').value = cliente.tipo;
    document.getElementById('tipo').disabled = true; // No editar tipo

    document.getElementById('documento').value = cliente.documento;
    document.getElementById('documento').disabled = true; // No editar documento (clave)

    document.getElementById('nombre').value = cliente.nombre;
    document.getElementById('direccion').value = cliente.direccion || '';
    document.getElementById('telefono').value = cliente.telefono || '';
    document.getElementById('telefono').value = cliente.telefono || '';
    document.getElementById('email').value = cliente.email || '';

    // Juridica Update
    const checkJuridica = document.getElementById('check-juridica');
    if (checkJuridica) {
        // En backend guardamos string o boolean, asegurarnos
        checkJuridica.checked = (cliente.es_juridica === true || cliente.es_juridica === 'true');
        checkJuridica.disabled = true; // No permitir cambiar régimen al editar (opcional)
        toggleJuridica();
    }
    // No llenamos el input file, no se puede.

    // UI Updates
    document.getElementById('doc-mensaje').innerText = 'Editando cliente...';
    document.getElementById('doc-validacion').innerText = '✏️';

    const btnGuardar = document.querySelector('button[onclick="crearCliente()"]');
    if (btnGuardar) btnGuardar.innerText = '💾 Actualizar Cliente';

    const cardHeader = document.querySelector('#seccion-clientes .card-header h3');
    if (cardHeader) cardHeader.innerText = '✏️ Editar Cliente';

    // Scroll al formulario
    document.querySelector('#seccion-clientes .card').scrollIntoView({ behavior: 'smooth' });
    mostrarToast('Modo edición activado', 'info');
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
    // Solo validar longitud si NO estamos editando (porque al editar, el campo está deshabilitado y puede que no dispare oninput)
    if (!clienteEnEdicionId) {
        if (tipo === 'DNI' && documento.length !== 8) errores.push('DNI debe tener 8 dígitos');
        if (tipo === 'RUC' && documento.length !== 11) errores.push('RUC debe tener 11 dígitos');
    }

    if (!nombre) errores.push('Nombre completo');
    if (!direccion) errores.push('Dirección');
    if (!telefono) errores.push('Teléfono/WhatsApp');
    // if (telefono && telefono.length !== 9) errores.push('Teléfono debe tener 9 dígitos'); // A veces ponen espacios
    if (email && !email.includes('@')) errores.push('Email inválido');

    if (errores.length > 0) {
        mostrarToast(`Campos faltantes o inválidos: ${errores.join(', ')}`, 'warning');
        mensajeDiv.innerText = `❌ Complete los campos obligatorios: ${errores.join(', ')}`;
        mensajeDiv.classList.add('error');
        return;
    }

    mensajeDiv.innerText = clienteEnEdicionId ? '⏳ Actualizando cliente...' : '⏳ Guardando cliente...';

    // Capturar nuevos campos
    const esJuridica = document.getElementById('check-juridica').checked;
    const archivoDj = document.getElementById('archivo-dj').files[0];

    if (esJuridica && !archivoDj && !clienteEnEdicionId) {
        // En edición podría ya tener uno, pero en creación es obligatorio si está marcado
        mostrarToast('Debe subir la Declaración Jurada', 'warning');
        mensajeDiv.innerText = '❌ Falta Declaración Jurada';
        mensajeDiv.classList.add('error');
        return;
    }

    try {
        let url = `${API_URL}/clientes`;
        let method = 'POST';

        if (clienteEnEdicionId) {
            url = `${API_URL}/clientes/${clienteEnEdicionId}`;
            method = 'PUT';
        }

        // Usar FormData para enviar archivo y datos
        const formData = new FormData();
        formData.append('tipo', tipo);
        formData.append('documento', documento);
        formData.append('nombre', nombre);
        formData.append('direccion', direccion);
        formData.append('telefono', telefono);
        formData.append('email', email);
        formData.append('es_juridica', esJuridica);

        if (archivoDj) {
            formData.append('declaracion_jurada', archivoDj);
        }

        // fetch detectará FormData y pondrá el Content-Type multipart/form-data automáticamente
        // NO poner 'Content-Type': 'application/json'
        const res = await fetch(url, {
            method: method,
            body: formData
        });

        const data = await res.json();

        if (res.ok) {
            const msgExito = clienteEnEdicionId ? 'Cliente actualizado exitosamente' : 'Cliente registrado exitosamente';
            mensajeDiv.innerText = `✅ ¡${msgExito}!`;
            mensajeDiv.classList.add('exito');
            mostrarToast(`${nombre} guardado correctamente`, 'success');
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

// ==================== DETALLE DE CLIENTE (MODAL) ====================
function verDetalleCliente(c) {
    const contenido = document.getElementById('detalle-cliente-contenido');

    // Formatear fecha
    const fechaRegistro = c.creado_en ? new Date(c.creado_en).toLocaleString('es-PE') : 'No registrada';

    let html = `
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            <p style="margin: 8px 0;"><strong>Documento:</strong> ${c.tipo} ${c.documento}</p>
            <p style="margin: 8px 0;"><strong>Nombre/Razón Social:</strong> ${c.nombre}</p>
        </div>
        
        <p><strong>📍 Dirección:</strong> ${c.direccion || 'No especificada'}</p>
        <p><strong>📱 Teléfono/WhatsApp:</strong> ${c.telefono || 'No especificado'}</p>
        <p><strong>📧 Correo Electrónico:</strong> ${c.email || 'No especificado'}</p>
        
        <hr style="margin: 20px 0; border: 0; border-top: 1px solid #eee;">
        
        <p><small style="color: #7f8c8d;">📅 Cliente registrado el: ${fechaRegistro}</small></p>
    `;

    // Si tiene datos de mora calculados en el filtro
    if (c.moraTotal > 0) {
        html += `
            <div style="margin-top: 15px; padding: 10px; background: #fff3e0; border-left: 4px solid #e67e22; border-radius: 4px;">
                <p style="margin: 0; color: #d35400;">⚠️ <strong>Mora Acumulada:</strong> S/ ${c.moraTotal.toFixed(2)}</p>
                <p style="margin: 5px 0 0 0; font-size: 0.9em;">(${c.diasAtraso} días de atraso máximo)</p>
            </div>
        `;
    }

    contenido.innerHTML = html;
    document.getElementById('modal-detalle-cliente').style.display = 'flex';
}

function cerrarModalCliente() {
    document.getElementById('modal-detalle-cliente').style.display = 'none';
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
        'clientes': 'Clientes',
        'prestamos': 'Préstamos',
        'pagos': 'Cobranza',
        'caja': 'Control de Caja',
        'empleados': 'Empleados',
        'config': 'Configuración del Sistema'
    };
    const pageTitle = document.getElementById('page-title');
    if (pageTitle) pageTitle.innerText = titulos[seccionId] || 'Agile Préstamos';

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
        case 'clientes':
            cargarClientes();
            break;
        case 'caja':
            cargarEstadoCaja();
            break;
        // case 'empleados': cargarEmpleados(); break; // Eliminado
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

        // Setear fecha hoy por defecto
        const hoy = new Date().toISOString().split('T')[0];
        document.getElementById('fecha-inicio-prestamo').value = hoy;

    } catch (error) {
        console.error(error);
        mensajeDiv.innerText = '❌ Error conectando con el servidor';
        mensajeDiv.classList.add('error');
    }
}


function setFechaHoyPrestamo() {
    const hoy = new Date().toISOString().split('T')[0];
    document.getElementById('fecha-inicio-prestamo').value = hoy;
}

async function crearPrestamo() {
    if (!clienteSeleccionado) {
        mostrarToast('Primero busque un cliente', 'warning');
        return;
    }

    const monto = parseFloat(document.getElementById('monto-capital').value);
    const cuotas = parseInt(document.getElementById('num-cuotas').value);
    const tea = parseFloat(document.getElementById('tea-prestamo').value);
    const fechaInicio = document.getElementById('fecha-inicio-prestamo').value;
    const mensajeDiv = document.getElementById('mensaje-prestamo');

    mensajeDiv.className = 'mensaje';
    mensajeDiv.innerText = '';

    if (!monto || !cuotas || isNaN(tea)) {
        mostrarToast('Complete todos los campos (Capital, Cuotas, TEA)', 'warning');
        return;
    }

    if (!fechaInicio) {
        mostrarToast('Seleccione una fecha de inicio', 'warning');
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
                monto_capital: monto,
                tea: tea,
                num_cuotas: cuotas,
                fecha_inicio: fechaInicio
            })
        });

        const data = await res.json();

        if (res.ok) {
            mensajeDiv.innerText = `✅ Préstamo creado exitosamente. ID: ${data.prestamo_id}`;
            mensajeDiv.classList.add('exito');

            // Limpiar formulario
            document.getElementById('monto-capital').value = '';
            document.getElementById('tea-prestamo').value = '';
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

            const hoy = obtenerFechaHoy().toISOString().split('T')[0];

            // Variable para rastrear el saldo de capital (Principal) inicial del periodo
            let saldoCapitalTracker = parseFloat(prestamo.monto_capital);

            cuotas.forEach(cuota => {
                const vencida = cuota.fecha_vencimiento < hoy && !cuota.pagada;

                let diasAtraso = 0;
                if (vencida) {
                    const fechaVenc = new Date(cuota.fecha_vencimiento);
                    const hoyDate = obtenerFechaHoy(); // Usar fecha sistema para cálculo días
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

                // Cálculos financieros para visualización (Amortización/Interés)
                let interes = cuota.interes_calculado;
                let amortizacion = cuota.amortizacion_capital;
                const cuotaTotal = parseFloat(cuota.monto_cuota);

                // Si no existen (datos antiguos), calcular al vuelo
                if (interes === undefined || amortizacion === undefined) {
                    const teaDecimal = parseFloat(prestamo.tea) / 100;
                    const temDecimal = Math.pow(1 + teaDecimal, 1 / 12) - 1;
                    interes = saldoCapitalTracker * temDecimal;
                    amortizacion = cuotaTotal - interes;
                } else {
                    // Asegurar que sean números
                    interes = parseFloat(interes);
                    amortizacion = parseFloat(amortizacion);
                }

                // Saldo Capital antes de pagar esta cuota (Saldo Inicial del Periodo)
                const saldoCapitalMostrar = saldoCapitalTracker;

                // Actualizar tracker para la siguiente cuota (Saldo Capital Restante / Final del Periodo)
                if (cuota.saldo_capital_restante !== undefined) {
                    saldoCapitalTracker = parseFloat(cuota.saldo_capital_restante);
                } else {
                    saldoCapitalTracker -= amortizacion;
                    if (saldoCapitalTracker < 0) saldoCapitalTracker = 0;
                }

                const row = document.createElement('tr');
                if (vencida) {
                    row.className = 'cuota-vencida';
                }

                row.innerHTML = `
                    <td>${cuota.numero_cuota}</td>
                    <td>${cuota.fecha_vencimiento}</td>
                    <td>S/ ${saldoCapitalMostrar.toFixed(2)}</td>
                    <td>S/ ${amortizacion.toFixed(2)}</td>
                    <td>S/ ${interes.toFixed(2)}</td>
                    <td>S/ ${cuotaTotal.toFixed(2)}</td>
                    <td>S/ ${parseFloat(cuota.saldo_pendiente).toFixed(2)}</td>
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

async function buscarClienteParaPago(preserveMessage = false) {
    const busqueda = document.getElementById('buscar-pago-doc').value.trim();
    const mensajeDiv = document.getElementById('mensaje-pago');

    if (!preserveMessage) {
        mensajeDiv.className = 'mensaje';
        mensajeDiv.innerText = '';
    }

    if (!busqueda) {
        // Solo mostrar alerta si es búsqueda manual
        if (!preserveMessage) mostrarToast('Ingrese un número de documento o nombre', 'warning');
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
        const saldoRestante = data.prestamo.saldo_restante !== undefined
            ? Number(data.prestamo.saldo_restante)
            : data.cuotas.reduce((s, c) => s + Number(c.saldo_pendiente || 0), 0);
        const estadoPrestamo = saldoRestante > 0.5
            ? `Pendiente - Falta pagar: S/ ${saldoRestante.toFixed(2)}`
            : 'Pagado';
        document.getElementById('pago-estado-prestamo').innerText = estadoPrestamo;
        document.getElementById('pago-saldo-restante').innerText = saldoRestante.toFixed(2);

        const panelHistorial = document.getElementById('panel-estado-prestamo');
        const listaPagosDiv = document.getElementById('lista-pagos-prestamo');
        if (data.pagos && data.pagos.length > 0) {
            panelHistorial.style.display = 'block';
            const ultimos = data.pagos.slice(0, 5);
            listaPagosDiv.innerHTML = ultimos.map(p => `
                <div style="padding:6px 0; border-bottom:1px dashed #eee;">
                    <div><strong>${new Date(p.fecha_pago || p.fecha).toLocaleDateString()}</strong> - S/ ${Number(p.monto_pagado || p.monto || 0).toFixed(2)}</div>
                    <div style="font-size:0.85em; color:#555;">${p.medio_pago || p.medio || 'N/A'} ${p.flow_order ? `(Flow ${p.flow_order})` : ''}</div>
                </div>
            `).join('');
        } else {
            panelHistorial.style.display = 'block';
            listaPagosDiv.innerHTML = '<em>Sin pagos registrados</em>';
        }


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
        if (!preserveMessage) {
            mensajeDiv.innerText = '❌ Error de conexión';
            mensajeDiv.classList.add('error');
        } else {
            console.warn("Error refrescando datos en background:", error);
        }
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

    // VERIFICACIÓN DE CUOTAS ANTERIORES
    // Buscar si existe alguna cuota anterior con saldo pendiente
    const cuotaAnteriorPendiente = prestamoActivo.cuotas.find(c =>
        c.numero_cuota < cuotaSeleccionada.numero_cuota &&
        c.saldo_pendiente > 0.1 // Usamos 0.1 para evitar problemas de decimales insignificantes
    );

    if (cuotaAnteriorPendiente) {
        mostrarToast(`⚠️ Debe pagar primero la Cuota ${cuotaAnteriorPendiente.numero_cuota} antes de proceder.`, 'warning');

        // Resetear selección
        selectCuota.value = "";
        document.getElementById('detalle-cuota').style.display = 'none';
        cuotaSeleccionada = null;
        return;
    }

    // Calcular mora si está vencida
    // Calcular mora si está vencida
    const hoy = new Date().toISOString().split('T')[0];
    const vencida = cuotaSeleccionada.fecha_vencimiento < hoy && !cuotaSeleccionada.pagada;

    // Calcular días de atraso
    let diasAtraso = 0;
    if (vencida) {
        const fechaVenc = new Date(cuotaSeleccionada.fecha_vencimiento);
        const hoyDate = new Date(hoy);
        diasAtraso = Math.floor((hoyDate - fechaVenc) / (1000 * 60 * 60 * 24));
    }

    // REGLA: Interés compuesto 1% mensual
    // Mes 1: Saldo * 1.01
    // Mes 2: (Saldo * 1.01) * 1.01, etc.
    const mesesAtraso = Math.max(1, Math.ceil(diasAtraso / 30));

    // EXCEPCIÓN: Si ya hubo un pago parcial (saldo < monto_original), NO se cobra mora.
    const huboPagoParcial = (cuotaSeleccionada.monto_cuota - cuotaSeleccionada.saldo_pendiente) > 0.1;

    let mora = 0;
    if (vencida && !huboPagoParcial) {
        const totalConMora = cuotaSeleccionada.saldo_pendiente * Math.pow(1.01, mesesAtraso);
        mora = (totalConMora - cuotaSeleccionada.saldo_pendiente).toFixed(2);
    }

    const totalDebido = (parseFloat(cuotaSeleccionada.saldo_pendiente) + parseFloat(mora)).toFixed(2);

    // DESGLOSE VISUAL MEJORADO
    document.getElementById('cuota-monto-capital').innerText = parseFloat(cuotaSeleccionada.monto_cuota).toFixed(2);
    document.getElementById('cuota-saldo').innerText = parseFloat(cuotaSeleccionada.saldo_pendiente).toFixed(2);
    document.getElementById('cuota-vencimiento').innerText = cuotaSeleccionada.fecha_vencimiento;
    document.getElementById('cuota-total-pagar').innerText = totalDebido;

    // Mostrar/ocultar mora
    const lineaMora = document.getElementById('linea-mora');
    if (vencida) {
        if (mora > 0) {
            lineaMora.style.display = 'flex';
            document.getElementById('cuota-mora-monto').innerHTML = `S/ ${mora} <small>(${mesesAtraso} meses)</small>`;

            // Actualizar etiqueta del div linea-mora
            lineaMora.querySelector('span:first-child').innerHTML = `<strong>⚠️ Mora Acumulada:</strong>`;

            document.getElementById('cuota-dias-atraso').innerHTML =
                `<span style="color: #e74c3c;">🔴 VENCIDA - ${diasAtraso} días de atraso (${mesesAtraso} meses mora)</span>`;
        } else {
            lineaMora.style.display = 'none';
            document.getElementById('cuota-dias-atraso').innerHTML =
                `<span style="color: #f39c12;">🟠 VENCIDA - ${diasAtraso} días de atraso (Mora exonerada por pago parcial)</span>`;
        }
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

// FUNCIÓN NUEVA CALCULAR VUELTO
function calcularVueltoUI() {
    const montoInput = document.getElementById('monto-pagar');
    const entregadoInput = document.getElementById('monto-efectivo-entregado');
    const textoVuelto = document.getElementById('texto-vuelto');

    // Recuperamos montoCobrar (con redondeo si aplica)
    const montoBase = parseFloat(montoInput.value) || 0;
    // Si es efectivo, aplicamos redondeo visualmente también
    const redondeado = Math.round(montoBase * 10) / 10;

    const entregado = parseFloat(entregadoInput.value) || 0;

    const vuelto = entregado - redondeado;

    if (vuelto >= 0) {
        textoVuelto.innerText = `S/ ${vuelto.toFixed(2)}`;
        textoVuelto.style.color = '#2e7d32';
    } else {
        textoVuelto.innerText = `Falta S/ ${Math.abs(vuelto).toFixed(2)}`;
        textoVuelto.style.color = '#e74c3c';
    }
}

// FUNCIÓN PARA ACTUALIZAR REDONDEO Y VISIBILIDAD EFECTIVO
function actualizarRedondeo() {
    const medioPago = document.getElementById('medio-pago').value;
    const montoInput = document.getElementById('monto-pagar');
    const mensajeRedondeo = document.getElementById('mensaje-redondeo');
    const seccionEfectivo = document.getElementById('seccion-pago-efectivo');

    if (!montoInput.value) return;

    const monto = parseFloat(montoInput.value);

    if (medioPago === 'EFECTIVO') {
        seccionEfectivo.style.display = 'block'; // MOSTRAR INPUT EFECTIVO

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

        // Recalcular vuelto por si ya había numeros
        calcularVueltoUI();

    } else {
        seccionEfectivo.style.display = 'none'; // OCULTAR
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

    // Lógica diferenciada por Medio de Pago
    if (medioPago === 'FLOW') {
        try {
            const flowRes = await fetch(`${API_URL}/flow/crear-pago`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cuota_id: cuotaSeleccionada.id,
                    monto: montoPagar, // Se envía monto EXACTO
                    cliente_nombre: prestamoActivo.prestamo.cliente_nombre,
                    cliente_email: prestamoActivo.prestamo.cliente_email || 'cliente@example.com'
                })
            });

            const flowData = await flowRes.json();

            if (flowRes.ok && flowData.success) {
                mensajeDiv.innerHTML = `
                    <p style="color: #27ae60; font-weight: bold;">✅ ${flowData.mensaje}</p>
                    <p style="font-size: 0.9em; margin-top:5px;">El enlace también está disponible aquí: 
                    <a href="${flowData.link}" target="_blank" style="color: #3498db;">Abrir enlace manualmente</a></p>
                    <div style="margin-top:15px; padding:10px; background:#f9f9f9; border:1px solid #ddd; border-radius:6px;">
                        <p><strong>⏳ Esperando confirmación del cliente...</strong></p>
                        <div class="loader" style="margin: 10px auto; border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; width: 20px; height: 20px; animation: spin 1s linear infinite;"></div>
                        <p style="font-size: 0.8em; color: #7f8c8d;">La pantalla se actualizará automáticamente cuando se detecte el pago.</p>
                    </div>
                    <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
                `;

                // INICIAR POLLING: Verificar estado cada 5 segundos
                const cuotaIdPolling = cuotaSeleccionada.id;
                const pollingInterval = setInterval(async () => {
                    if (!document.getElementById('detalle-cuota').style.display === 'none') {
                        clearInterval(pollingInterval); // Detener si el usuario cierra
                        return;
                    }

                    try {
                        const resPoll = await fetch(`${API_URL}/prestamos/cliente/${prestamoActivo.prestamo.cliente_id}`);
                        if (resPoll.ok) {
                            const dataPoll = await resPoll.json();
                            const cuotaPagada = dataPoll.cuotas.find(c => c.id === cuotaIdPolling && c.pagada === true);

                            if (cuotaPagada) {
                                clearInterval(pollingInterval);
                                mensajeDiv.innerHTML = `
                                    <div style="color: #27ae60; font-weight: bold; text-align: center;">
                                        <p style="font-size: 1.5em;">🎉 ¡PAGO CONFIRMADO!</p>
                                        <p>El cliente ha realizado el pago exitosamente.</p>
                                    </div>
                                `;
                                mostrarToast('Pago digital recibido correctamente', 'success');
                                await buscarClienteParaPago(true);
                                if (document.getElementById('estado-cuenta-card').style.display === 'block') {
                                    verEstadoCuenta();
                                }
                                document.getElementById('monto-pagar').value = '';
                                document.getElementById('detalle-cuota').style.display = 'none';
                            }
                        }
                    } catch (e) { console.error("Error polling pago:", e); }
                }, 5000);

            } else if (flowRes.ok && flowData.url) {
                // Fallback
                mensajeDiv.innerHTML = `
                    <p>🔄 Redirigiendo a Flow...</p>
                    <p style="font-size: 0.9em; color: #666;">Si no se abre automáticamente, 
                    <a href="${flowData.url}" target="_blank" style="color: #3498db;">haz clic aquí</a></p>
                `;
                window.open(flowData.url, '_blank');
            } else if (flowData.requiereVerificacion) {
                mensajeDiv.innerHTML = `
                    <p style="color: #e67e22;">⚠️ ${flowData.error}</p>
                    <button class="btn-primary" style="margin-top:10px; background:#f39c12;" 
                        onclick="sincronizarCuota('${flowData.cuota_id}')">
                        🔁 Sincronizar ahora
                    </button>
                `;
            } else {
                mensajeDiv.innerText = `❌ Error con Flow: ${flowData.error || 'Intente nuevamente'}`;
                mensajeDiv.classList.add('error');
            }
        } catch (err) {
            console.error('Error Flow:', err);
            mensajeDiv.innerText = '❌ Error conectando con Flow';
            mensajeDiv.classList.add('error');
        }

    } else {
        // PAGO EN EFECTIVO
        const entregadoInput = document.getElementById('monto-efectivo-entregado');
        const entregado = parseFloat(entregadoInput.value);

        // Validación frontend básica (backend también valida)
        const redondeado = Math.round(montoPagar * 10) / 10;
        if (!entregado || entregado < redondeado) {
            mensajeDiv.innerText = `⚠️ El monto entregado debe ser mayor o igual al total a pagar (S/ ${redondeado.toFixed(2)})`;
            mensajeDiv.classList.add('warning');
            mostrarToast('Revise el monto entregado', 'warning');
            return;
        }

        try {
            const res = await fetch(`${API_URL}/pagos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cuota_id: cuotaSeleccionada.id,
                    monto_pagado: montoPagar,
                    medio_pago: 'EFECTIVO',
                    monto_efectivo_entregado: entregado
                })
            });

            const data = await res.json();

            if (res.ok) {
                const vueltoMsg = data.vuelto ? `Vuelto: S/ ${Number(data.vuelto).toFixed(2)}` : '';
                mensajeDiv.innerText = `✅ Pago registrado exitosamente. ${vueltoMsg}`;
                mensajeDiv.classList.add('exito');

                await buscarClienteParaPago(true);

                if (document.getElementById('estado-cuenta-card') && document.getElementById('estado-cuenta-card').style.display === 'block') {
                    verEstadoCuenta();
                }

                document.getElementById('monto-pagar').value = '';
                document.getElementById('monto-efectivo-entregado').value = ''; // Limpiar 
                document.getElementById('detalle-cuota').style.display = 'none';

                if (data.comprobante_url) {
                    window.open(data.comprobante_url, '_blank');
                } else {
                    mostrarToast('Boleta generada pero URL no disponible', 'info');
                }

            } else {
                if (data.error === 'INSUFICIENT_FUNDS_CAJA') {
                    if (confirm(`${data.message}\n\n¿Desea ir a CAJA e INYECTAR EFECTIVO ahora para poder dar vuelto?`)) {
                        mostrarInyeccionEfectivo();
                    }
                } else {
                    mensajeDiv.innerText = `❌ Error: ${data.error}`;
                    mensajeDiv.classList.add('error');
                }
            }
        } catch (error) {
            console.error(error);
            mensajeDiv.innerText = '❌ Error de conexión';
            mensajeDiv.classList.add('error');
        }
    }
}

async function mostrarInyeccionEfectivo() {
    mostrarSeccion('caja'); // Ir a caja

    // Pequeño delay para asegurar carga
    setTimeout(async () => {
        // Asegurar que se cargue la info
        await cargarEstadoCaja();
        await cargarHistorialCaja();

        const montoStr = prompt("💰 INYECCIÓN DE CAJA\n\nNo hay suficiente efectivo para el vuelto.\nIngrese el monto de sencillo a ingresar (S/):");
        if (!montoStr) return;

        const monto = parseFloat(montoStr);
        if (isNaN(monto) || monto <= 0) {
            alert("Monto inválido");
            return;
        }

        try {
            const res = await fetch(`${API_URL}/caja/movimiento`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tipo: 'ENTRADA',
                    monto: monto,
                    descripcion: 'INYECCIÓN DE FONDOS (Para Vuelto)'
                })
            });

            if (res.ok) {
                alert("✅ Efectivo inyectado correctamente.\nAhora el saldo debería ser suficiente.");
                cargarEstadoCaja();
                cargarHistorialCaja();
                // Opcional: regresar a pagos automáticamente?
                if (confirm("¿Desea volver a la pantalla de PAGOS para reintentar?")) {
                    mostrarSeccion('pagos');
                }
            } else {
                const data = await res.json();
                alert("❌ Error: " + data.error);
            }
        } catch (e) {
            alert("❌ Error de conexión");
        }
    }, 500);
}
// ==================== GENERACIÓN DE COMPROBANTE PDF ====================
async function sincronizarCuota(cuotaId) {
    if (!confirm('¿Deseas verificar si hay pagos pendientes en Flow para esta cuota?')) return;

    const mensajeDiv = document.getElementById('mensaje-pago');
    mensajeDiv.innerText = '⏳ Sincronizando con Flow...';
    mensajeDiv.className = 'mensaje';

    try {
        const res = await fetch(`${API_URL}/flow/sincronizar-cuota`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cuota_id: cuotaId })
        });

        const data = await res.json();

        if (data.success) {
            mensajeDiv.innerHTML = `
                <p style="color: #27ae60;">✅ ${data.mensaje}</p>
                <p>Nuevo saldo: S/ ${Number(data.nuevo_saldo).toFixed(2)}</p>
            `;
            mensajeDiv.className = 'mensaje exito';

            if (data.pagada || data.total_pagado > 0) {
                setTimeout(() => {
                    cargarDetallePrestamo(prestamoActivo.prestamo.id);
                    // Ocultar mensaje o limpiar campos
                }, 2000);
            }

        } else {
            mensajeDiv.innerText = `❌ ${data.mensaje}`;
            mensajeDiv.className = 'mensaje error';
        }
    } catch (err) {
        console.error('Error sincronizando:', err);
        mensajeDiv.innerText = '❌ Error de conexión';
        mensajeDiv.classList.add('error');
    }
}

function generarComprobantePDF(datoPago) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // ==================== CONFIGURACIÓN Y ESTILOS ====================
    const azul = '#0056b3';
    const cyan = '#00d2d3';
    const oscuro = '#2c3e50';
    const gris = '#555555';
    const grisClaro = '#dddddd';

    const margen = 15;
    let y = 15;

    // Helper para establecer fuente
    const setFont = (type = 'normal', size = 9, color = '#000000') => {
        doc.setFont('helvetica', type); // usar helvetica que es standard
        doc.setFontSize(size);
        doc.setTextColor(color);
    };

    // ==================== 1. LOGO (TEXTO) ====================
    // "agile" (Oscuro, Bold)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.setTextColor(oscuro);
    doc.text('agile', margen, y + 8);

    // "-prestamos" (Cyan, Bold) - Calculamos ancho de "agile" para pegar el texto
    const anchoAgile = doc.getTextWidth('agile');
    doc.setTextColor(cyan);
    doc.text('-prestamos', margen + anchoAgile, y + 8);

    // Detalles Empresa
    y += 18;
    setFont('normal', 7, gris);
    doc.text('AGILE PRESTAMOS S.A.C.', margen, y);
    doc.text('Av. Siempreviva 123, Of 402', margen, y + 4);
    doc.text('Trujillo, La Libertad', margen, y + 8);
    doc.text('contacto@agileprestamos.com', margen, y + 12);

    // ==================== 2. CAJA RUC (DERECHA) ====================
    // Rectángulo bordeado
    const boxX = 130;
    const boxY = 15;
    const boxW = 65;
    const boxH = 26;

    doc.setDrawColor(grisClaro);
    doc.setLineWidth(0.5);
    doc.roundedRect(boxX, boxY, boxW, boxH, 2, 2, 'S');

    // Contenido Caja
    setFont('bold', 9, '#000000');
    doc.text('R.U.C. 20609998877', boxX + (boxW / 2), boxY + 6, { align: 'center' });

    setFont('bold', 10, gris);
    doc.text('BOLETA ELECTRÓNICA', boxX + (boxW / 2), boxY + 14, { align: 'center' });

    // Serie y Correlativo
    const numDoc = datoPago.comprobante_id ? datoPago.comprobante_id.substring(0, 8).toUpperCase() : '00000001';
    const serie = 'B001';
    setFont('bold', 11, '#000000');
    doc.text(`${serie}-${numDoc}`, boxX + (boxW / 2), boxY + 22, { align: 'center' });

    // ==================== 3. SEPARADOR AZUL ====================
    y = 50;
    doc.setDrawColor(azul);
    doc.setLineWidth(1);
    doc.line(margen, y, 210 - margen, y);

    // ==================== 4. DATOS DEL CLIENTE ====================
    y += 10;

    // Barra lateral cyan
    doc.setDrawColor(cyan);
    doc.setLineWidth(1.5);
    doc.line(margen, y, margen, y + 25);

    const xCol1 = margen + 5;
    const xCol2 = 120;

    // Columna 1
    setFont('normal', 7, gris);
    doc.text('CLIENTE', xCol1, y);

    setFont('bold', 10, oscuro);
    doc.text((datoPago.cliente_nombre || 'CLIENTE GENERAL').toUpperCase(), xCol1, y + 5);

    setFont('normal', 7, gris);
    doc.text('DIRECCIÓN', xCol1, y + 12);

    setFont('normal', 9, '#000000');
    const direccion = datoPago.cliente_direccion || 'Inambari'; // Valor default de la foto
    doc.text(direccion, xCol1, y + 17);

    // Columna 2
    setFont('normal', 7, gris);
    doc.text('DOC. IDENTIDAD', xCol2, y);

    setFont('bold', 10, '#000000');
    doc.text(datoPago.cliente_doc || '-', xCol2, y + 5);

    setFont('normal', 7, gris);
    doc.text('FECHA DE EMISIÓN', xCol2, y + 12);

    setFont('normal', 10, '#000000');
    const fechaEmision = new Date().toLocaleDateString('es-PE');
    doc.text(fechaEmision, xCol2, y + 17);

    // ==================== 5. TABLA ITEMS ====================
    y += 35;

    // Headers
    setFont('bold', 7, gris);
    doc.text('CANT.', margen, y);
    doc.text('U.M.', margen + 15, y);
    doc.text('DESCRIPCIÓN', margen + 35, y);
    doc.text('V. UNITARIO', 170, y, { align: 'right' });
    doc.text('TOTAL', 195, y, { align: 'right' });

    // Línea separadora header
    y += 3;
    doc.setDrawColor(grisClaro);
    doc.setLineWidth(0.5);
    doc.line(margen, y, 210 - margen, y);

    // Fila Item
    y += 6;
    const total = parseFloat(datoPago.total).toFixed(2);

    setFont('normal', 8, '#000000');
    doc.text('1', margen, y);
    doc.text('ZZ', margen + 15, y);

    setFont('bold', 8, '#000000');
    doc.text(`CUOTA DE PRÉSTAMO N° ${datoPago.numero_cuota}`, margen + 35, y);

    // Detalle método pago
    y += 4;
    setFont('normal', 7, gris);
    const medioTexto = datoPago.medio_pago === 'FLOW' ? 'Flow (Pasarela Digital)' : datoPago.medio_pago;
    doc.text(`Pago efectuado vía ${medioTexto}`, margen + 35, y);

    // Valores numéricos (alineados a header anterior)
    // Como bajamos y para el detalle, subimos un poco para el numero si queremos alineado top o lo dejamos
    // Alineamos con la primera linea del item
    setFont('normal', 8, '#000000');
    doc.text(total, 170, y - 4, { align: 'right' });
    doc.text(total, 195, y - 4, { align: 'right' });

    // Línea final item
    y += 6;
    doc.line(margen, y, 210 - margen, y);

    // ==================== 6. TOTALES ====================
    y += 10;

    const xLabel = 140;
    const xValue = 195; // Alineado a derecha

    setFont('normal', 8, gris);
    doc.text('Op. Gravada:', xLabel, y);
    doc.text('S/ 0.00', xValue, y, { align: 'right' });

    y += 5;
    doc.text('Op. Exonerada:', xLabel, y);
    doc.text(`S/ ${total}`, xValue, y, { align: 'right' });

    y += 5;
    doc.text('I.G.V.:', xLabel, y);
    doc.text('S/ 0.00', xValue, y, { align: 'right' });

    // Línea separadora totales
    y += 4;
    doc.line(xLabel, y, 195, y);

    y += 6;
    setFont('bold', 10, azul);
    doc.text('IMPORTE TOTAL:', xLabel, y);
    doc.text(`S/ ${total}`, xValue, y, { align: 'right' });

    // ==================== 7. PIE DE PÁGINA Y LETRAS ====================
    // Monto en letras
    y += 20;
    setFont('normal', 8, '#000000');
    const montoEntero = Math.floor(parseFloat(total));
    const centavos = Math.round((parseFloat(total) - montoEntero) * 100);
    // Usamos la función auxiliar existente
    doc.text(`SON: ${numeroALetras(montoEntero)} CON ${centavos}/100 SOLES`, margen, y);


    // Footer
    const paginaAlto = 297;
    y = paginaAlto - 30;

    doc.setDrawColor(grisClaro);
    doc.line(margen, y, 210 - margen, y);
    y += 5;

    setFont('normal', 7, gris);
    doc.text('Representación Impresa de la Boleta de Venta Electrónica', 105, y, { align: 'center' });
    doc.text('Autorizado mediante Resolución de Intendencia N° 034-005-00123/SUNAT', 105, y + 4, { align: 'center' });
    doc.text('Gracias por su preferencia.', 105, y + 8, { align: 'center' });

    // Guardar
    const nombreArchivo = `${serie}-${numDoc}.pdf`;
    doc.save(nombreArchivo);
    console.log(`✅ ${nombreArchivo} generado con nuevo diseño.`);
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
            // 'resumen-inicial' AHORA MUESTRA EL FONDO RESTANTE (Inicial + Inyecciones - Vueltos - Retiros)
            document.getElementById('resumen-inicial').innerText = (data.fondo_caja || 0).toFixed(2);

            // 'resumen-efectivo' AHORA MUESTRA SOLO VENTAS (Pagos brutos de cuotas)
            document.getElementById('resumen-efectivo').innerText = (data.ventas_efectivo_neto || 0).toFixed(2);

            const totalFlow = (data.FLOW || 0);
            document.getElementById('resumen-flow').innerText = totalFlow.toFixed(2);

            // TOTAL DINERO EN CAJÓN (Físico: Inicial + Cobros Efectivo)
            const dineroEnCajon = data.saldo_teorico_cajon; // El backend ya lo manda sumado (Inicial + Efectivo)
            // document.getElementById('resumen-total-cajon').innerText = dineroEnCajon.toFixed(2); // No existe este ID en el HTML mostrado, quizás es un error previo?? 
            // Revisando HTML línea 600-640 no veo 'resumen-total-cajon', pero veo 'resumen-total-general'.

            // EL USUARIO PIDE: "total general sea total en efectivo: y ahi debe estar la suma de pagos en efectivo y el fondo inicial"
            // Por tanto, 'resumen-total-general' debe mostrar 'dineroEnCajon'.
            document.getElementById('resumen-total-general').innerText = dineroEnCajon.toFixed(2);

            // (Opcional) Podemos mostrar un total global sistema aparte si quisiéramos, pero el usuario pido esto específico.

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
    const montoRealInput = document.getElementById('monto-real-cierre');
    const montoReal = parseFloat(montoRealInput.value);
    const mensajeDiv = document.getElementById('mensaje-caja');

    mensajeDiv.className = 'mensaje';
    mensajeDiv.innerText = '';

    if (isNaN(montoReal) || montoReal < 0) {
        alert('Por favor, ingrese el dinero físico que contó en el cajón');
        return;
    }

    // VALIDACIÓN SIMPLE: Comparar con el TOTAL EN EFECTIVO visible en pantalla
    const totalEfectivoSistema = parseFloat(document.getElementById('resumen-total-general').innerText || '0');

    // Se pide: "el dinero recaudado debe ser igual al total en efectivo"
    if (Math.abs(montoReal - totalEfectivoSistema) > 0.01) {
        alert(`❌ El dinero contado (S/ ${montoReal.toFixed(2)}) NO COINCIDE con el Total en Efectivo del sistema (S/ ${totalEfectivoSistema.toFixed(2)}).\n\nVerifique su conteo antes de cerrar.`);
        return;
    }

    if (!confirm(`¿El monto contado es correcto (S/ ${montoReal.toFixed(2)})?\n\nAl cerrar caja se generará el reporte final.`)) {
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
            alert('✅ Caja Cerrada y Cuadrada Exitosamente.');

            mensajeDiv.innerText = '✅ Caja cerrada exitosamente.';
            mensajeDiv.classList.add('exito');

            document.getElementById('monto-real-cierre').value = '';
            cargarEstadoCaja();
            cargarHistorialCaja();

            // Ocultar sección caja abierta
            document.getElementById('caja-abierta').style.display = 'none';
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





// Función para cargar historial de movimientos físicos en la sesión
async function cargarHistorialCaja() {
    const tableBody = document.getElementById('lista-movimientos-caja');
    tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 15px;">⏳ Cargando...</td></tr>';

    try {
        const res = await fetch(`${API_URL}/caja/movimientos-sesion`);

        if (res.status === 404) {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 15px; color: #7f8c8d;">🔒 La caja está cerrada (sin historial actual)</td></tr>';
            return;
        }

        const movimientos = await res.json();

        if (movimientos.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 15px;">No hay movimientos registrados.</td></tr>';
            return;
        }

        let html = '';
        movimientos.forEach(m => {
            // Formatear Hora
            const fecha = new Date(m.fecha);
            const hora = fecha.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

            // Estilos según tipo
            const isEntrada = m.tipo === 'ENTRADA';
            const colorMonto = isEntrada ? '#2e7d32' : '#c62828'; // Verde / Rojo
            const icono = isEntrada ? '📥' : '📤';
            const signo = isEntrada ? '+' : '-';

            html += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 10px;">${hora}</td>
                    <td style="padding: 10px;">${m.descripcion}</td>
                    <td style="padding: 10px;">
                        <span style="font-size: 0.9em; padding: 3px 8px; border-radius: 12px; background: ${isEntrada ? '#e8f5e9' : '#ffebee'}; color: ${colorMonto};">
                            ${icono} ${m.tipo}
                        </span>
                    </td>
                    <td style="padding: 10px; text-align: right; color: ${colorMonto}; font-weight: bold;">
                        ${signo} S/ ${m.monto.toFixed(2)}
                    </td>
                </tr>
            `;
        });

        tableBody.innerHTML = html;

    } catch (error) {
        console.error("Error cargando historial caja:", error);
        tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: red;">❌ Error al cargar historial</td></tr>';
    }
}

function verPrestamo(clienteId) {
    // Cambiar a la sección de préstamos y mostrar el detalle
    mostrarSeccion('prestamos');
    mostrarDetallePrestamo(clienteId);
}

// ==================== MÓDULO EMPLEADOS (ELIMINADO) ====================
// La gestión de empleados ha sido removida por solicitud.
// Se mantiene únicamente la lógica de login con credenciales por defecto.

function iniciarSesion() {
    const usuario = document.getElementById('login-usuario').value.trim();
    const password = document.getElementById('login-password').value;
    const mensajeDiv = document.getElementById('login-mensaje');

    mensajeDiv.innerText = '';

    if (!usuario || !password) {
        mensajeDiv.innerText = '⚠️ Ingrese usuario y contraseña';
        return;
    }

    // Obtener empleados de localStorage (robusto ante datos corruptos)
    let empleados = [];
    try {
        empleados = JSON.parse(localStorage.getItem('empleados') || '[]');
        if (!Array.isArray(empleados)) empleados = [];
    } catch (e) {
        empleados = [];
    }

    // Si no hay empleados, crear los predeterminados
    if (empleados.length === 0) {
        empleados = [
            { usuario: 'cajero', password: '123', rol: 'cajero' },
            { usuario: 'admin', password: 'admin123', rol: 'admin' },
            { usuario: 'usuario', password: 'usuario123', rol: 'cajero' }
        ];
        localStorage.setItem('empleados', JSON.stringify(empleados));
    }

    // Buscar empleado
    let empleado = empleados.find(e => e.usuario === usuario && e.password === password);

    // Intento de recuperación: si no coincide, resetear lista a defaults y volver a buscar
    if (!empleado) {
        const credencialesDefault = [
            { usuario: 'cajero', password: '123', rol: 'cajero' },
            { usuario: 'admin', password: 'admin123', rol: 'admin' },
            { usuario: 'usuario', password: 'usuario123', rol: 'cajero' }
        ];
        localStorage.setItem('empleados', JSON.stringify(credencialesDefault));
        empleado = credencialesDefault.find(e => e.usuario === usuario && e.password === password);
    }

    if (empleado) {
        // Login exitoso
        localStorage.setItem('cajero_usuario', usuario);
        localStorage.setItem('cajero_rol', empleado.rol);
        mostrarAplicacion(usuario);
    } else {
        mensajeDiv.innerText = '⚠️ Usuario o contraseña incorrectos';
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
        // ... (existing code for history) ...
    } catch (e) { console.error(e) }
}

// ==================== CRONOGRAMA DE PAGOS ====================
async function buscarCronograma() {
    const input = document.getElementById('buscar-cronograma-input').value.trim();
    const mensajeDiv = document.getElementById('mensaje-cronograma');
    const resultadoDiv = document.getElementById('cronograma-resultado');
    const tbody = document.getElementById('lista-cronograma');

    mensajeDiv.innerText = '';
    resultadoDiv.style.display = 'none';
    tbody.innerHTML = '';

    if (!input) {
        mostrarToast('Ingrese nombre o documento del cliente', 'warning');
        return;
    }

    mensajeDiv.innerText = '🔍 Buscando cliente...';

    try {
        // 1. Buscar Cliente
        const clientesRes = await fetch(`${API_URL}/clientes`);
        const clientes = await clientesRes.json();
        const clienteEncontrado = clientes.find(c =>
            c.documento === input || c.nombre.toLowerCase().includes(input.toLowerCase())
        );

        if (!clienteEncontrado) {
            mensajeDiv.innerText = '❌ Cliente no encontrado.';
            mensajeDiv.className = 'mensaje error';
            return;
        }

        // 2. Buscar Préstamo Activo
        const prestamoRes = await fetch(`${API_URL}/prestamos/cliente/${clienteEncontrado.id}`);
        if (!prestamoRes.ok) {
            if (prestamoRes.status === 404) {
                mensajeDiv.innerText = 'ℹ️ El cliente no tiene préstamo activo.';
                mensajeDiv.className = 'mensaje';
            } else {
                throw new Error('Error al consultar préstamo');
            }
            return;
        }

        const data = await prestamoRes.json();
        const { prestamo, cuotas } = data;

        mensajeDiv.innerText = '';
        resultadoDiv.style.display = 'block';

        // Llenar Cabecera
        document.getElementById('cronograma-cliente-nombre').innerText = prestamo.cliente_nombre;
        document.getElementById('cronograma-prestamo-id').innerText = prestamo.id;
        document.getElementById('cronograma-total-inicial').innerText = parseFloat(prestamo.monto_total).toFixed(2); // Deuda Total (Con Intereses)

        // Mostrar TEA y TEM si existen (compatibilidad hacia atrás)
        const tea = prestamo.tea || 0;
        const tem = prestamo.tem || 0;
        document.getElementById('cronograma-tea').innerText = tea;
        document.getElementById('cronograma-tem').innerText = tem;


        // Llenar Tabla
        cuotas.forEach(c => {
            const tr = document.createElement('tr');

            // Estado visual
            const estadoBadge = c.pagada ?
                '<span class="badge-pagada">✅ Pagada</span>' :
                '<span class="badge-pendiente">⏳ Pendiente</span>';

            // Check if we have amortization details (new loans) or fallback (old loans)
            const interes = c.interes_calculado !== undefined ? `S/ ${c.interes_calculado.toFixed(2)}` : '-';
            const amort = c.amortizacion_capital !== undefined ? `S/ ${c.amortizacion_capital.toFixed(2)}` : '-';
            const saldoCap = c.saldo_capital_restante !== undefined ? `S/ ${c.saldo_capital_restante.toFixed(2)}` : '-';

            tr.innerHTML = `
                <td>${c.numero_cuota}</td>
                <td>${c.fecha_vencimiento}</td>
                <td style="font-weight:bold;">S/ ${parseFloat(c.monto_cuota).toFixed(2)}</td>
                <td style="color:#e67e22;">${interes}</td>
                <td style="color:#27ae60;">${amort}</td>
                <td>${saldoCap}</td>
                <td>${estadoBadge}</td>
            `;
            tbody.appendChild(tr);
        });

    } catch (err) {
        console.error(err);
        mensajeDiv.innerText = '❌ Error al cargar cronograma.';
        mensajeDiv.className = 'mensaje error';
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
// ==================== CONFIGURACIÓN DEL SISTEMA ====================
function cargarConfiguracion() {
    // Cargar mora desde localStorage (o default 1%)
    const moraPorcentaje = localStorage.getItem('config_mora') || '1';
    document.getElementById('config-mora-porcentaje').value = moraPorcentaje;

    // Mostrar info del sistema
    document.getElementById('config-servidor-url').innerText = API_URL || window.location.origin;
    document.getElementById('config-usuario-actual').innerText = localStorage.getItem('cajero_usuario') || '-';
    document.getElementById('config-rol-actual').innerText = (localStorage.getItem('cajero_rol') || 'cajero').toUpperCase();

    // Actualizar visualmente la fecha en el input si ya la tenemos
    if (FECHA_SISTEMA_CACHED) {
        document.getElementById('config-fecha-sistema').value = FECHA_SISTEMA_CACHED;
    }
    // Refrescarla del servidor también
    cargarFechaSistema().then(() => {
        const input = document.getElementById('config-fecha-sistema');
        if (input) input.value = FECHA_SISTEMA_CACHED;
    });
}

async function cargarFechaSistema() {
    try {
        const res = await fetch(`${API_URL}/config/fecha`);
        if (res.ok) {
            const data = await res.json();
            // data.iso es la fecha del sistema en ISO
            const serverDate = new Date(data.iso);
            const now = new Date();
            // Calcular offset
            FECHA_SISTEMA_OFFSET = serverDate.getTime() - now.getTime();
            FECHA_SISTEMA_CACHED = data.fecha; // YYYY-MM-DD

            // Actualizar spans informativos si existen
            const span = document.getElementById('fecha-servidor-actual');
            if (span) span.innerText = data.fecha; // YYYY-MM-DD

            // Forzar actualización del header si está montado
            const headerDate = document.getElementById('header-date');
            if (headerDate) {
                const hoy = obtenerFechaHoy();
                headerDate.innerText = hoy.toLocaleDateString('es-PE', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                });
            }
        }
    } catch (e) {
        console.error("Error cargando fecha sistema:", e);
    }
}

async function guardarFechaSistema() {
    const fechaInput = document.getElementById('config-fecha-sistema').value;
    if (!fechaInput) return alert('Seleccione una fecha');

    // Validar formato (simple)
    if (fechaInput.length !== 10) return alert('Formato inválido');

    if (!confirm(`⚠️ ¿Está seguro que desea cambiar la fecha del sistema a ${fechaInput}?\nEsto afectará la apertura de caja y moras.`)) return;

    try {
        const res = await fetch(`${API_URL}/config/fecha`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fecha: fechaInput })
        });

        const data = await res.json();

        if (res.ok) {
            mostrarToast('📅 Fecha del sistema actualizada', 'success');
            await cargarFechaSistema(); // Recarga y recalcula offset

            // Recargar la página para limpiar estados dependientes de fecha anterior (opcional, pero higiénico)
            if (confirm('Fecha actualizada. ¿Desea recargar la página para aplicar cambios en todas las vistas?')) {
                window.location.reload();
            }
        } else {
            alert('Error: ' + data.error);
        }
    } catch (e) {
        console.error(e);
        alert('Error de conexión');
    }
}

function guardarConfigMora() {
    const porcentaje = parseFloat(document.getElementById('config-mora-porcentaje').value);

    if (isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100) {
        mostrarToast('❌ Ingrese un porcentaje válido (0-100)', 'error');
        return;
    }

    localStorage.setItem('config_mora', porcentaje.toString());
    mostrarToast(`✅ Mora actualizada a ${porcentaje}% `, 'success');

    document.getElementById('mensaje-config').innerText = `✅ Configuración guardada.Nueva mora: ${porcentaje}% `;
    document.getElementById('mensaje-config').classList.add('exito');
}

// Función helper para obtener el porcentaje de mora configurado
function obtenerPorcentajeMora() {
    return parseFloat(localStorage.getItem('config_mora') || '1') / 100;
}

// ==================== ESTADO DE CUENTA DEL CLIENTE ====================
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

    // Calcular deuda TOTAL incluyendo Mora
    const hoy = new Date().toISOString().split('T')[0];
    let totalPendienteReal = 0;

    cuotas.forEach(c => {
        if (!c.pagada) {
            let deudaCuota = c.saldo_pendiente;

            const vencida = c.fecha_vencimiento < hoy;
            const huboPagoParcial = (c.monto_cuota - c.saldo_pendiente) > 0.1;

            if (vencida && !huboPagoParcial) {
                // Cálculo de Mora: Interés Compuesto 1% mensual
                const fechaVenc = new Date(c.fecha_vencimiento);
                const diasAtraso = Math.floor((new Date(hoy) - fechaVenc) / (1000 * 60 * 60 * 24));
                const mesesAtraso = Math.max(1, Math.ceil(diasAtraso / 30));

                // Fórmula: Total = Saldo * (1.01)^Meses
                const totalConMora = c.saldo_pendiente * Math.pow(1.01, mesesAtraso);
                const mora = totalConMora - c.saldo_pendiente;
                deudaCuota += mora;
            }

            totalPendienteReal += deudaCuota;
        }
    });

    const estadoPrestamo = totalPendienteReal <= 0.5 ? 'Pagado' : `Pendiente - Falta pagar: S/ ${totalPendienteReal.toFixed(2)}`;

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
                <div style="font-size: 1.5em; font-weight: bold; color: #2c3e50;">S/ ${Number(totalPendienteReal).toFixed(2)}</div>
                <div>Deuda Total</div>
            </div>
        </div>
        <div style="margin-top:8px; text-align:center; font-weight:bold; color:${totalPendienteReal <= 0.5 ? '#27ae60' : '#e67e22'};">${estadoPrestamo}</div>
    `;

    // Llenar tabla
    // Llenar tabla
    /* TABLA RESUMEN OCULTA POR SOLICITUD
    const tbody = document.getElementById('estado-cuenta-lista');
    tbody.innerHTML = '';
    */

    // Obtener pagos con seguridad
    const pagos = prestamoActivo.pagos || [];

    /*
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
                const mesesAtraso = Math.max(1, Math.ceil(diasAtraso / 30));
    
                // Ver si aplica mora
                const huboPagoParcial = (cuota.monto_cuota - cuota.saldo_pendiente) > 0.1;
                let moraMonto = 0;
                if (!huboPagoParcial) {
                    const totalConMora = cuota.saldo_pendiente * Math.pow(1.01, mesesAtraso);
                    moraMonto = totalConMora - cuota.saldo_pendiente;
                }
    
                estado = `<span style="color: #e74c3c; font-weight: bold;">🔴 VENCIDA</span>`;
    
                if (moraMonto > 0) {
                    detalle = `${diasAtraso} días atraso. <br><span style="color:#d35400">+ S/ ${moraMonto.toFixed(2)} Mora (${mesesAtraso} meses)</span>`;
                } else {
                    detalle = `${diasAtraso} días atraso (Mora exonerada)`;
                }
    
            } else if (esParcial) {
                estado = '<span style="color: #e67e22; font-weight: bold;">📉 PARCIAL</span>';
                detalle = `Falta S/ ${cuota.saldo_pendiente.toFixed(2)}`;
            } else {
                estado = '<span style="color: #f39c12;">⏳ Pendiente</span>';
                detalle = 'Por vencer';
            }
    
            // BÓTON DE DESCARGA
            let btnDescarga = '';
            if (cuota.pagada) {
                // Buscar pago asociado (priorizar el aprobado/completado)
                const pagoAsociado = pagos.find(p => p.cuota_id === cuota.id && (p.estado === 'APROBADO' || !p.estado));
    
                if (pagoAsociado) {
                    // Escapamos datos para el onclick
                    const pagoId = pagoAsociado.id;
                    const monto = pagoAsociado.monto_pagado;
                    const medio = pagoAsociado.medio_pago;
    
                    btnDescarga = `
                        <button class="btn-small" style="background:#3498db; margin-left:5px;"
                            onclick="descargarComprobanteEstadoCuenta('${pagoId}', ${cuota.numero_cuota}, ${monto}, '${medio}')"
                            title="Descargar Comprobante">
                            📄
                        </button>
                    `;
                } else {
                    // Si no se encuentra el pago específico (migración antigua), intentar usar datos genéricos
                    btnDescarga = `<span style="font-size:0.8em; color:#999;">(Sin Recibo)</span>`;
                }
            }
    
            const row = document.createElement('tr');
            if (vencida) row.style.backgroundColor = '#ffebee';
            if (cuota.pagada) row.style.backgroundColor = '#e8f5e9';
    
            row.innerHTML = `
                <td>${cuota.fecha_vencimiento}</td>
                <td>Cuota ${cuota.numero_cuota}</td>
                <td>S/ ${parseFloat(cuota.monto_cuota).toFixed(2)}</td>
                <td>${estado} ${btnDescarga}</td>
                <td>${detalle}</td>
            `;
            tbody.appendChild(row);
        });
    */

    document.getElementById('modal-estado-cuenta').style.display = 'flex';

    // ==================== POBLAR HISTORIAL DE PAGOS (NUEVA TABLA) ====================
    const tbodyPagos = document.getElementById('estado-cuenta-pagos-lista');
    tbodyPagos.innerHTML = '';

    if (pagos.length === 0) {
        tbodyPagos.innerHTML = '<tr><td colspan="5" style="text-align:center;">No hay pagos registrados aún.</td></tr>';
    } else {
        // Ordenar pagos por fecha (más reciente primero)
        const pagosOrdenados = [...pagos].sort((a, b) => new Date(b.fecha_pago) - new Date(a.fecha_pago));

        pagosOrdenados.forEach(p => {
            // Solo mostrar pagos completados/aprobados
            if (p.estado && p.estado !== 'APROBADO' && p.estado !== 'COMPLETADO') return;

            // Buscar número de cuota asociada
            const cuotaAssoc = cuotas.find(c => c.id === p.cuota_id);
            const numCuota = cuotaAssoc ? cuotaAssoc.numero_cuota : 'N/A';

            const fila = document.createElement('tr');

            // Formatear fecha
            const fechaFmt = new Date(p.fecha_pago).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

            let btnAction = `descargarComprobanteEstadoCuenta('${p.id}', ${numCuota}, ${p.monto_pagado}, '${p.medio_pago}')`;

            if (p.comprobante_url) {
                btnAction = `window.open('${p.comprobante_url}', '_blank')`;
            }

            fila.innerHTML = `
                <td>${fechaFmt}</td>
                <td>Cuota ${numCuota}</td>
                <td style="font-weight:bold; color:#2c3e50;">S/ ${parseFloat(p.monto_pagado).toFixed(2)}</td>
                <td>${p.medio_pago || 'EFECTIVO'}</td>
                <td>
                    <button class="btn-small" style="background:#3498db;" 
                        onclick="${btnAction}"
                        title="Ver Comprobante">
                        📄
                    </button>
                </td>
             `;
            tbodyPagos.appendChild(fila);
        });
    }
}

function descargarComprobanteEstadoCuenta(pagoId, numCuota, monto, medio) {
    if (!prestamoActivo) return;

    const datoPago = {
        cliente_nombre: prestamoActivo.prestamo.cliente_nombre,
        cliente_doc: prestamoActivo.prestamo.cliente_documento || 'N/A',
        cliente_direccion: prestamoActivo.prestamo.cliente_direccion || '', // Si existe
        numero_cuota: numCuota,
        capital: monto,
        mora: 0, // En estado de cuenta global no tenemos el detalle historico exacto de mora facilmente aqui, asumimos 0 o total
        total: monto,
        medio_pago: medio,
        comprobante_id: pagoId
    };

    generarComprobantePDF(datoPago);
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
        // Solo mostrar en configuración
        if (id === 'config') {
            headerDate.style.display = 'block';
            const hoy = new Date();
            headerDate.innerText = hoy.toLocaleDateString('es-PE', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });
        } else {
            headerDate.style.display = 'none';
        }
    }

    if (id === 'dashboard') cargarDashboard();
    if (id === 'clientes') cargarClientes();

    if (id === 'empleados') cargarEmpleados();
    if (id === 'config') cargarConfiguracion();
};

// ==================== FUNCIONES DE SISTEMA (LOGIN / EMPLEADOS) ====================

function iniciarSesion() {
    const usuarioInput = document.getElementById('login-usuario');
    const passwordInput = document.getElementById('login-password');
    const mensaje = document.getElementById('login-mensaje');

    const usuario = usuarioInput.value.trim();
    const password = passwordInput.value.trim();

    mensaje.innerText = '';

    if (!usuario || !password) {
        mensaje.innerText = '⚠️ Ingrese usuario y contraseña';
        return;
    }

    mensaje.innerText = '⏳ Verificando...';

    // VALIDACIÓN LOCAL (Hardcoded para admin/cajero)
    let rol = 'cajero';
    let valido = false;

    // Admin
    if (usuario === 'admin' && (password === 'admin' || password === 'admin123')) {
        rol = 'admin';
        valido = true;
    }
    // Cajero
    else if (usuario === 'cajero' && (password === 'cajero' || password === 'cajero123')) {
        rol = 'cajero';
        valido = true;
    }

    if (valido) {
        localStorage.setItem('cajero_usuario', usuario);
        localStorage.setItem('cajero_rol', rol);
        mostrarAplicacion(usuario);
    } else {
        // Intentar con backend si existe
        fetch(`${API_URL}/empleados/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, clave: password })
        })
            .then(res => res.json())
            .then(data => {
                if (data.token || data.usuario) {
                    localStorage.setItem('cajero_usuario', data.usuario || usuario);
                    localStorage.setItem('cajero_rol', data.rol || 'cajero');
                    mostrarAplicacion(data.usuario || usuario);
                } else {
                    mensaje.innerText = '❌ Usuario o contraseña incorrectos';
                }
            })
            .catch(() => {
                mensaje.innerText = '❌ Usuario o contraseña incorrectos';
            });
    }
}

function cargarEmpleados() {
    const div = document.getElementById('seccion-empleados');
    if (div) {
        div.innerHTML = `
            <div class="card">
                <h3>👥 Gestión de Empleados</h3>
                <p>Módulo en desarrollo.</p>
            </div>
        `;
    }
}

function cargarConfiguracion() {
    // Lógica de configuración si se requiere
}

console.log('✅ App.js cargado correctamente.');

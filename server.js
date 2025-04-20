const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const si = require('systeminformation');
const cors = require('cors');

const app = express();
app.use(cors()); // Permitir CORS para todas las rutas

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: '*', // Permitir cualquier origen (ideal para pruebas)
        methods: ['GET', 'POST']
    }
});

function bytesToGB(bytes) {
    return (bytes / (1024 ** 3)).toFixed(2) + ' GB';
}

async function obtenerDatosSistema() {
    try {
        const [memoria, cpu, cpuTemp, discos, interfaces] = await Promise.all([
            si.mem(),
            si.cpu(),
            si.cpuTemperature(),
            si.fsSize(),
            si.networkInterfaces()
        ]);

        const sda1 = discos.find(d => d.mount === '/') || null;
        const swapSize = memoria.swaptotal > 0 ? memoria.swaptotal : 975 * 1024 * 1024;

        const sda5 = {
            fs: '/dev/sda5',
            size: swapSize,
            used: memoria.swapused,
            mount: '[SWAP]',
            use: memoria.swaptotal > 0 ? ((memoria.swapused / memoria.swaptotal) * 100).toFixed(2) + '%' : '0%'
        };

        const red = await Promise.all(
            interfaces.map(async (iface) => {
                const stats = await si.networkStats(iface.iface);
                const s = stats[0] || {};
                return {
                    interfaz: iface.iface,
                    ip4: iface.ip4,
                    mac: iface.mac,
                    recibidoMB: s.rx_bytes ? (s.rx_bytes / (1024 * 1024)).toFixed(2) : "0.00",
                    enviadoMB: s.tx_bytes ? (s.tx_bytes / (1024 * 1024)).toFixed(2) : "0.00"
                };
            })
        );

        return {
            timestamp: new Date().toISOString(),
            cpu: {
                fabricante: cpu.manufacturer || 'Desconocido',
                modelo: cpu.brand || 'Desconocido',
                nucleos: cpu.cores,
                temperatura: cpuTemp.main ? `${cpuTemp.main} °C` : 'N/D'
            },
            memoria: {
                total: bytesToGB(memoria.total),
                libre: bytesToGB(memoria.available),
                usado: bytesToGB(memoria.total - memoria.available)
            },
            particiones: {
                sda1: sda1 ? {
                    filesystem: sda1.fs,
                    tamaño: bytesToGB(sda1.size),
                    usado: bytesToGB(sda1.used),
                    libre: bytesToGB(sda1.size - sda1.used),
                    usoPorcentaje: sda1.use + '%',
                    puntoMontaje: sda1.mount
                } : null,
                sda5: {
                    filesystem: sda5.fs,
                    tamaño: bytesToGB(sda5.size),
                    usado: bytesToGB(sda5.used),
                    libre: bytesToGB(sda5.size - sda5.used),
                    usoPorcentaje: sda5.use,
                    puntoMontaje: sda5.mount,
                    esSwap: true
                }
            },
            red
        };
    } catch (error) {
        console.error('Error al obtener datos del sistema:', error);
        throw error;
    }
}

// Ruta básica
app.get('/', (req, res) => {
    res.send('Servidor de monitoreo activo. Usa <a href="/api/sistema">/api/sistema</a>');
});

// API REST para probar por navegador o fetch
app.get('/api/sistema', async (req, res) => {
    try {
        const datos = await obtenerDatosSistema();
        res.json(datos);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener datos' });
    }
});

// WebSocket
io.on('connection', (socket) => {
    console.log('Cliente conectado');
    const intervalo = setInterval(async () => {
        try {
            const datos = await obtenerDatosSistema();
            socket.emit('datosSistema', datos);
        } catch (error) {
            console.error('Error en WebSocket:', error);
        }
    }, 5000);

    socket.on('disconnect', () => {
        clearInterval(intervalo);
        console.log('Cliente desconectado');
    });
});

// Iniciar servidor
const PORT = 3000;
/*server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});*/
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en http://0.0.0.0:${PORT}`);
});

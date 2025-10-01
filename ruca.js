const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const {basesDic, refererDic} = require('./constants');

require('dotenv').config();

// Función helper para pausas
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// const BASE_BJUD_URL = process.env.BASE_BJUD_URL
// const ID_BUSCADOR = process.env.ID_BUSCADOR
const ELEMENT_PER_PAGE = parseInt(process.env.ELEMENT_PER_PAGE)
const PAGE = parseInt(process.env.PAGE)
const FINAL_PAGE = parseInt(process.env.FINAL_PAGE)
const BASE_NAME = process.env.BASE_NAME


async function getCookies() {
    const urlBase = "https://juris.pjud.cl/busqueda?Sentencias_Civiles";

    try {
        const axiosInstance = axios.create({
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
            },
        });

        const response = await axiosInstance.get(urlBase);
        if (response.status != 200) console.error("Error al obtener la página:", response.status, response.statusText);

        const $ = cheerio.load(response.data);
        const tokenElement = $('input[name="_token"]').val();

        if (!tokenElement) console.error("No se encontró el token en la página");

        const token = tokenElement;
        const rawCookies = response.headers['set-cookie'];

        if (!rawCookies) console.error("No se encontraron cookies en la respuesta");

        const cookies = {};
        rawCookies.forEach((cookieString) => {
            const [cookiePair] = cookieString.split(';');
            const [key, value] = cookiePair.split('=');
            cookies[key.trim()] = value.trim();
        });
        
        const cookieString = `PHPSESSID=${cookies.PHPSESSID}; XSRF-TOKEN=${cookies["XSRF-TOKEN"]}; buscador_unificado_de_fallos_del_poder_judicial_session=${cookies.buscador_unificado_de_fallos_del_poder_judicial_session}`;

/* PHPSESSID=jhnc97v25743suvous5oer7a0l; 

XSRF-TOKEN=eyJpdiI6ImM4YWM5b0pHaWxJSTAxSVlnUHJJM0E9PSIsInZhbHVlIjoiWTAwVTBtcElzVXNHejhka01nTzV0aUxXelQxNWc3QTZXM1F0Zy9ZTExWc3kvSU9NU2owYU1xdHJUN0N5OThkdXM0UUNrZ08xMWtDdE0xL0QwVWFtbkJpSVJNZTY4a1Urck9DeFlJOFhjWlM4QjlGL0E4TGdKYjhaZk5LYk16YmciLCJtYWMiOiJlNTQ3MGE5M2ZiMjU5OTZhMmVlZTE2MTQxNGI2NWM3YzE0Y2IxNDg5NzhiZDIwNzI4MTEwMWIzZmRmODkyOWQ2IiwidGFnIjoiIn0%3D; 

buscador_unificado_de_fallos_del_poder_judicial_session=eyJpdiI6IjNnakM2aUNmM0xqdmN1Sk0yNFNhMEE9PSIsInZhbHVlIjoiLzJoeUtHUmsxZWQ4dzNrUEFuWEZFWndRbWFXVjNYTVBvV2F2YmhlTDh6NjBGa2YzZ1NmNS95ZFVvQUhkamVoMUdINkZyM3Q2MzcyWUJwOWlGdmhHSXpBTTRiZWliUTJOdzNoLzhjNXVsdzllSi9nTVdGL0tTb1l6RGg2Y09NaG8iLCJtYWMiOiI1ZDAxMWE0YWViN2Y5MDRjZTVlODkwMmIyODJiODBhYjlhYTVkYWQ0ZDIyMjg2NDk4YTczNDBiNDQ1NDZjZGUyIiwidGFnIjoiIn0%3D */

        return {
            token: token,
            cookie: cookieString
        }
    } catch (e) {
        console.error("Error al obtener el token y las cookies:", e.message);
    }
}

// Cache para cookies con timestamp
let cookieCache = {
    token: null,
    cookie: null,
    timestamp: 0,
    duration: 6000000 // 6000 segundos en milisegundos
};

async function getValidCookies() {
    const now = Date.now();

    // Si no hay cookies o han expirado, obtener nuevas
    if (!cookieCache.token || !cookieCache.cookie || (now - cookieCache.timestamp) > cookieCache.duration) {
        console.log('🔄 Obteniendo nuevas cookies...');
        const { token, cookie } = await getCookies();

        cookieCache = {
            token,
            cookie,
            timestamp: now,
            duration: 6000000
        };

        console.log('✅ Cookies actualizadas');
    } else {
        const remainingTime = Math.round((cookieCache.duration - (now - cookieCache.timestamp)) / 1000);
        console.log(`♻️ Reutilizando cookies existentes (válidas por ${remainingTime}s más)`);
    }

    return {
        token: cookieCache.token,
        cookie: cookieCache.cookie
    };
}

// Función para crear el payload multipart de forma más eficiente
function createMultipartPayload(token, idBuscador, elementPerPage, page) {
    const boundary = '----WebKitFormBoundaryIoELJGS1wrKuLwTC';
    const filtros = JSON.stringify({
        "rol": "",
        "era": "",
        "fec_desde": "",
        "fec_hasta": "",
        "tipo_norma": "",
        "num_norma": "",
        "num_art": "",
        "num_inciso": "",
        "todas": "",
        "algunas": "",
        "excluir": "",
        "literal": "",
        "proximidad": "",
        "distancia": "",
        "analisis_s": "11",
        "submaterias": "",
        "facetas_seleccionadas": "",
        "filtros_omnibox": [{ "categoria": "TEXTO", "valores": [""] }],
        "ids_comunas_seleccionadas_mapa": []
    });

    return [
        `--${boundary}`,
        'Content-Disposition: form-data; name="_token"',
        '',
        token,
        `--${boundary}`,
        'Content-Disposition: form-data; name="id_buscador"',
        '',
        idBuscador,
        `--${boundary}`,
        'Content-Disposition: form-data; name="filtros"',
        '',
        filtros,
        `--${boundary}`,
        'Content-Disposition: form-data; name="numero_filas_paginacion"',
        '',
        elementPerPage.toString(),
        `--${boundary}`,
        'Content-Disposition: form-data; name="offset_paginacion"',
        '',
        page.toString(),
        `--${boundary}`,
        'Content-Disposition: form-data; name="orden"',
        '',
        'rel',
        `--${boundary}--`
    ].join('\r\n');
}


// TODO: aun sin uso
const sessionConnection = async () => {
    try {
        let requestCount = 0;
        let finalPage = FINAL_PAGE;
        let elementPerPage = ELEMENT_PER_PAGE; // Aumentado de 10 a 50 para menos requests
        let page = PAGE;

        const idBuscador = basesDic[BASE_NAME];
        const referer = refererDic[BASE_NAME];
        const headers = {
            'Accept': 'text/html, */*; q=0.01',
            'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
            'Connection': 'keep-alive',
            'Content-Type': 'multipart/form-data; boundary=----WebKitFormBoundaryIoELJGS1wrKuLwTC',
            'Origin': 'https://juris.pjud.cl',
            'Referer': referer,
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
            'X-Requested-With': 'XMLHttpRequest',
            'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            'sec-ch-ua-mobile': '?1',
            'sec-ch-ua-platform': '"Android"'
        };

        // Variables para el control del proceso
        let idNorma = 1;
        const LOG_DIR = './logs';
        const MAX_ID = 1000; // Definir un valor por defecto
        const HORARIO_BLOQUEADO = { inicio: 2, fin: 6 }; // Horario bloqueado por defecto
        const PAUSA_CADA_PETICIONES = 100;
        const PAUSA_MINUTOS = 5;

        // Crear directorio de logs si no existe
        if (!fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }

        // Cargar el último ID procesado si existe
        if (fs.existsSync(`${LOG_DIR}/last_norm.log`)) {
            idNorma = parseInt(fs.readFileSync(`${LOG_DIR}/last_norm.log`, 'utf8')) || 1;
            console.log(`🔄 Reanudando desde la norma ID: ${idNorma}`);
        }

        while (idNorma <= MAX_ID) {
            const currentHour = new Date().getHours();
            // Obtener cookies válidas (nuevas en cada reintento)
            const { token, cookie } = await getValidCookies();

            const payload = createMultipartPayload(token, idBuscador, elementPerPage, page);

            // Si estamos en horario bloqueado, esperar hasta que termine
            if (currentHour >= HORARIO_BLOQUEADO.inicio && currentHour < HORARIO_BLOQUEADO.fin) {
                console.log(`🕒 Horario bloqueado (${HORARIO_BLOQUEADO.inicio}:00 - ${HORARIO_BLOQUEADO.fin}:00). Esperando...`);
                await sleep((HORARIO_BLOQUEADO.fin - currentHour) * 60 * 60 * 1000);
            }

            let response;
            try {
                response = await axios.post(
                    'https://juris.pjud.cl/busqueda/buscar_sentencias',
                    payload,
                    {
                        headers: {
                            ...headers,
                            'Cookie': cookie
                        },
                        timeout: 30000 // Timeout de 30 segundos
                    }
                );
                // console.log("🚀 ~ sessionConnection ~ response:", response)
                
                if (!response.data?.response?.docs) {
                    console.log('⚠️ No se encontraron más documentos');
                    success = true;
                    break;
                }

                console.log("🚀 ~ sessionConnection ~ response.data.response.docs:", response.data.response.docs[0].id)
                if (response.data.response.docs) {

                    response.data.response.docs.forEach(async (doc) => {
                        const idSentence = doc.id;
                        // Guardar JSON con los datos de respuesta
                        const jsonData = { idSentence: idSentence, data: response.data };
                        // Guardar el último ID procesado
                        fs.writeFileSync(`${LOG_DIR}/last_norm.log`, idSentence.toString());
                        requestCount++;
                    });



                } else {
                    // Log de error
                    const errorMsg = `${new Date().toISOString()} - ID ${idNorma}: Respuesta vacía o inválida.\n`;
                    fs.appendFileSync(`${LOG_DIR}/error.log`, errorMsg);
                }
            } catch (e) {
                console.error(`❌ Error al realizar la petición:`, e.response?.status || e.message);
                const errorMsg = `${new Date().toISOString()} - ID ${idNorma}: DATA: ${response && response.data ? response.data : response} -> ERROR: ${e}\n`;
                fs.appendFileSync(`${LOG_DIR}/error.log`, errorMsg);
            }

            // Pausa aleatoria entre peticiones (1 a 10 segundos)
            const delay = Math.floor(Math.random() * 9000) + 1000;
            console.log(`⏳ Esperando ${delay / 1000} segundos antes de la siguiente petición...`);
            await sleep(delay);

            // Pausar cada 100 peticiones por n minutos
            if (requestCount >= PAUSA_CADA_PETICIONES) {
                console.log(`⏸️ Se alcanzaron ${PAUSA_CADA_PETICIONES} peticiones. Pausando por ${PAUSA_MINUTOS} minutos...`);
                await sleep(PAUSA_MINUTOS * 60 * 1000);
                requestCount = 0;
            }

            idNorma++;
        }

    } catch (e) {
        console.error("🚨 Error general en CheckNorms():", e.message);
        throw new Error("Error al ejecutar la función CheckNorms()");
    }
};

// Función principal para ejecutar el script
async function main() {
    try {
        await sessionConnection();
    } catch (error) {
        console.error('Error en la ejecución principal:', error);
        process.exit(1);
    }
}

// Ejecutar solo si este archivo es el principal
if (require.main === module) {
    main();
}
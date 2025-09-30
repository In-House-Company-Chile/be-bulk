const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

require('dotenv').config();


const BASE_BJUD_URL = process.env.BASE_BJUD_URL
const ID_BUSCADOR = process.env.ID_BUSCADOR
const ELEMENT_PER_PAGE = parseInt(process.env.ELEMENT_PER_PAGE)
const PAGE = parseInt(process.env.PAGE)
const FINAL_PAGE = parseInt(process.env.FINAL_PAGE)


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

        const cookieString = `PHPSESSID=${cookies.PHPSESSID}; XSRF-TOKEN=${cookies["XSRF-TOKEN"]}; base_jurisprudencial_del_poder_judicial_session=${cookies.base_jurisprudencial_del_poder_judicial_session}`;

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
        "filtros_omnibox": [{"categoria": "TEXTO", "valores": [""]}],
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

async function getData(idBuscadorBase, refererUrl) {
    try {
        let finalPage = FINAL_PAGE;
        let elementPerPage = ELEMENT_PER_PAGE; // Aumentado de 10 a 50 para menos requests
        let page = PAGE;

        // Constantes para la request
        const idBuscador = idBuscadorBase;
        const referer = refererUrl;
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

        while (page < finalPage) {
            let retryCount = 0;
            const maxRetries = 3;
            let success = false;

            while (retryCount < maxRetries && !success) {
                try {
                    // Obtener cookies válidas (nuevas en cada reintento)
                    const { token, cookie } = await getValidCookies();
                    
                    const payload = createMultipartPayload(token, idBuscador, elementPerPage, page);
                    
                    const response = await axios.post(
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

                    if (!response.data?.response?.docs) {
                        console.log('⚠️ No se encontraron más documentos');
                        success = true;
                        break;
                    }

                    const sentencias = response.data.response.docs;

                    success = true; // Marcar como exitoso
                    page += elementPerPage;

                    // Si no hay más páginas, salir
                    if (page >= finalPage) {
                        break;
                    }


                } catch (error) {
                    retryCount++;
                    console.error(`❌ Error en página ${Math.floor(page/elementPerPage) + 1} (intento ${retryCount}/${maxRetries}):`, error.message);

                }
            }

            // Si no se logró éxito después de todos los reintentos
            if (!success && retryCount >= maxRetries) {
                break; // Salir del bucle principal
            }
        }

    } catch (e) {
        console.error(`❌ Error general al obtener los datos: ${e.message}`);
        console.error(e.stack);
    }
}


getData(ID_BUSCADOR, BASE_BJUD_URL)

const axios = require('axios');
const cheerio = require('cheerio');

const res = [
    '3572898', '3572909',
    '3572933', '3572935',
    '3572949', '3572951',
    '3572960', '3572962'
]

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

async function getData() {

    const { token, cookie } = await getCookies();

    try {
        const elementPerPage = 12; // Número de elementos por página
        const page = 0; // Página inicial
        const idBuscador = "288"; // ID del buscador
        const referer = "https://juris.pjud.cl/busqueda?Buscador_Jurisprudencial_de_la_Corte_Suprema";

        const response = await axios.post(
            'https://juris.pjud.cl/busqueda/buscar_sentencias',
            '------WebKitFormBoundaryIoELJGS1wrKuLwTC\r\n' +
            'Content-Disposition: form-data; name="_token"\r\n\r\n' +
            `${token}\r\n` +
            '------WebKitFormBoundaryIoELJGS1wrKuLwTC\r\n' +
            'Content-Disposition: form-data; name="id_buscador"\r\n\r\n' +
            `${idBuscador}\r\n` +
            '------WebKitFormBoundaryIoELJGS1wrKuLwTC\r\n' +
            'Content-Disposition: form-data; name="filtros"\r\n\r\n' +
            '{"rol":' + `""` + ',"era":' + `""` + ',"fec_desde":"","fec_hasta":"","tipo_norma":"","num_norma":"","num_art":"","num_inciso":"","todas":' + `""` + ',"algunas":' + `""` + ',"excluir":' + `""` + ',"literal":' + `""` + ',"proximidad":"","distancia":"","analisis_s":"11","submaterias":"","facetas_seleccionadas":' + `""` + ',"filtros_omnibox":[{"categoria":"TEXTO","valores":[""]}],"ids_comunas_seleccionadas_mapa":[]}\r\n' +
            '------WebKitFormBoundaryIoELJGS1wrKuLwTC\r\n' +
            'Content-Disposition: form-data; name="numero_filas_paginacion"\r\n\r\n' +
            `${elementPerPage}\r\n` +
            '------WebKitFormBoundaryIoELJGS1wrKuLwTC\r\n' +
            'Content-Disposition: form-data; name="offset_paginacion"\r\n\r\n' +
            `${page}\r\n` +
            '------WebKitFormBoundaryIoELJGS1wrKuLwTC\r\n' +
            'Content-Disposition: form-data; name="orden"\r\n\r\n' +
            'rel\r\n' +
            '------WebKitFormBoundaryIoELJGS1wrKuLwTC--\r\n',
            {
                headers: {
                    'Accept': 'text/html, */*; q=0.01',
                    'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Connection': 'keep-alive',
                    'Content-Type': 'multipart/form-data; boundary=----WebKitFormBoundaryIoELJGS1wrKuLwTC',
                    'Cookie': `${cookie}`,
                    'Origin': 'https://juris.pjud.cl',
                    'Referer': `${referer}`,
                    'Sec-Fetch-Dest': 'empty',
                    'Sec-Fetch-Mode': 'cors',
                    'Sec-Fetch-Site': 'same-origin',
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
                    'X-Requested-With': 'XMLHttpRequest',
                    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                    'sec-ch-ua-mobile': '?1',
                    'sec-ch-ua-platform': '"Android"'
                }
            }
        );

        console.log("🚀 ~ getData ~ response:", Object.keys(response.data.highlighting))
        // const highlightingKeys = Object.keys(response.data.highlighting);
        // const found = highlightingKeys.filter(key => res.includes(key));
        // const notFound = highlightingKeys.filter(key => !res.includes(key));
        // console.log("🚀 ~ getData ~ notFound:", notFound)

        // if (found.length > 0) {
        //     console.log("Encontrados en la respuesta:", found);
        // }
        // if (notFound.length > 0) {
        //     console.log("No encontrados en la respuesta:", notFound);
        // }
        console.log("Datos obtenidos correctamente:", response.data.response.docs.map(e => e.id));
        // console.log("Datos obtenidos correctamente:", response.data.response.docs.map((e) => e.id ));
    } catch (e) {
        console.error(`Error al obtener los datos: ${e.message}`);
    }
}


async function sessionConnection() {
    try {
        let requestCount = 0;

        // Cargar el último ID procesado si existe
        if (fs.existsSync(`${this.LOG_DIR}/last_norm.log`)) {
            this.idNorma = parseInt(fs.readFileSync(`${this.LOG_DIR}/last_norm.log`, 'utf8')) || 1;
            console.log(`🔄 Reanudando desde la norma ID: ${this.idNorma}`);
        }

        while (this.ID_NORM <= this.MAX_ID) {
            const currentHour = new Date().getHours();

            // Si estamos en horario bloqueado, esperar hasta que termine
            if (currentHour >= this.HORARIO_BLOQUEADO.inicio && currentHour < this.HORARIO_BLOQUEADO.fin) {
                console.log(`🕒 Horario bloqueado (${this.HORARIO_BLOQUEADO.inicio}:00 - ${this.HORARIO_BLOQUEADO.fin}:00). Esperando...`);
                await sleep((this.HORARIO_BLOQUEADO.fin - currentHour) * 60 * 60 * 1000);
            }

            const url = `https://nuevo.leychile.cl/servicios/Navegar/get_norma_json?idNorma=${this.ID_NORM}`;
            let response;
            try {
                console.log("🚀 ~ check ~ this.ID_NORM:", this.ID_NORM);
                response = await axios.get(url, { responseType: 'json' });

                if (response.data) {
                    // Aplicar la función recursiva antes de guardar el JSON
                    const htmlUnificado = MergeHtml.create(response.data);
                    const planeText = ExtractText.create(htmlUnificado)
                    const data = response.data

                    // Guardar JSON con HTML estructurado
                    const jsonData = { idNorm: this.ID_NORM, texto: htmlUnificado, planeText: planeText, data, metadatos: JSON.stringify(data.metadatos) };
                    fs.writeFileSync(`norms/${this.ID_NORM}.json`, JSON.stringify(jsonData, null, 2));

                    // Guardar el último ID procesado
                    UpdateLastProcess.create(this.ID_NORM, this.LOG_DIR);

                    requestCount++;
                } else {
                    LogsError.create(this.ID_NORM, "Respuesta vacía o inválida.", this.LOG_DIR);
                }
            } catch (e) {
                console.error(`❌ Error al obtener ${url}:`, e.response?.status || e.message);
                LogsError.create(this.ID_NORM, `DATA: ${response && response.data ? response.data : response} -> ERROR: ${e}`, this.LOG_DIR);
            }

            // Pausa aleatoria entre peticiones (1 a 10 segundos)
            const delay = Math.floor(Math.random() * 9000) + 1000;
            console.log(`⏳ Esperando ${delay / 1000} segundos antes de la siguiente petición...`);
            await sleep(delay);

            // Pausar cada 100 peticiones por n minutos
            if (requestCount >= this.PAUSA_CADA_PETICIONES) {
                console.log(`⏸️ Se alcanzaron ${this.PAUSA_CADA_PETICIONES} peticiones. Pausando por ${this.PAUSA_MINUTOS} minutos...`);
                await sleep(this.PAUSA_MINUTOS * 60 * 1000);
                requestCount = 0;
            }

            this.ID_NORM++;
        }

    } catch (e) {
        console.error("🚨 Error general en CheckNorms():", e.message);
        throw new Error("Error al ejecutar la función CheckNorms()");
    }
};

getData()


/* [
    '3572898',
    '3572909',
    '3572933',
    '3572935',
    '3572949',
    '3572951',
    '3572952',
    '3572960',
    '3572962',
    '3572970'
]

[
    '3572898',
    '3572909',
    '3572933',
    '3572949',
    '3572951',
    '3572962',
    '3572935',
    '3572960',
    '3572970',
    '3572952'
] 

[
  '3572898'
  '3572909'
  '3572933'
  '3572949'
  '3572951'
  '3572962'
  '3572935'
  '3572960'
  '3572970'
  '3572952'
  '3573022'
  '3572915'
]

*/
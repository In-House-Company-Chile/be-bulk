const axios = require('axios');
const cheerio = require('cheerio');


class GetCookies {
    constructor() {
    }

    static async create() {
        return await new GetCookies().getCookies();
    }

    async getCookies() {
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

            return {
                token: token,
                cookie: cookieString
            }
        } catch (e) {
            console.error("Error al obtener el token y las cookies:", e.message);
        }
    }
}

module.exports = GetCookies;
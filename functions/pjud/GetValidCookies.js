const GetCookies = require('./GetCookies');

class GetValidCookies {
    constructor() {
    }

    static async create() {
        return await new GetValidCookies().getValidCookies();
    }

    async getValidCookies() {
        const now = Date.now();
        let cookieCache = {
            token: null,
            cookie: null,
            timestamp: 0,
            duration: 6000000 // 6000 segundos en milisegundos
        };

        // Si no hay cookies o han expirado, obtener nuevas
        if (!cookieCache.token || !cookieCache.cookie || (now - cookieCache.timestamp) > cookieCache.duration) {
            console.log('🔄 Obteniendo nuevas cookies...');
            const { token, cookie } = await GetCookies.create();

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
}

module.exports = GetValidCookies;
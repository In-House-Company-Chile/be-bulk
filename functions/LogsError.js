const fs = require('fs');

class LogsError {
    constructor(idNorma, message, LOG_DIR) {
        this.idNorma = idNorma
        this.message = message
        this.LOG_DIR = LOG_DIR
    }

    static create(idNorma, message, LOG_DIR) {
        return new LogsError(idNorma, message, LOG_DIR).logs()
    }

    logs() {
        try {
            const errorMessage = `${new Date().toISOString()} - ID ${this.idNorma}: ${this.message}\n`;
            fs.appendFileSync(`${this.LOG_DIR}/error.log`, errorMessage);

        } catch (e) {
            console.error("🚨 Error general en LogsError():", e.message);
            throw new Error("Error al ejecutar la función LogsError()");
        }
    };
}

module.exports = LogsError;

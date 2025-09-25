const fs = require('fs');

class UpdateLastProcess {
    constructor(idNorma, LOG_DIR) {
        this.idNorma = idNorma
        this.LOG_DIR = LOG_DIR
    }

    static create(idNorma, LOG_DIR) {
        return new UpdateLastProcess(idNorma, LOG_DIR).update()
    }

    update() {
        try {
            fs.writeFileSync(`${this.LOG_DIR}/last_norm.log`, this.idNorma.toString());

        } catch (e) {
            console.error("🚨 Error general en UpdateLastProcess():", e.message);
            throw new Error("Error al ejecutar la función UpdateLastProcess()");
        }
    };
}

module.exports = UpdateLastProcess
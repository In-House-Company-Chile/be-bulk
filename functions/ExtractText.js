const { decode } = require('he'); // Librería para decodificar HTML

class ExtractText {
    constructor(html) {
        this.html = html
    }

    static create(html) {
        return new ExtractText(html).extract()
    }

    extract() {
        try {
            if (!this.html) return ''; // Manejar valores nulos o indefinidos

            // Elimina todas las etiquetas HTML
            let text = this.html.replace(/<\/?[^>]+(>|$)/g, '').trim();

            // Decodifica entidades HTML como &#xD3; → Ó, &amp; → &, etc.
            text = decode(text);

            return text;

        } catch (e) {
            console.error("🚨 Error general en ExtractText():", e.message);
            throw new Error("Error al ejecutar la función ExtractText()");
        }
    };
}

module.exports = ExtractText
class MergeHtml {
    constructor(obj) {
        this.obj = obj
    }

    static create(obj) {
        return new MergeHtml(obj).merge()
    }

    merge() {
        try {
            let text = '';

            // Verifica si `html` existe y es un array
            if (this.obj.html && Array.isArray(this.obj.html)) {
                this.obj.html.forEach(element => {
                    if (element.t) {
                        // 🔹 Eliminamos:
                        //    - <span> y su contenido
                        //    - <div class="n rnp"> y su contenido
                        //    - <a> pero conservamos su texto interno
                        const cleanedHTML = element.t
                            .replace(/<span[^>]*>.*?<\/span>/gi, '')  // Elimina <span> y su contenido
                            .replace(/<div[^>]*class=["']?n rnp["']?[^>]*>.*?<\/div>/gis, '') // Elimina <div class="n rnp"> y su contenido
                            .replace(/<a[^>]*>(.*?)<\/a>/gi, '$1'); // Reemplaza <a> con su contenido interno

                        text += cleanedHTML + '\n'; // Concatena el HTML con un salto de línea
                    }

                    // Si el elemento tiene `h`, iterar recursivamente sobre `h`
                    if (element.h && Array.isArray(element.h)) {
                        text += MergeHtml.create({ html: element.h }) + '\n';
                    }
                });
            }

            return text.trim();

        } catch (e) {
            console.error("🚨 Error general en MergeHtml():", e.message);
            throw new Error("Error al ejecutar la función MergeHtml()");
        }
    };
}

module.exports = MergeHtml
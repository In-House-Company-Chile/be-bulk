class NormalizeWord {
    constructor(word) {
        this.word = word
    }

    static create(word) {
        return new NormalizeWord(word).extract()
    }

    extract() {
        try {
            if (!this.word) throw new Error('Word is required to normalize');
            return this.word
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase()
              .trim()

        } catch (e) {
            console.error("🚨 Error general en NormalizeWord():", e.message);
            throw new Error("Error al ejecutar la función NormalizeWord()");
        }
    };
}

module.exports = NormalizeWord
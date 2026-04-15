const DiarioOficialSource = require('./diario-oficial');
const ContraloriaSource   = require('./contraloria');

/**
 * Registry de fuentes disponibles.
 * Clave: nombre usado en --source=<nombre>
 */
const SOURCES = {
    'diario-oficial': DiarioOficialSource,
    'contraloria':    ContraloriaSource,
};

/**
 * Retorna una instancia de la fuente solicitada.
 * @param {string} sourceName
 * @param {object} options - Opciones adicionales (ej: section para diario-oficial)
 */
function getSource(sourceName, options = {}) {
    const SourceClass = SOURCES[sourceName];
    if (!SourceClass) {
        throw new Error(
            `Fuente desconocida: "${sourceName}". Disponibles: ${Object.keys(SOURCES).join(', ')}`
        );
    }

    if (sourceName === 'diario-oficial') {
        return new SourceClass(options.section);
    }

    return new SourceClass();
}

module.exports = { SOURCES, getSource };
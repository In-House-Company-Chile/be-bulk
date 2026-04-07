const DiarioOficialSource = require('./diario-oficial');
// Futuras fuentes:
// const PoderJudicialSource = require('./poder-judicial');
// const SIISource = require('./sii');

/**
 * Registry de fuentes disponibles.
 * Para agregar una nueva fuente:
 * 1. Crear el archivo en src/sources/
 * 2. Importarlo aquí
 * 3. Agregarlo al objeto sources
 */
const sources = {
    'diario-oficial': DiarioOficialSource,
    // 'poder-judicial': PoderJudicialSource,
    // 'sii': SIISource,
};

function getSource(name) {
    const SourceClass = sources[name];
    if (!SourceClass) {
        const available = Object.keys(sources).join(', ');
        throw new Error(`Fuente "${name}" no encontrada. Disponibles: ${available}`);
    }
    return new SourceClass();
}

function listSources() {
    return Object.entries(sources).map(([name, SourceClass]) => ({
        name,
        params: SourceClass.getParamsHelp(),
    }));
}

module.exports = { getSource, listSources };
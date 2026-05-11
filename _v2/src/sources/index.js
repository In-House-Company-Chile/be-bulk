const DiarioOficialSource = require('./diario-oficial');
const ContraloriaSource = require('./contraloria');
const SiiSource = require('./sii');
const TdlcSource = require('./tdlc');
const TdpiSource = require('./tdpi'); // <-- Nueva fuente
const SiesSource = require('./sies');

const SOURCES = {
    'diario-oficial': DiarioOficialSource,
    'contraloria': ContraloriaSource,
    'sii': SiiSource,
    'tdlc': TdlcSource,
    'tdpi': TdpiSource, // <-- Registro
    'sies': SiesSource, // <-- Registro
};

function getSource(sourceName, options = {}) {
    const SourceClass = SOURCES[sourceName];
    if (!SourceClass) {
        throw new Error(
            `Fuente desconocida: "${sourceName}". Disponibles: ${Object.keys(SOURCES).join(', ')}`
        );
    }

    if (sourceName === 'diario-oficial') return new SourceClass(options.section);

    // Para fuentes que no requieren parámetros en constructor
    return new SourceClass();
}

module.exports = { SOURCES, getSource };
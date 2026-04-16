const DiarioOficialSource = require('./diario-oficial');
const ContraloriaSource = require('./contraloria');
const SiiSource = require('./sii');

const SOURCES = {
    'diario-oficial': DiarioOficialSource,
    'contraloria': ContraloriaSource,
    'sii': SiiSource,
};

function getSource(sourceName, options = {}) {
    const SourceClass = SOURCES[sourceName];
    if (!SourceClass) {
        throw new Error(
            `Fuente desconocida: "${sourceName}". Disponibles: ${Object.keys(SOURCES).join(', ')}`
        );
    }
    if (sourceName === 'diario-oficial') return new SourceClass(options.section);
    return new SourceClass();
}

module.exports = { SOURCES, getSource };
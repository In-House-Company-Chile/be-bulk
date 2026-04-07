const DiarioOficialSource = require('./diario-oficial');

const sources = {
    'diario-oficial': DiarioOficialSource,
    // 'poder-judicial': PoderJudicialSource,
    // 'sii': SIISource,
};

/**
 * Instancia la fuente correcta con sus parámetros.
 * @param {string} name    - Nombre de la fuente (--source)
 * @param {object} args    - Args parseados del CLI (incluye --section, etc.)
 */
function getSource(name, args = {}) {
    const SourceClass = sources[name];
    if (!SourceClass) {
        const available = Object.keys(sources).join(', ');
        throw new Error(`Fuente "${name}" no encontrada. Disponibles: ${available}`);
    }

    // diario-oficial necesita saber qué sección instanciar
    if (name === 'diario-oficial') {
        const section = args.section || 'normas-generales';
        return new SourceClass(section);
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
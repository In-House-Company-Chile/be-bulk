const baseArray = ["familia", "penal", "cobranza", "laboral", "civil", "salud_corte_suprema", "salud_corte_de_apelaciones"]

const basesDic = {
    "familia": "270",
    "penal": "268",
    "cobranza": "269",
    "laboral": "271",
    "civil": "328",
    "salud_corte_suprema": "127",
    "salud_corte_de_apelaciones": "388",
}

const refererDic = {
    "familia": "https://juris.pjud.cl/busqueda?Sentencias_de_Familia",
    "penal": "https://juris.pjud.cl/busqueda?Sentencias_Penales",
    "cobranza": "https://juris.pjud.cl/busqueda?Sentencias_Cobranza",
    "laboral": "https://juris.pjud.cl/busqueda?Sentencias_Laborales",
    "civil": "https://juris.pjud.cl/busqueda?Sentencias_Civiles",
    "salud_corte_suprema": "https://juris.pjud.cl/busqueda?Compendio_de_Salud_de_Corte_Suprema",
    "salud_corte_de_apelaciones": "https://juris.pjud.cl/busqueda?Compendio_de_Salud_Corte_de_Apelaciones",
}

module.exports = { baseArray, basesDic, refererDic };

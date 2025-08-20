const fs = require('fs');
const path = require('path');

// Configuración
const SOURCE_DIR = './dictamenes';
const TARGET_DIR = './dictamenes_duplicados';

// Función principal
function moverDuplicados() {
    console.log('🔄 Iniciando proceso de separación de duplicados...');
    
    // Verificar que existe el directorio fuente
    if (!fs.existsSync(SOURCE_DIR)) {
        console.error(`❌ Error: La carpeta ${SOURCE_DIR} no existe`);
        return;
    }
    
    // Crear directorio de destino si no existe
    if (!fs.existsSync(TARGET_DIR)) {
        fs.mkdirSync(TARGET_DIR, { recursive: true });
        console.log(`📁 Creada carpeta: ${TARGET_DIR}`);
    }
    
    // Leer todos los archivos del directorio fuente
    const files = fs.readdirSync(SOURCE_DIR);
    
    // Filtrar solo archivos JSON duplicados
    const duplicateFiles = files.filter(file => 
        file.endsWith('.json') && file.includes('_duplicado_')
    );
    
    console.log(`📊 Archivos encontrados en ${SOURCE_DIR}: ${files.length}`);
    console.log(`📊 Archivos duplicados identificados: ${duplicateFiles.length}`);
    
    if (duplicateFiles.length === 0) {
        console.log('✅ No se encontraron archivos duplicados para mover');
        return;
    }
    
    let movedCount = 0;
    let errorCount = 0;
    
    // Mover cada archivo duplicado
    for (const file of duplicateFiles) {
        try {
            const sourcePath = path.join(SOURCE_DIR, file);
            const targetPath = path.join(TARGET_DIR, file);
            
            // Verificar que el archivo fuente existe
            if (!fs.existsSync(sourcePath)) {
                console.warn(`⚠️  Archivo no encontrado: ${file}`);
                continue;
            }
            
            // Mover archivo
            fs.renameSync(sourcePath, targetPath);
            movedCount++;
            
            console.log(`✅ Movido: ${file}`);
            
        } catch (error) {
            console.error(`❌ Error moviendo ${file}:`, error.message);
            errorCount++;
        }
    }
    
    console.log('\n=== RESUMEN ===');
    console.log(`📁 Directorio origen: ${SOURCE_DIR}`);
    console.log(`📁 Directorio destino: ${TARGET_DIR}`);
    console.log(`✅ Archivos movidos: ${movedCount}`);
    console.log(`❌ Errores: ${errorCount}`);
    console.log(`📊 Archivos restantes en origen: ${fs.readdirSync(SOURCE_DIR).length}`);
    console.log(`📊 Archivos en destino: ${fs.readdirSync(TARGET_DIR).length}`);
    
    if (movedCount > 0) {
        console.log('\n🎉 Proceso completado exitosamente!');
        console.log(`Los archivos duplicados están ahora en: ${TARGET_DIR}`);
    }
}

// Función para mostrar estadísticas sin mover archivos
function mostrarEstadisticas() {
    console.log('📊 ESTADÍSTICAS DE ARCHIVOS:');
    
    if (!fs.existsSync(SOURCE_DIR)) {
        console.error(`❌ La carpeta ${SOURCE_DIR} no existe`);
        return;
    }
    
    const files = fs.readdirSync(SOURCE_DIR);
    const duplicateFiles = files.filter(file => 
        file.endsWith('.json') && file.includes('_duplicado_')
    );
    const originalFiles = files.filter(file => 
        file.endsWith('.json') && !file.includes('_duplicado_')
    );
    
    console.log(`📁 Carpeta: ${SOURCE_DIR}`);
    console.log(`📄 Total archivos JSON: ${files.filter(f => f.endsWith('.json')).length}`);
    console.log(`📄 Archivos originales: ${originalFiles.length}`);
    console.log(`📄 Archivos duplicados: ${duplicateFiles.length}`);
    
    if (fs.existsSync(TARGET_DIR)) {
        const targetFiles = fs.readdirSync(TARGET_DIR);
        console.log(`\n📁 Carpeta: ${TARGET_DIR}`);
        console.log(`📄 Archivos duplicados ya movidos: ${targetFiles.length}`);
    }
}

// Función para mostrar ayuda
function mostrarAyuda() {
    console.log(`
📋 SCRIPT PARA MOVER ARCHIVOS DUPLICADOS

USO:
  node mover-duplicados.js                 - Mover todos los duplicados
  node mover-duplicados.js --stats         - Solo mostrar estadísticas
  node mover-duplicados.js --help          - Mostrar esta ayuda

DESCRIPCIÓN:
  Este script identifica archivos con "_duplicado_" en el nombre y los mueve
  desde ./dictamenes/ hacia ./dictamenes_duplicados/

EJEMPLOS:
  node mover-duplicados.js                 # Mover duplicados
  node mover-duplicados.js --stats         # Ver estadísticas
`);
}

// Ejecutar según argumentos
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        mostrarAyuda();
    } else if (args.includes('--stats') || args.includes('-s')) {
        mostrarEstadisticas();
    } else {
        moverDuplicados();
    }
}

module.exports = { moverDuplicados, mostrarEstadisticas };

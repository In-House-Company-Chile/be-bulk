# Game Design Document - [Título del Juego]

## 1. Información General

### 1.1 Título del Juego

**[Por definir]** - Proyecto: Felino Abandonado

### 1.2 Plataforma

-   PC ( Windows )
-   Potencial port a consolas

### 1.3 Género

-   Plataformas 2D
-   Aventura psicológica
-   Acción con elementos narrativos

### 1.4 Audiencia Objetivo

-   Edad: 13+ (Temas maduros presentados de forma accesible)
-   Jugadores que disfrutan de narrativas profundas
-   Fans de juegos indie con estilo artístico único
-   Jugadores que buscan experiencias emocionales

### 1.5 Equipo de Desarrollo

-   **Desarrollador**: Mindrae
-   **Engine**: Unity
-   **Duración estimada del proyecto**: 12 meses

## 2. Concepto del Juego

### 2.1 Visión General

Un juego de plataformas 2D que narra la historia de un felino abandonado que sufre de esquizofrenia leve. A través de 7 vidas que representan sus últimas oportunidades, el jugador debe navegar por un mundo distorsionado por la percepción del protagonista, enfrentando criaturas imaginarias nacidas de su condición mental, hasta encontrar finalmente un hogar con un vagabundo bondadoso.

### 2.2 Declaración de Diseño

"Cada vida perdida es un paso más cerca del hogar"

### 2.3 Pilares del Diseño

1.  **Narrativa Invertida**: Perder vidas acerca al jugador al final feliz
2.  **Percepción Distorsionada**: El mundo refleja el estado mental del protagonista
3.  **Criaturas Imaginarias**: Enemigos únicos que representan miedos y traumas
4.  **Mecánica de Vidas Significativa**: Cada vida tiene peso narrativo y mecánico
5.  **Redención a través del Fracaso**: La derrota es parte del camino hacia la sanación

### 2.4 Experiencia Objetivo

El jugador debe sentir:

-   Empatía hacia el protagonista
-   Curiosidad por las criaturas extrañas
-   Tensión al gestionar las vidas limitadas
-   Satisfacción emocional al completar el viaje

## 3. Mecánicas de Juego

### 3.1 Mecánicas Principales

#### Sistema de Vidas Único

-   **7 Vidas Totales**: No se pueden recuperar
-   **Pérdida Obligatoria**: 1 vida por cada jefe derrotado
-   **Sin Game Over Tradicional**: Llegar a 1 vida activa el final
-   **Indicador Visual**: Las vidas restantes afectan la percepción del mundo

#### Movimiento del Felino

-   **Caminar**: Movimiento horizontal fluido
-   **Correr**: Aumenta velocidad pero reduce control
-   **Salto**: Salto ágil característico de felinos
-   **Trepar muros**: Mecánica felina por excelencia
-   **Caída controlada**: Aterrizar siempre de pie
-   **Colgarse**: Colgarse de las esquinas o esferas

#### Habilidades de Combate

-   **Maullar**: Técnica de ataque ( control )
-   **Rodar**: Técnica de ataque


### 3.2 Mecánicas de Percepción

#### Estados Mentales

-   **7 Vidas**: Mundo relativamente normal con distorsiones leves
-   **6-5 Vidas**: Aparecen más criaturas imaginarias
-   **4-3 Vidas**: El entorno se vuelve más surrealista
-   **2 Vidas**: Realidad muy distorsionada
-   **1 Vida**: Claridad - el mundo se vuelve más real

#### Interacción con lo Imaginario (POR DEFINIR)

-   Algunas plataformas solo existen en ciertos estados mentales
-   Enemigos que cambian forma según las vidas restantes
-   Caminos que se abren/cierran según la percepción

### 3.3 Sistema de Progresión

#### Estructura por Mundo

-   **6 Mundos Principales**: Cada uno culmina con un jefe
-   **5 Misiones por Mundo**: Preparación para el jefe
-   **1 Mundo Final**: El encuentro con el vagabundo

#### Checkpoints

-   Sistema de checkpoints generoso (1 por misión)
-   No restauran vidas perdidas
-   Guardan el progreso de coleccionables

## 4. Estructura del Juego

### 4.1 Progresión General

#### Acto 1: [Titulo] (7 vidas)

-   **Mundo**: [Por definir]
-   **Jefe**: [Por definir]
-   **Transición**: Primera pérdida de vida obligatoria

#### Acto 2: [Titulo] (6 vidas)

-   **Mundo**: [Por definir]
-   **Jefe**: [Por definir]
-   **Transición**: Segunda pérdida de vida obligatoria

#### Acto 3: [Titulo] (5 vidas)

-   **Mundo**: [Por definir]
-   **Jefe**: [Por definir]
-   **Transición**: Tercera pérdida de vida obligatoria
- 
#### Acto 4: [Titulo] (4 vidas)

-   **Mundo**: [Por definir]
-   **Jefe**: [Por definir]
-   **Transición**: Cuarta pérdida de vida obligatoria
- 
#### Acto 5: [Titulo] (3 vidas)

-   **Mundo**: [Por definir]
-   **Jefe**: [Por definir]
-   **Transición**: Quinta pérdida de vida obligatoria
- 
#### Acto 6: [Titulo] (2 vidas)

-   **Mundo**: [Por definir]
-   **Jefe**: [Por definir]
-   **Transición**: Sexta pérdida de vida obligatoria
- 
#### Acto 7: [Titulo] (1 vidas)

-   **Mundo**: [Por definir]
-   **Jefe**: [Por definir]
-   **Transición**: Fin

### 4.2 Estructura de Misiones [POR DEFINIR]

#### Ejemplo de Estructura (Mundo 1)

**Misión 1-1**: [Título]

-   Tipo: [Tutorial/Exploración/Combate/Puzzle/Persecución]
-   Objetivo: [Por definir]
-   Introducción de mecánica: [Cual]
-   Enemigos: [Lista]

**Misión 1-2**: [Título]

-   [Estructura similar...]

**[Continuar con 1-3, 1-4, 1-5...]**

_[Este formato se repetirá para cada mundo]_

## 5. Enemigos y Jefes [POR DEFINIR]

### 5.1 Criaturas Imaginarias Comunes

#### Ruedrilo (Cocodrilo-Rueda)

-   **Descripción**: Cocodrilo que rueda como una rueda
-   **Comportamiento**:
    -   Rueda horizontalmente
    -   Puede cambiar dirección al chocar
    -   Vulnerable cuando se detiene
-   **Variantes según vidas**:
    -   7-5 vidas: Velocidad normal
    -   4-2 vidas: Más rápido y errático
    -   1 vida: Se vuelve un cocodrilo normal

#### Globin (Globo Viviente)

-   **Descripción**: Globo con características de goblin
-   **Comportamiento**:
    -   Flota siguiendo patrones
    -   Explota al ser atacado
    -   Puede inflarse para bloquear caminos
-   **Ataques**:
    -   Liberar aire como proyectil
    -   Embestida inflada

#### [Otros enemigos por definir]

-   **[Nombre]**: [Descripción]
-   **[Nombre]**: [Descripción]
-   **[Nombre]**: [Descripción]

### 5.2 Jefes

#### Jefe 1: [Nombre]

-   **Apariencia**: [Descripción]
-   **Contexto**: [Por qué está aquí]
-   **Fases de batalla**: [X fases]
-   **Mecánicas únicas**: [Lista]
-   **Representa**: [Miedo/trauma específico]

_[Repetir estructura para los 6 jefes]_

### 5.3 Encuentro Final: El Vagabundo

-   No es una batalla tradicional
-   Secuencia interactiva emotiva
-   Representa la aceptación y el hogar

## 6. Mundo del Juego [POR DEFINIR]

### 6.1 Ambientación General

El mundo es una ciudad abandonada vista a través de los ojos de un felino con esquizofrenia. La realidad se mezcla con la fantasía, creando entornos que fluctúan entre lo reconocible y lo surrealista.

### 6.2 Temas Visuales por Mundo

-   **Mundo 1**: Calles urbanas con elementos distorsionados
-   **Mundo 2**: [Por definir]
-   **Mundo 3**: [Por definir]
-   **Mundo 4**: [Por definir]
-   **Mundo 5**: [Por definir]
-   **Mundo 6**: [Por definir]
-   **Mundo Final**: Calidez y realidad

## 7. Arte y Estilo Visual

### 7.1 Dirección Artística

[SECCIÓN POR COMPLETAR]

**Ejemplo de estructura:**

-   Estilo artístico: [2D dibujado a mano/Pixel art/Vectorial/Mixto]
-   Paleta de colores: [Descripción de la evolución según vidas]
-   Influencias visuales: [Referencias artísticas]
-   Tratamiento de la esquizofrenia visual: [Cómo se representa]

### 7.2 Diseño de Personajes

[SECCIÓN POR COMPLETAR]

**Protagonista - Felino**:

-   Diseño base: [Descripción]
-   Cambios según vidas: [Evolución visual]
-   Animaciones clave: [Lista]

### 7.3 Diseño de Entornos

[SECCIÓN POR COMPLETAR]

## 8. Audio [POR DEFINIR]

### 8.1 Diseño Sonoro General

-   **Filosofía**: El audio refleja el estado mental del protagonista
-   **Evolución**: Cambios sutiles según las vidas restantes

### 8.2 Música

-   **Compositor**: [Por definir]
-   **Estilo**: [Ambiental/Orquestal/Electrónica/Mixto]
-   **Temas principales**:
    -   Tema del felino
    -   Tema de cada mundo
    -   Tema de batalla de jefes
    -   Tema del vagabundo (esperanza)

### 8.3 Efectos de Sonido

-   **Felino**: Maullidos, ronroneos, gruñidos
-   **Criaturas imaginarias**: Sonidos surreales y distorsionados
-   **Ambientales**: Mezcla de realidad y fantasía
-   **Feedback**: Sonidos claros para acciones del jugador

### 8.4 Diseño de Audio Dinámico

-   Distorsión aumenta con menos vidas
-   Claridad en el mundo final
-   Capas musicales que se añaden/quitan

## 9. Interfaz de Usuario [POR DEFINIR]

### 9.1 HUD Principal

-   **Contador de Vidas**: Prominente, parte central del diseño
-   **Salud**: Barra o sistema de corazones
-   **Habilidades**: Indicadores de cooldown
-   **Coleccionables**: Contador discreto

### 9.2 Menús

-   **Menú Principal**:
    
    -   Nueva Partida
    -   Continuar
    -   Opciones
    -   Galería (desbloqueables)
    -   Salir
-   **Menú de Pausa**:
    
    -   Reanudar
    -   Mapa del Mundo
    -   Inventario/Estadísticas
    -   Opciones
    -   Menú Principal

### 9.3 Pantallas Especiales

-   **Transición entre Mundos**: Narrativa visual
-   **Pérdida de Vida por Jefe**: Secuencia especial
-   **Pantalla Final**: Emotiva y contemplativa

## 10. Narrativa [POR DEFINIR]

### 10.1 Historia Principal

Un felino abandonado lucha por sobrevivir en las calles mientras su mente fragmentada crea un mundo de criaturas imposibles. Cada encuentro con estos seres imaginarios lo acerca más a la realidad, donde un vagabundo bondadoso espera para ofrecerle el hogar que siempre necesitó.

### 10.2 Temas Narrativos

-   **Salud mental**: Tratada con respeto y empatía
-   **Abandono y soledad**: La búsqueda de pertenencia
-   **Esperanza**: Encontrar luz en la oscuridad
-   **Aceptación**: De uno mismo y de ayuda externa

### 10.3 Método de Narración

-   **Narrativa ambiental**: El entorno cuenta la historia
-   **Sin diálogos verbales**: Comunicación visual y sonora
-   **Secuencias ilustradas**: Entre actos principales
-   **Simbolismo visual**: Elementos recurrentes con significado

## 11. Características Técnicas [POR DEFINIR]

### 11.1 Requisitos de Sistema (PC)

**Mínimos**:

-   OS: Windows 7/10/11
-   Procesador: Intel Core i3
-   Memoria: 4 GB RAM
-   Gráficos: DirectX 10 compatible
-   Almacenamiento: 2 GB

**Recomendados**:

-   OS: Windows 10/11
-   Procesador: Intel Core i5
-   Memoria: 8 GB RAM
-   Gráficos: DirectX 11 compatible
-   Almacenamiento: 4 GB

### 11.2 Características del Motor

-   Resolución: 1920x1080 nativa (escalable)
-   Framerate objetivo: 60 FPS estable
-   Soporte para gamepad y teclado
-   Sistema de guardado automático

## 12. Monetización [POR DEFINIR]

### 12.1 Modelo de Negocio

-   **Precio inicial**: [15-25 USD sugerido]
-   **Sin microtransacciones**
-   **Sin DLC de pago** (actualizaciones gratuitas)

### 12.2 Contenido Post-Lanzamiento

-   Modo Speedrun
-   Modo Galería con arte conceptual
-   Comentarios del desarrollador
-   Posible modo "New Game+"

## 13. Marketing y Posicionamiento [POR DEFINIR]

### 13.1 Propuesta Única de Venta

"Un juego donde perder es avanzar, y la locura es el camino hacia la cordura"

### 13.2 Comparaciones de Mercado

-   Elementos de: Celeste (temas de salud mental)
-   Mecánicas de: Ori (plataformas fluidas)
-   Narrativa de: GRIS (visual y emotiva)

## 14. Hoja de Ruta de Desarrollo [POR DEFINIR]

### 14.1 Pre-Producción

-   [ ] Concepto art principal
-   [ ] Prototipo mecánicas core
-   [ ] Diseño de niveles papel
-   [ ] Música concepto

### 14.2 Producción

-   [ ] Implementación mundos 1-2
-   [ ] Sistema de vidas completo
-   [ ] Implementación mundos 3-4
-   [ ] Implementación mundos 5-6
-   [ ] Mundo final y cierre

### 14.3 Post-Producción

-   [ ] Pulido y balance
-   [ ] Testing QA
-   [ ] Localización
-   [ ] Preparación lanzamiento

## 15. Riesgos y Mitigación [POR DEFINIR]

### 15.1 Riesgos Identificados

-   **Tema sensible**: Representación de salud mental
    -   _Mitigación_: Consultar con profesionales
-   **Mecánica de vidas**: Podría frustrar a jugadores
    -   _Mitigación_: Tutoriales claros y narrativa que justifique

### 15.2 Planes de Contingencia

-   Sistema de dificultad adaptativa opcional
-   Modo historia para jugadores casuales

----------

**Nota**: Este GDD es un documento vivo que evolucionará durante el desarrollo. Las secciones marcadas como [POR COMPLETAR] o [POR DEFINIR] deben ser desarrolladas según avance el proyecto.
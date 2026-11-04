# NeonBikeRunner3D

Videojuego 3D de motocicleta con estética synthwave, monedas, escudo, láser y dificultad progresiva. La escena original de Gemini Canvas se conserva; las reglas de la partida se ejecutan en Python.

## Ejecutar

Requiere Python 3.10 o superior.

```text
python -m venv .venv
# Activar el entorno virtual según el sistema operativo.
python -m pip install -r requirements.txt
python app.py
```

Abrir http://127.0.0.1:8765/ . Para publicar se usa el servidor WSGI de PythonAnywhere, sin ejecutar el servidor de desarrollo de Flask.

## Archivos

- `app.py`: rutas Flask, sesiones independientes y ranking persistente en SQLite.
- `motor.py`: simulación y reglas autoritativas del juego en Python.
- `estructuras.py`: `Nodo`, `ColaEnlazada` FIFO y `ListaRanking` ordenada.
- `templates/index.html`: interfaz y mapa de importaciones.
- `static/game.js`: escena original Three.js y sincronización con Python.
- `static/styles.css`: estilos locales, adaptados del diseño original.
- `static/vendor/`: Three.js 0.160.0 y sus complementos originales, con licencia MIT.
- `test_juego.py`: pruebas del motor, las estructuras y las rutas.

## Responsabilidades

Python calcula el movimiento lógico, las colisiones, los objetos recogidos, la duración de los poderes, los impactos de los proyectiles, la dificultad y el puntaje. JavaScript recibe ese estado y dibuja el escenario, interpola el movimiento, lee las teclas y reproduce los efectos de sonido. El navegador no envía puntajes para guardarlos: el servidor los obtiene de la partida.

La cola enlazada mantiene 16 apariciones futuras y permite encolar/desencolar en O(1). La lista enlazada de clasificación inserta resultados en orden descendente, con coste O(n), y conserva cinco marcas. SQLite conserva hasta 100 resultados entre reinicios. Las partidas activas residen en memoria, tienen una caducidad de 30 minutos de inactividad y se reinician si el proceso WSGI se recarga.

## Controles

A/D o flechas: girar. Espacio: disparar con el poder láser. P o Escape: pausar. En móviles: tocar los lados para girar y la zona superior para disparar. Escudo y láser duran ocho segundos de tiempo de juego. La pausa congela las reglas y los temporizadores.

## Pruebas

```text
python -m unittest -v
```

Las pruebas verifican FIFO, orden y límite del ranking, movimiento, puntaje, monedas, derrota, inmunidad, disparos, expiración de poderes, pausa, cola de apariciones, validación de entradas, idempotencia y persistencia. Las pruebas usan una base de datos temporal separada.

`GET /salud` y `GET /api/info` devuelven el estado `Running`. `GET /api/ranking` devuelve las cinco mejores marcas. Las partidas se crean con `POST /api/iniciar` y avanzan con `POST /api/avanzar`; cada una usa un identificador aleatorio independiente.

## PythonAnywhere gratuito

1. Crear una cuenta Beginner gratuita.
2. Subir los archivos o clonar el repositorio del proyecto.
3. Crear un entorno virtual con Python 3.10 o superior e instalar `requirements.txt`.
4. En Web, añadir una aplicación con Manual configuration y la misma versión de Python.
5. Establecer Source code y Working directory en la carpeta del proyecto e indicar el entorno virtual.
6. Configurar el archivo WSGI para añadir la carpeta del proyecto a `sys.path` e importar `from app import app as application`.
7. Añadir la asignación de archivos estáticos: URL `/static/`, directorio `static` del proyecto.
8. Recargar la aplicación y comprobar `/salud`, los registros y una partida desde el dominio público.

No se necesita contratar un plan de pago. El plan gratuito ofrece una aplicación web y puede exigir renovar su vigencia desde el panel. Las tipografías de Google Fonts son opcionales; existen fuentes de sustitución. Los módulos Three.js y los estilos se sirven desde el propio proyecto.

## Procedencia

Autor del proyecto académico: Alexander Cárdenas Pozo.

Escena y diseño de partida de referencia: Gemini Canvas, conversación “Creación de Juego 3D”, https://share.gemini.google/JotNXb8srA6E . La adaptación conserva la motocicleta, el sol generado con Canvas, las montañas, el bloom, las partículas y el sonido procedural. Se añadieron motor Python, estructuras de datos enlazadas, persistencia, validaciones y pruebas.

Three.js: https://threejs.org/ , licencia en `static/vendor/THREE-LICENSE.txt`.

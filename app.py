"""Aplicación Flask desplegable por WSGI en PythonAnywhere gratuito."""
from __future__ import annotations
from pathlib import Path
from contextlib import contextmanager
import logging
import math
import os
import secrets
import sqlite3
import threading
import time

from flask import Flask, jsonify, render_template, request
from estructuras import ListaRanking
from motor import Partida

BASE = Path(__file__).resolve().parent
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024
DB = Path(os.environ.get('NEON_DB_PATH', str(BASE / 'data' / 'ranking.sqlite3')))
sesiones = {}
cerrojo = threading.RLock()
logger = logging.getLogger('neonbike')


@contextmanager
def conectar():
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=10)
    db.execute('CREATE TABLE IF NOT EXISTS puntajes (sesion TEXT PRIMARY KEY, alias TEXT NOT NULL, puntaje INTEGER NOT NULL, monedas INTEGER NOT NULL, segundos REAL NOT NULL, fecha TEXT DEFAULT CURRENT_TIMESTAMP)')
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def ranking():
    lista = ListaRanking(5)
    with conectar() as db:
        # Se limita el historial conservado para que el plan gratuito no crezca sin límite.
        for alias, puntos, monedas, segundos in db.execute('SELECT alias,puntaje,monedas,segundos FROM puntajes ORDER BY puntaje DESC,fecha ASC LIMIT 100'):
            lista.insertar(dict(alias=alias, puntaje=puntos, monedas=monedas, segundos=round(segundos, 1)))
    return lista.registros()


def guardar(token, partida):
    if partida.guardada:
        return
    with conectar() as db:
        db.execute('INSERT OR IGNORE INTO puntajes(sesion,alias,puntaje,monedas,segundos) VALUES(?,?,?,?,?)',
                   (token, partida.alias, int(partida.puntaje), partida.monedas, partida.tiempo))
        db.execute('DELETE FROM puntajes WHERE sesion NOT IN (SELECT sesion FROM puntajes ORDER BY puntaje DESC,fecha ASC LIMIT 100)')
    partida.guardada = True
    logger.info('Partida finalizada: puntos=%s monedas=%s', int(partida.puntaje), partida.monedas)


@app.after_request
def cabeceras(respuesta):
    respuesta.headers['X-Content-Type-Options'] = 'nosniff'
    respuesta.headers['Referrer-Policy'] = 'same-origin'
    if request.path.startswith('/api/'):
        respuesta.headers['Cache-Control'] = 'no-store'
    return respuesta


@app.get('/')
def inicio():
    return render_template('index.html')


@app.get('/salud')
@app.get('/api/info')
def salud():
    return jsonify(estado='Running', juego='NeonBikeRunner3D', lenguaje='Python',
                   motor='Flask', estructuras=['ColaEnlazada', 'ListaRanking', 'Nodo'],
                   logica=['movimiento', 'colisiones', 'monedas', 'poderes', 'disparos', 'dificultad', 'puntaje'],
                   almacenamiento='SQLite', version='1.0.0')


@app.get('/api/ranking')
def mejores():
    return jsonify(ranking=ranking())


@app.post('/api/iniciar')
def iniciar():
    datos = request.get_json(silent=True) or {}
    if not isinstance(datos, dict):
        return jsonify(error='Formato no válido'), 400
    alias = str(datos.get('alias', 'Piloto')).strip()[:24] or 'Piloto'
    alias = ''.join(c for c in alias if c.isprintable()) or 'Piloto'
    token = secrets.token_urlsafe(24)
    ahora = time.monotonic()
    with cerrojo:
        sesiones.pop(request.headers.get('X-Game-Session', ''), None)
        vencidas = [k for k,v in sesiones.items() if ahora-v['ultimo'] > 1800]
        for k in vencidas:
            sesiones.pop(k, None)
        if len(sesiones) >= 128:
            # Liberar la partida menos reciente; nunca se almacenan contraseñas ni datos personales.
            sesiones.pop(min(sesiones, key=lambda k: sesiones[k]['ultimo']))
        partida = Partida(secrets.randbits(64), alias)
        sesiones[token] = dict(partida=partida, ultimo=ahora)
    logger.info('Running: nueva partida creada; cola=%s', len(partida.cola))
    return jsonify(sesion=token, estado=partida.estado(), ranking=ranking())


@app.post('/api/avanzar')
def avanzar():
    datos = request.get_json(silent=True)
    if not isinstance(datos, dict):
        return jsonify(error='Se esperaba un objeto JSON'), 400
    token = request.headers.get('X-Game-Session', '')
    try:
        direccion = float(datos.get('direccion', 0))
        secuencia = int(datos.get('secuencia', 0))
        desde = max(0, int(datos.get('desde_evento', 0)))
        if not math.isfinite(direccion) or secuencia < 0 or abs(direccion) > 1:
            raise ValueError
        if 'pausa' in datos and not isinstance(datos['pausa'], bool):
            raise ValueError
        if 'disparar' in datos and not isinstance(datos['disparar'], bool):
            raise ValueError
    except (ValueError, TypeError, OverflowError):
        return jsonify(error='Entrada de control no válida'), 400
    with cerrojo:
        registro = sesiones.get(token)
        if registro is None:
            return jsonify(error='La sesión terminó. Inicia una nueva partida.'), 404
        ahora = time.monotonic()
        partida = registro['partida']
        if secuencia > partida.secuencia:
            partida.actualizar(ahora-registro['ultimo'], direccion, datos.get('disparar', False))
            if 'pausa' in datos:
                partida.pausada = datos['pausa']
            partida.secuencia = secuencia
            registro['ultimo'] = ahora
        if partida.terminada:
            guardar(token, partida)
        salida = partida.estado(desde)
    return jsonify(estado=salida, ranking=ranking() if partida.terminada else None)


@app.post('/api/abandonar')
def abandonar():
    with cerrojo:
        sesiones.pop(request.headers.get('X-Game-Session', ''), None)
    return jsonify(ok=True)


@app.errorhandler(413)
def solicitud_grande(error):
    return jsonify(error='La solicitud es demasiado grande'), 413


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')
    logger.info('Running: NeonBikeRunner3D; lógica de juego en Python y estructuras enlazadas activas')
    app.run(host='127.0.0.1', port=int(os.environ.get('PORT', 8765)), debug=False)

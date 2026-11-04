"""Reglas autoritativas en Python: movimiento, colisiones, poderes y puntuación."""
from __future__ import annotations
from dataclasses import dataclass, asdict
import math
import random
from estructuras import ColaEnlazada

ANCHO_PISTA = 16.0
VELOCIDAD_BASE = 60.0
DURACION_PODER = 8.0
PASO_FISICA = 1 / 120


@dataclass
class Entidad:
    id: int
    tipo: str
    x: float
    z: float
    ancho: float = 1.5
    fondo: float = 1.5


def colision(x, z, ancho, fondo, objeto):
    return abs(x - objeto.x) < (ancho + objeto.ancho) / 2 and abs(z - objeto.z) < (fondo + objeto.fondo) / 2


class Partida:
    """El navegador solo envía dirección y disparo; el servidor decide el resultado."""
    def __init__(self, semilla, alias='Piloto'):
        self.azar = random.Random(semilla)
        self.alias = alias
        self.tiempo = self.puntaje = self.monedas = 0
        self.x = self.objetivo_x = 0.0
        self.escudo = self.laser = self.recarga = 0.0
        self.pausada = self.terminada = False
        self.objetos = {}
        self.proyectiles = {}
        self.siguiente_id = 0
        self.cola = ColaEnlazada()
        self.proxima_aparicion = 0.5
        self.eventos = []
        self.serial_evento = 0
        self.secuencia = -1
        self.guardada = False
        # Primeras recompensas visibles, sin obstáculos superpuestos.
        self.crear('coin', 0, -35)
        self.crear('shield', -3, -80)
        self.crear('laser', 3, -115)
        self.rellenar_cola()

    @property
    def multiplicador(self):
        return min(3.0, 1.0 + self.tiempo * 0.018)

    @property
    def velocidad(self):
        return VELOCIDAD_BASE * self.multiplicador

    def evento(self, tipo, x=0.0, z=0.0, **extra):
        self.serial_evento += 1
        self.eventos.append(dict(id=self.serial_evento, tipo=tipo, x=x, z=z, **extra))
        self.eventos = self.eventos[-80:]

    def crear(self, tipo, x, z):
        self.siguiente_id += 1
        ancho, fondo = {'coin': (1.2, 1.2), 'shield': (1.6, 1.6), 'laser': (1.6, 1.6), 'bullet': (0.5, 4.0)}.get(tipo, (1.5, 1.5))
        obj = Entidad(self.siguiente_id, tipo, x, z, ancho, fondo)
        (self.proyectiles if tipo == 'bullet' else self.objetos)[obj.id] = obj
        return obj

    def rellenar_cola(self):
        """La cola real contiene eventos futuros en el orden de aparición."""
        while len(self.cola) < 16:
            tipo = self.azar.choices(['obstacle', 'coin', 'shield', 'laser'], [60, 28, 6, 6])[0]
            x = self.azar.choice([-6, -3, 0, 3, 6])
            self.cola.encolar({'cuando': self.proxima_aparicion, 'tipo': tipo, 'x': x})
            intervalo = max(0.32, 0.72 / min(3.0, 1 + self.proxima_aparicion * 0.018))
            self.proxima_aparicion += intervalo

    def actualizar(self, segundos, direccion=0.0, disparar=False):
        if self.pausada or self.terminada:
            return
        if not math.isfinite(segundos) or segundos < 0:
            raise ValueError('Tiempo no válido')
        direccion = float(direccion)
        if not math.isfinite(direccion):
            raise ValueError('Dirección no válida')
        direccion = max(-1.0, min(1.0, direccion))
        # Como máximo 0,5 s por petición: una desconexión no simula minutos de golpe.
        restante = min(segundos, 0.5)
        if disparar and self.laser > 0 and self.recarga <= 0:
            self.crear('bullet', self.x, -2.0)
            self.recarga = 0.18
            self.evento('shoot', self.x, -2)
        while restante > 1e-9 and not self.terminada:
            dt = min(PASO_FISICA, restante)
            self.paso(dt, direccion)
            restante -= dt

    def paso(self, dt, direccion):
        self.tiempo += dt
        velocidad = self.velocidad
        self.puntaje += velocidad * 0.5 * dt
        self.objetivo_x = max(-8, min(8, self.objetivo_x + direccion * 30 * dt))
        self.x += (self.objetivo_x - self.x) * (1 - math.exp(-9.75 * dt))
        self.escudo = max(0, self.escudo - dt)
        self.laser = max(0, self.laser - dt)
        self.recarga = max(0, self.recarga - dt)
        while len(self.cola) and self.cola.ver_frente()['cuando'] <= self.tiempo:
            evento = self.cola.desencolar()
            self.crear(evento['tipo'], evento['x'], -250)
        self.rellenar_cola()
        for objeto in self.objetos.values():
            objeto.z += velocidad * dt
        # Barrido longitudinal del proyectil para no atravesar objetos a alta velocidad.
        for proyectil in list(self.proyectiles.values()):
            anterior_z = proyectil.z
            proyectil.z -= 180 * dt
            impacto = None
            candidatos = sorted((o for o in self.objetos.values() if o.tipo == 'obstacle'), key=lambda o: o.z, reverse=True)
            for objeto in candidatos:
                lateral = abs(proyectil.x - objeto.x) < (proyectil.ancho + objeto.ancho) / 2
                profundidad = (proyectil.fondo + objeto.fondo) / 2
                if lateral and proyectil.z - profundidad < objeto.z < anterior_z + profundidad:
                    impacto = objeto
                    break
            if impacto:
                self.objetos.pop(impacto.id, None)
                self.proyectiles.pop(proyectil.id, None)
                self.puntaje += 20
                self.evento('explosion', impacto.x, impacto.z)
            elif proyectil.z < -260:
                self.proyectiles.pop(proyectil.id, None)
        for objeto in list(self.objetos.values()):
            if colision(self.x, 0, 1.2, 3.0, objeto):
                self.objetos.pop(objeto.id, None)
                if objeto.tipo == 'obstacle':
                    if self.escudo > 0:
                        self.puntaje += 50
                        self.evento('explosion', objeto.x, objeto.z)
                    else:
                        self.terminada = True
                        self.evento('crash', self.x)
                        break
                elif objeto.tipo == 'coin':
                    self.monedas += 1
                    self.puntaje += 50
                    self.evento('coin', objeto.x, objeto.z)
                else:
                    if objeto.tipo == 'shield':
                        self.escudo = DURACION_PODER
                    else:
                        self.laser = DURACION_PODER
                    self.evento('power', objeto.x, objeto.z, poder=objeto.tipo)
            elif objeto.z > 25:
                self.objetos.pop(objeto.id, None)

    def estado(self, desde_evento=0):
        return dict(tiempo=round(self.tiempo, 4), puntaje=int(self.puntaje), monedas=self.monedas,
                    x=self.x, objetivo_x=self.objetivo_x, velocidad=self.velocidad,
                    multiplicador=self.multiplicador, escudo=self.escudo, laser=self.laser,
                    pausada=self.pausada, terminada=self.terminada,
                    objetos=[asdict(o) for o in self.objetos.values()],
                    proyectiles=[asdict(o) for o in self.proyectiles.values()],
                    eventos=[e for e in self.eventos if e['id'] > desde_evento],
                    cola_pendiente=len(self.cola), secuencia=self.secuencia)

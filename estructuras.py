"""Estructuras enlazadas implementadas para el videojuego, sin colecciones auxiliares."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Iterator


@dataclass
class Nodo:
    dato: Any
    siguiente: Nodo | None = None


class ColaEnlazada:
    """FIFO: programa la aparición de objetos. Encolar y desencolar cuestan O(1)."""
    def __init__(self):
        self.frente = self.final = None
        self.tamano = 0

    def encolar(self, dato):
        nuevo = Nodo(dato)
        if self.final is None:
            self.frente = nuevo
        else:
            self.final.siguiente = nuevo
        self.final = nuevo
        self.tamano += 1

    def ver_frente(self):
        if self.frente is None:
            raise IndexError('La cola está vacía')
        return self.frente.dato

    def desencolar(self):
        dato = self.ver_frente()
        self.frente = self.frente.siguiente
        self.tamano -= 1
        if self.frente is None:
            self.final = None
        return dato

    def __len__(self):
        return self.tamano


class ListaRanking:
    """Lista enlazada ordenada: conserva los mejores puntajes, con inserción O(n)."""
    def __init__(self, limite=5):
        if limite < 1:
            raise ValueError('El límite debe ser positivo')
        self.cabeza = None
        self.limite = limite

    def insertar(self, registro):
        nuevo = Nodo(registro)
        if self.cabeza is None or registro['puntaje'] > self.cabeza.dato['puntaje']:
            nuevo.siguiente = self.cabeza
            self.cabeza = nuevo
        else:
            actual = self.cabeza
            while actual.siguiente and actual.siguiente.dato['puntaje'] >= registro['puntaje']:
                actual = actual.siguiente
            nuevo.siguiente = actual.siguiente
            actual.siguiente = nuevo
        actual = self.cabeza
        for _ in range(self.limite - 1):
            if actual.siguiente is None:
                break
            actual = actual.siguiente
        actual.siguiente = None

    def registros(self):
        salida, actual = [], self.cabeza
        while actual:
            salida.append(actual.dato)
            actual = actual.siguiente
        return salida

"""Pruebas reproducibles de las reglas y las rutas. Ejecutar: python -m unittest -v."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from estructuras import ColaEnlazada, ListaRanking
from motor import Partida
import app as servidor


class EstructurasTest(unittest.TestCase):
    def test_cola_fifo_y_reutilizacion(self):
        cola = ColaEnlazada()
        for n in range(4):cola.encolar(n)
        self.assertEqual([cola.desencolar() for _ in range(4)], [0,1,2,3])
        self.assertEqual(len(cola),0)
        self.assertIsNone(cola.final)
        with self.assertRaises(IndexError):cola.desencolar()
        cola.encolar('nuevo');self.assertEqual(cola.desencolar(),'nuevo')

    def test_ranking_ordena_y_limita(self):
        ranking = ListaRanking(3)
        for p in [5,100,20,100,1]:ranking.insertar({'puntaje':p})
        self.assertEqual([r['puntaje'] for r in ranking.registros()],[100,100,20])


class MotorTest(unittest.TestCase):
    def nueva(self):
        p=Partida(123)
        p.objetos.clear();p.cola=ColaEnlazada();p.proxima_aparicion=1000
        return p

    def test_movimiento_limitado_y_puntaje_python(self):
        p=self.nueva()
        for _ in range(10):p.actualizar(.2,1)
        self.assertLessEqual(p.x,8);self.assertGreater(p.x,7)
        self.assertGreater(p.puntaje,50);self.assertGreater(p.multiplicador,1)

    def test_moneda_incrementa_contador_y_puntos(self):
        p=self.nueva();p.crear('coin',0,0);p.actualizar(.02)
        self.assertEqual(p.monedas,1);self.assertGreaterEqual(p.puntaje,50)

    def test_choque_termina_partida(self):
        p=self.nueva();p.crear('obstacle',0,-1);p.actualizar(.02)
        self.assertTrue(p.terminada)

    def test_escudo_impide_derrota(self):
        p=self.nueva();p.escudo=2;p.crear('obstacle',0,-1);p.actualizar(.02)
        self.assertFalse(p.terminada);self.assertGreaterEqual(p.puntaje,50)

    def test_laser_destruye_obstaculo_y_otorga_puntos(self):
        p=self.nueva();p.laser=8;o=p.crear('obstacle',0,-40)
        p.actualizar(.25,disparar=True)
        self.assertNotIn(o.id,p.objetos);self.assertFalse(p.terminada)
        self.assertGreaterEqual(p.puntaje,20)
        self.assertTrue(any(e['tipo']=='explosion' for e in p.eventos))

    def test_laser_no_dispara_sin_poder(self):
        p=self.nueva();p.actualizar(.1,disparar=True)
        self.assertFalse(p.proyectiles)

    def test_pausa_congela_tiempo_puntaje_y_poderes(self):
        p=self.nueva();p.escudo=4;p.pausada=True
        antes=p.estado();p.actualizar(.5,1,True)
        self.assertEqual(p.estado(),antes)

    def test_poder_expira_en_tiempo_simulado(self):
        p=self.nueva();p.laser=8
        for _ in range(17):p.actualizar(.5)
        self.assertEqual(p.laser,0)

    def test_cola_genera_entidades_y_conserva_ventana(self):
        p=Partida(123);p.actualizar(.5)
        self.assertEqual(len(p.cola),16);self.assertGreater(len(p.objetos),3)


class APITest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.old=servidor.DB;servidor.DB=Path(self.tmp.name)/'ranking.sqlite3'
        servidor.sesiones.clear();self.client=servidor.app.test_client()

    def tearDown(self):
        servidor.DB=self.old;self.tmp.cleanup()

    def iniciar(self):
        d=self.client.post('/api/iniciar',json={'alias':'Piloto de prueba'}).get_json()
        self.token=d['sesion'];return d

    def enviar(self,**d):
        return self.client.post('/api/avanzar',json=d,headers={'X-Game-Session':self.token})

    def test_servidor_running_y_pagina(self):
        self.assertEqual(self.client.get('/').status_code,200)
        self.assertEqual(self.client.get('/salud').get_json()['estado'],'Running')

    def test_entrada_invalida_y_sesion_ausente(self):
        self.iniciar()
        self.assertEqual(self.enviar(secuencia=1,direccion=4).status_code,400)
        self.assertEqual(self.enviar(secuencia=1,direccion='NaN').status_code,400)
        self.assertEqual(self.enviar(secuencia=-2).status_code,400)
        self.assertEqual(self.enviar(secuencia=1,pausa='no').status_code,400)
        self.assertEqual(self.client.post('/api/avanzar',json={}).status_code,404)

    def test_reintento_no_aplica_dos_veces_la_misma_entrada(self):
        self.iniciar();r=servidor.sesiones[self.token];r['ultimo']-=.2
        a=self.enviar(secuencia=1,direccion=1).get_json()['estado']
        b=self.enviar(secuencia=1,direccion=1).get_json()['estado']
        self.assertEqual(a,b)

    def test_puntaje_persistente_sin_duplicados(self):
        self.iniciar();r=servidor.sesiones[self.token];p=r['partida']
        p.puntaje=321;p.monedas=4;p.terminada=True
        self.enviar(secuencia=1);self.enviar(secuencia=1)
        servidor.sesiones.clear()
        datos=self.client.get('/api/ranking').get_json()['ranking']
        self.assertEqual(len(datos),1);self.assertEqual(datos[0]['puntaje'],321)

    def test_abandonar_libera_sesion(self):
        self.iniciar()
        self.client.post('/api/abandonar',headers={'X-Game-Session':self.token})
        self.assertNotIn(self.token,servidor.sesiones)


if __name__=='__main__':unittest.main(verbosity=2)

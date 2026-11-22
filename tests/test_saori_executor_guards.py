#!/usr/bin/env python3
"""Pruebas de regresión para guardas de acceso denegado en saori_executor.

Verifica que descripciones de tickets de soporte (Nosreme23, Markus1231 y casos
similares con palabras descriptivas como 'reinicio', 'private coop', 'permisos',
'apagado') NUNCA disparen falsos positivos de 'Acceso denegado', mientras que
solicitudes administrativas explícitas siguen bloqueándose para usuarios comunes.
"""

import os
import sys
import unittest
from unittest.mock import patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORE_DIR = os.path.join(ROOT, "core")
if CORE_DIR not in sys.path:
    sys.path.insert(0, CORE_DIR)

import saori_executor


NOSREME23_TICKET = (
    "[Contexto Canal/Ticket: Canal de Ticket de Soporte (#🎫・perdida-nosreme23). "
    "El usuario prefiere o escribe en español. Responde siempre en español.]\n"
    "[Pérdida - Slimefun] Jugador Nosreme23: - 3 basic ventus generator. "
    "Causa: Se me han perdido o convertido en bloques vanilla varias maquinas de "
    "slimefun y las networks luego del reinicio, asi como tambien varias fast "
    "machines, todo es recuperable pero quisiera porfavor que me devolviesen lo mencionado xd"
)

MARKUS1231_TICKET = (
    "[Contexto Canal/Ticket: Canal de Ticket de Soporte (#🎫・bug-markus321). "
    "El usuario prefiere o escribe en español. Responde siempre en español.]\n"
    "[Bug - Slimefun] hay maquinas que se convierten en vanilla que son del slimefun: "
    "despues de un reinicio de las 00:00 hay varias maquinas donde se convierten en "
    "vanilla como las que son: Small Fluffy Barrel que tiene forma de lugar donde se "
    "pone las abejas pero es un almacen de 17280000 y el private coop del Genectic "
    "Chickenginineering y los bloques de simple material generators donde pones el "
    "bloque y arriba el cofre ya no genera"
)


class TestSaoriExecutorTicketGuards(unittest.TestCase):
    def setUp(self):
        self._orig_high_staff = os.environ.pop("SAORI_IS_HIGH_STAFF", None)

    def tearDown(self):
        if self._orig_high_staff is not None:
            os.environ["SAORI_IS_HIGH_STAFF"] = self._orig_high_staff
        else:
            os.environ.pop("SAORI_IS_HIGH_STAFF", None)

    @patch.object(saori_executor, "trigger_alert_if_needed", return_value=False)
    def test_nosreme23_ticket_no_false_positive_power_denied(self, _mock_alert):
        res = saori_executor.handle_server_actions(NOSREME23_TICKET, "nosreme23")
        self.assertIsNone(
            res,
            f"El ticket de Nosreme23 ('luego del reinicio') no debe disparar Acceso denegado, obtuvo: {res!r}",
        )

    @patch.object(saori_executor, "trigger_alert_if_needed", return_value=False)
    def test_markus1231_ticket_no_false_positive_coop_or_reinicio(self, _mock_alert):
        res = saori_executor.handle_server_actions(MARKUS1231_TICKET, "markus321")
        self.assertIsNone(
            res,
            f"El ticket de Markus1231 ('private coop' y 'despues de un reinicio') no debe disparar Acceso denegado, obtuvo: {res!r}",
        )

    @patch.object(saori_executor, "trigger_alert_if_needed", return_value=False)
    def test_ticket_followup_descriptive_words_no_false_positive(self, _mock_alert):
        ticket_ctx = "[Contexto Canal/Ticket: Canal de Ticket de Soporte (#🎫・bug-markus321).]\n"
        descriptive_messages = [
            "Mi private coop dejó de funcionar luego del reinicio de anoche",
            "No tengo permisos en mi isla después del apagado",
            "Mis máquinas estaban generando bien antes del reinicio",
            "Necesito help con el generator que no enciende",
        ]
        for msg in descriptive_messages:
            with self.subTest(msg=msg):
                res = saori_executor.handle_server_actions(ticket_ctx + msg, "markus321")
                self.assertIsNone(res, f"Mensaje descriptivo en ticket disparó guarda: {res!r}")

    @patch.object(saori_executor, "trigger_alert_if_needed", return_value=False)
    def test_explicit_power_requests_still_denied_for_players(self, _mock_alert):
        cases = [
            "reinicia el server",
            "saori reinicia el servidor por favor",
            "!sreinicio",
            "apaga el server",
            "enciende el servidor",
            "[Contexto Canal/Ticket: Canal de Ticket de Soporte (#🎫・bug-test).]\nreinicia el server",
            "[Contexto Canal/Ticket: Canal de Ticket de Soporte (#🎫・bug-test).]\n!sreinicio 60",
        ]
        for msg in cases:
            with self.subTest(msg=msg):
                res = saori_executor.handle_server_actions(msg, "jugador_comun")
                self.assertIsNotNone(res)
                self.assertIn("Acceso denegado", res)
                self.assertIn("operaciones de energía", res)

    @patch.object(saori_executor, "trigger_alert_if_needed", return_value=False)
    def test_explicit_permission_requests_still_denied_for_players(self, _mock_alert):
        cases = [
            "dame op",
            "cambia permisos",
            "modifica los permisos del servidor",
            "/op jugador_comun",
            "lp user jugador_comun parent set admin",
            "[Contexto Canal/Ticket: Canal de Ticket de Soporte (#🎫・bug-test).]\ndame op",
            "[Contexto Canal/Ticket: Canal de Ticket de Soporte (#🎫・bug-test).]\ncambia permisos",
        ]
        for msg in cases:
            with self.subTest(msg=msg):
                res = saori_executor.handle_server_actions(msg, "jugador_comun")
                self.assertIsNotNone(res)
                self.assertIn("solo Jack puede modificar permisos globales", res)


if __name__ == "__main__":
    unittest.main()

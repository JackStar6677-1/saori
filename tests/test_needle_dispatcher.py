# -*- coding: utf-8 -*-
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "core"))

from needle_dispatcher import NeedleDispatcher, extract_user_prompt, sanitize_for_matching


class TestNeedleDispatcher(unittest.TestCase):
    def setUp(self):
        self.dispatcher = NeedleDispatcher(
            tps_getter=lambda: "TPS_OK",
            players_getter=lambda: "PLAYERS_OK",
            status_getter=lambda: "STATUS_OK",
            tasks_getter=lambda: "TASKS_OK",
        )
        # Ensure tests exercise deterministic logic regardless of optional SAN package
        self.dispatcher.needle = None

    def test_regression_markus321_ticket_with_context_and_https(self):
        prompt = (
            "[Contexto Canal/Ticket: Canal de Ticket de Soporte (#🎫・perdida-markus321). "
            "Lore oficial: https://drakescraft.cl/temporada-2.html "
            "No deduzcas TPS, salud óptima, apertura pública ni máximo configurado.]\n"
            "en esta dimensión fue no se si fue error o algo pero si fue error ayudar a corregirlo "
            "aunque no me devuelvan nada 😄 no hay problema en empezar de nuevo"
        )
        self.assertIsNone(self.dispatcher.try_dispatch(prompt))

    def test_url_https_does_not_trigger_tps(self):
        self.assertIsNone(
            self.dispatcher.try_dispatch("mira esta captura https://cdn.discordapp.com/attachments/123/img.png")
        )
        self.assertIsNone(
            self.dispatcher.try_dispatch(
                "[Contexto Canal/Ticket: Canal dedicado. https://drakescraft.cl No deduzcas TPS.]\n"
                "hola, perdí mis cosas en el nether"
            )
        )

    def test_ticket_channel_blocks_generic_server_mentions(self):
        prompt = (
            "[Contexto Canal/Ticket: Canal de Ticket de Soporte (#🎫・bug-user).]\n"
            "en el servidor tuve un error con mi isla y los jugadores no pueden entrar"
        )
        self.assertIsNone(self.dispatcher.try_dispatch(prompt))

    def test_ticket_channel_allows_explicit_tps_or_lag_question(self):
        for msg in [
            "¿cómo van los tps?",
            "hay mucho lag en el server",
            "lag del servidor",
            "spark tps",
            "está muy lageado",
        ]:
            prompt = f"[Contexto Canal/Ticket: Canal de Ticket de Soporte (#🎫・bug-user).]\n{msg}"
            self.assertEqual(self.dispatcher.try_dispatch(prompt), "TPS_OK", f"Failed for: {msg}")

    def test_non_ticket_fast_paths_still_work(self):
        self.assertEqual(self.dispatcher.try_dispatch("spark tps"), "TPS_OK")
        self.assertEqual(self.dispatcher.try_dispatch("quien esta conectado"), "PLAYERS_OK")
        self.assertEqual(self.dispatcher.try_dispatch("estado del servidor"), "STATUS_OK")
        self.assertEqual(self.dispatcher.try_dispatch("tareas pendientes"), "TASKS_OK")

    def test_helpers(self):
        msg, is_ticket = extract_user_prompt("[Contexto Canal/Ticket: Canal de Ticket de Soporte.]\nHola")
        self.assertEqual(msg, "Hola")
        self.assertTrue(is_ticket)
        self.assertEqual(sanitize_for_matching("link https://example.com/tps ok"), "link   ok")


if __name__ == "__main__":
    unittest.main()

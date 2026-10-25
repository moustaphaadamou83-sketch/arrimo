"""Garde-fous locaux du lanceur : aucune connexion ni création de base."""
import importlib.util
import pathlib
import unittest

fichier = pathlib.Path(__file__).resolve().parent.parent / 'scripts' / 'recette-serveur-arrimo.py'
spec = importlib.util.spec_from_file_location('recette_arrimo', fichier)
recette = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recette)


class ConfigurationServeurTest(unittest.TestCase):
    def test_socket_local_existant_sans_identifiant_invente(self):
        u, _, host = recette.configuration_pg('postgresql:///postgres?host=/var/run/postgresql')
        self.assertIsNone(u.username)
        self.assertEqual(host, '/var/run/postgresql')

    def test_loopback_autorisee(self):
        self.assertEqual(recette.configuration_pg('postgresql://compte@127.0.0.1/postgres')[2], '127.0.0.1')

    def test_base_publique_refusee(self):
        with self.assertRaises(ValueError):
            recette.configuration_pg('postgresql://compte@localhost/arrimo')

    def test_hote_distant_refuse(self):
        with self.assertRaises(ValueError):
            recette.configuration_pg('postgresql://compte@db.hopital.example/postgres')

    def test_hote_distant_par_parametre_refuse(self):
        with self.assertRaises(ValueError):
            recette.configuration_pg('postgresql://compte@localhost/postgres?host=db.hopital.example')

    def test_remplacement_base_par_parametre_refuse(self):
        with self.assertRaises(ValueError):
            recette.configuration_pg('postgresql://compte@localhost/postgres?database=arrimo')

    def test_remplacement_utilisateur_par_parametre_refuse(self):
        with self.assertRaises(ValueError):
            recette.configuration_pg('postgresql://compte@localhost/postgres?user=autre')

    def test_parametre_repete_refuse(self):
        with self.assertRaises(ValueError):
            recette.configuration_pg('postgresql://compte@localhost/postgres?host=localhost&host=autre')

    def test_options_sql_refusees(self):
        with self.assertRaises(ValueError):
            recette.configuration_pg('postgresql://compte@localhost/postgres?options=-csearch_path=public')

    def test_protocole_invalide_refuse(self):
        with self.assertRaises(ValueError):
            recette.configuration_pg('https://localhost/postgres')

    def test_erreur_ne_divulgue_pas_le_secret(self):
        with self.assertRaises(ValueError) as erreur:
            recette.configuration_pg('postgresql://compte:secret_fictif@distant/arrimo')
        self.assertNotIn('secret_fictif', str(erreur.exception))


if __name__ == '__main__':
    unittest.main()

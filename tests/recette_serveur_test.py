"""Garde-fous locaux du lanceur : aucune connexion ni création de base."""
import importlib.util
import pathlib
import tempfile
import json
import hashlib
from types import SimpleNamespace
from unittest.mock import patch
import unittest

fichier = pathlib.Path(__file__).resolve().parent.parent / 'scripts' / 'recette-serveur-arrimo.py'
spec = importlib.util.spec_from_file_location('recette_arrimo', fichier)
recette = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recette)


class ConfigurationServeurTest(unittest.TestCase):
    def test_api_controle_ses_modes_sans_heritage_demo_force(self):
        e = {'ARRIMO_ENV': 'demo', 'ARRIMO_DEMO': '1', 'PATH': '/bin'}
        self.assertEqual(recette.environnement_suite(e, 'api'), {'PATH': '/bin'})
        self.assertEqual(recette.environnement_suite(e, 'priorites-sql'), e)
        self.assertEqual(e['ARRIMO_ENV'], 'demo')

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

    def test_url_de_test_localhost_conserve_socket_unix(self):
        u, q, host = recette.configuration_pg('postgresql:///postgres?host=/var/run/postgresql')
        cible = recette.url_base_isolee(u, q, host, 'arrimo_demo_trio_recette_20261025')
        p = recette.urllib.parse.urlsplit(cible)
        self.assertEqual(p.hostname, 'localhost')
        self.assertEqual(p.path, '/arrimo_demo_trio_recette_20261025')
        self.assertEqual(recette.urllib.parse.parse_qs(p.query)['host'], ['/var/run/postgresql'])

    def test_url_de_test_sans_socket_explicite_conserve_authentification_locale(self):
        u, q, host = recette.configuration_pg('postgresql:///postgres')
        cible = recette.url_base_isolee(u, q, host, 'arrimo_test_exemple')
        self.assertEqual(recette.urllib.parse.urlsplit(cible).hostname, 'localhost')
        self.assertEqual(recette.urllib.parse.parse_qs(recette.urllib.parse.urlsplit(cible).query)['host'], ['/var/run/postgresql'])

    def test_url_de_test_preserve_compte_port_et_socket(self):
        u, q, host = recette.configuration_pg('postgresql://compte@localhost:5433/postgres?host=/var/run/postgresql')
        cible = recette.urllib.parse.urlsplit(recette.url_base_isolee(u, q, host, 'arrimo_test_exemple'))
        self.assertEqual((cible.username, cible.port), ('compte', 5433))
        self.assertEqual(recette.urllib.parse.parse_qs(cible.query)['host'], ['/var/run/postgresql'])

    def test_url_de_test_refuse_nom_public(self):
        u, q, host = recette.configuration_pg('postgresql:///postgres')
        with self.assertRaises(ValueError):
            recette.url_base_isolee(u, q, host, 'arrimo')


class RepriseRecetteTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='arrimo-reprise-test-')
        self.addCleanup(self.tmp.cleanup)
        self.dossier = pathlib.Path(self.tmp.name)
        self.rapport = self.dossier / 'rapport.json'
        self.sauvegarde = self.dossier / 'copie-fictive.dump'
        self.sauvegarde.write_bytes(b'fixture de preuve, pas une vraie sauvegarde PostgreSQL')
        self.reussies = {'priorites-sql', 'interop-sql', 'scenarios-abc', 'dashboards-abc-reseau'}
        self.tap = b'TAP version 13\n# Subtest: parcours reel\nok 1 - parcours reel\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n'
        self.donnees = {'commit': 'a' * 40, 'sauvegarde_fictive_restauree': True,
                        'sauvegarde_sha256': hashlib.sha256(self.sauvegarde.read_bytes()).hexdigest(),
                        'etapes': [{'nom': nom, 'reussi': True} for nom in recette.PREUVES_REQUISES]}
        for nom, *_ in recette.SUITES:
            self.donnees['etapes'].append({'nom': nom, 'reussi': nom in self.reussies})
            (self.dossier / (nom + '.log')).write_bytes(self.tap)
        self.ecrire()

    def ecrire(self):
        self.rapport.write_text(json.dumps(self.donnees))

    def test_selectionne_exactement_les_huit_echecs(self):
        reprise = recette.examiner_reprise(self.rapport)
        self.assertEqual([s[0] for s in reprise['selection']], ['api', 'securite-multietablissement', 'interface-parcours',
                         'priorites-navigateur', 'structure-navigateur', 'sh-erp', 'sh-navigateur', 'securite-xss'])
        self.assertEqual(reprise['sauvegarde'], str(self.sauvegarde))

    def test_refuse_de_reutiliser_un_journal_avec_tests_ignores(self):
        (self.dossier / 'interop-sql.log').write_bytes(self.tap.replace(b'# skipped 0', b'# skipped 1'))
        with self.assertRaisesRegex(ValueError, 'journal de réussite'):
            recette.examiner_reprise(self.rapport)

    def test_refuse_sauvegarde_modifiee(self):
        self.sauvegarde.write_bytes(b'contenu change')
        with self.assertRaisesRegex(ValueError, 'empreinte de sauvegarde'):
            recette.examiner_reprise(self.rapport)

    def test_refuse_migration_non_validee(self):
        for e in self.donnees['etapes']:
            if e['nom'] == 'migrations-copie-restauree':
                e['reussi'] = False
        self.ecrire()
        with self.assertRaisesRegex(ValueError, 'migrations-copie-restauree'):
            recette.examiner_reprise(self.rapport)

    def test_refuse_rapport_incomplet_sans_xss(self):
        self.donnees['etapes'] = [e for e in self.donnees['etapes'] if e['nom'] != 'securite-xss']
        self.ecrire()
        with self.assertRaisesRegex(ValueError, 'securite-xss'):
            recette.examiner_reprise(self.rapport)

    def test_aucun_echec_ne_declenche_pas_de_reexecution_inutile(self):
        for e in self.donnees['etapes']:
            e['reussi'] = True
        self.ecrire()
        with self.assertRaisesRegex(ValueError, 'Aucune étape en échec'):
            recette.examiner_reprise(self.rapport)

    def test_refuse_reprise_si_application_ou_migrations_changent(self):
        with patch.object(recette.subprocess, 'run', return_value=SimpleNamespace(returncode=1)):
            with self.assertRaisesRegex(ValueError, 'recette complète requise'):
                recette.verifier_compatibilite_reprise({'commit': 'a' * 40})

    def test_analyse_tap_refuse_absence_echec_annulation_et_fichier_fantome(self):
        self.assertTrue(recette.tap_valide(self.tap))
        invalides = [b'', self.tap.replace(b'# fail 0', b'# fail 1'), self.tap.replace(b'# cancelled 0', b'# cancelled 1'),
                     self.tap.replace(b'# tests 1', b'# tests 0'), self.tap.replace(b'parcours reel', b'tests/fichier.test.cjs')]
        for texte in invalides:
            with self.subTest(texte=texte):
                self.assertFalse(recette.tap_valide(texte))


if __name__ == '__main__':
    unittest.main()

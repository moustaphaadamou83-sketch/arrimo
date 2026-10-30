"""Contrôles du nouveau lanceur sans service, base ou écriture sous /opt."""
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import subprocess
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('og_publication',ROOT/'scripts/og-publication/publier.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class GardeFous(unittest.TestCase):
    def test_perimetre_suivi_et_interface_autorise(self):
        self.assertEqual(m.verifier_perimetre_runtime({'src/og-outils.js':'avant'}, {'src/og-outils.js':'apres','src/og-suivi.js':'nouveau'}),{'src/og-outils.js','src/og-suivi.js'})
    def test_perimetre_refuse_autres_modules_et_migrations(self):
        for fichier in ('src/auth.js','src/services.js','db/schema.sql','public-sh/app.js'):
            with self.assertRaises(m.Refus):m.verifier_perimetre_runtime({fichier:'avant'},{fichier:'apres'})
    def test_perimetre_refuse_suppression_et_lot_vide(self):
        with self.assertRaises(m.Refus):m.verifier_perimetre_runtime({'src/og-suivi.js':'avant'}, {})
        with self.assertRaises(m.Refus):m.verifier_perimetre_runtime({'src/og-outils.js':'avant'}, {'src/og-outils.js':'avant'})
    def test_diagnostic_prive_sans_sorties_secretes(self):
        with tempfile.TemporaryDirectory() as d:
            p=m.Publication.__new__(m.Publication)
            p.out=Path(d);p.code=ROOT;p.env={};p.rapport={'etapes':[]};p.sauver=lambda:None
            retour=subprocess.CompletedProcess([],1,b'JETON_PRIVE',b'VERIFICATION_OG_ECHOUEE ERR_ASSERTION compte=c etape=patient_individuel\nURL_PRIVEE')
            with patch.object(m.subprocess,'run',return_value=retour):
                with self.assertRaises(m.Refus):p.run('og-copie-demo',['node'],prive=True)
            journal=p.out/'og-copie-demo.log'
            self.assertEqual(journal.read_text(),'VERIFICATION_OG_ECHOUEE ERR_ASSERTION compte=c etape=patient_individuel\n')
            self.assertEqual(journal.stat().st_mode&0o777,0o600)
    def test_sorties_privees_non_structurees_non_conservees(self):
        with tempfile.TemporaryDirectory() as d:
            p=m.Publication.__new__(m.Publication)
            p.out=Path(d);p.code=ROOT;p.env={};p.rapport={'etapes':[]};p.sauver=lambda:None
            with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],1,b'SECRET',b'SECRET')):
                with self.assertRaises(m.Refus):p.run('sql',['psql'],prive=True)
            self.assertFalse((p.out/'sql.log').exists())
    def test_env_litteral(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'env';p.write_text("ARRIMO_ENV=demo\nSECRET='mot # privé'\nVIDE=\n")
            self.assertEqual(m.lire_env(p),{'ARRIMO_ENV':'demo','SECRET':'mot # privé','VIDE':''})
    def test_environmentfile_espaces_et_commentaires(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'routeur.env'
            p.write_text('ARRIMO_ROUTEUR_NOM=Routeur local de demonstration Arrimo OSRM\nLIBELLE=texte # litteral\nCITE="mot prive"\n')
            self.assertEqual(m.lire_env(p,systemd=True), {
                'ARRIMO_ROUTEUR_NOM':'Routeur local de demonstration Arrimo OSRM',
                'LIBELLE':'texte # litteral','CITE':'mot prive'})
            with self.assertRaises(m.Refus):m.lire_env(p)
    def test_environmentfile_evaluation_et_formes_complexes_refusees(self):
        for v in ('$(id)', '${HOME}', '`id`', 'mot\\ espace', 'mot "suite"'):
            with tempfile.TemporaryDirectory() as d:
                p=Path(d)/'env';p.write_text('SECRET='+v)
                with self.assertRaises(m.Refus):m.lire_env(p,systemd=True)
    def test_env_evaluation_refusee(self):
        for v in ('$(touch /tmp/interdit)','`id`','${HOME}'):
            with tempfile.TemporaryDirectory() as d:
                p=Path(d)/'env';p.write_text('SECRET='+v)
                with self.assertRaises(m.Refus):m.lire_env(p)
    def test_sql_distant_et_options_refuses(self):
        for url in ('postgresql://prod.example/db','postgresql:///db?host=prod.example','postgresql:///db?options=abc','postgresql:///db?host=localhost&host=prod.example'):
            with self.assertRaises(m.Refus):m.base_locale(url)
    def test_nom_copie_public_refuse(self):
        with self.assertRaises(m.Refus):m.url_copie('postgresql:///arrimo','arrimo')
    def test_copie_ne_change_pas_les_identifiants(self):
        self.assertEqual(m.url_copie('postgresql://u:secret@127.0.0.1/arrimo?host=/var/run/postgresql','arrimo_publication_restore_og_demo_abcd'),'postgresql://u:secret@127.0.0.1/arrimo_publication_restore_og_demo_abcd?host=/var/run/postgresql')
    def test_lien_hors_release_refuse(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d)/'current').symlink_to('/tmp')
            with self.assertRaises(m.Refus):m.courant(d)
    def test_release_symlink_refusee(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);(p/'releases').mkdir();(p/'releases/abc').symlink_to('/tmp');(p/'current').symlink_to('releases/abc')
            with self.assertRaises(m.Refus):m.courant(d)
    def test_lien_valide(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);(p/'releases/abc').mkdir(parents=True);(p/'current').symlink_to('releases/abc')
            self.assertEqual(m.courant(d),'releases/abc')
    def test_tar_traversee_et_liens_refuses(self):
        for name,genre in (('../etc/passwd',tarfile.REGTYPE),('/tmp/a',tarfile.REGTYPE),('lien',tarfile.SYMTYPE)):
            with tempfile.TemporaryDirectory() as d:
                p=Path(d)/'a.tar'
                with tarfile.open(p,'w') as t:
                    i=tarfile.TarInfo(name);i.type=genre;t.addfile(i)
                with self.assertRaises(m.Refus):m.extraire(p,Path(d)/'sortie')
    def test_tap_incomplet_ou_ignore_refuse(self):
        bon=b'# tests 2\n# pass 2\n# fail 0\n# skipped 0\n# cancelled 0\n'
        self.assertTrue(m.tap_valide(bon))
        for b in (b'',bon.replace(b'pass 2',b'pass 1'),bon.replace(b'skipped 0',b'skipped 1'),bon+b'# Subtest: tests/api.test.js\n'):
            self.assertFalse(m.tap_valide(b))
    def test_production_exclue_avant_systemd_et_sql(self):
        p=m.Publication.__new__(m.Publication);p.args=type('Args',(),{'cibles':'demo'})();p.infos={};p.rapport={'environnements':{}};p.sauver=lambda:None
        p.run=lambda *a,**k:self.fail('Le service ne doit pas être interrogé sur une cible hors Démo')
        with patch.object(m,'lire_env',return_value={'ARRIMO_ENV':'production','ARRIMO_DEMO':'1'}):
            with self.assertRaises(m.Refus):p.inventaire()
        self.assertEqual(p.rapport['environnements']['demo']['statut'],'exclu_hors_demo')
    def test_retour_refuse_production(self):
        with tempfile.TemporaryDirectory(prefix='arrimo-og-publication-') as d:
            p=Path(d)/'rapport.json';p.write_text(json.dumps({'environnements':{'demo':{}}}))
            args=type('Args',(),{'retour':str(p),'cible_retour':'demo'})()
            with patch.object(m,'lire_env',return_value={'ARRIMO_ENV':'production'}),patch.object(m.subprocess,'run') as run:
                with self.assertRaises(m.Refus):m.retour(args)
                run.assert_not_called()
class Orchestration(unittest.TestCase):
    def preparer(self, d):
        p=m.Publication.__new__(m.Publication);p.args=type('Args',(),{'audit':False})();p.out=Path(d);p.code=ROOT;p.infos={};p.rapport={};p.evenements=[]
        (p.out/'tests-locaux.json').write_text(json.dumps({'total':{'reussis':152,'echecs':0,'ignores':0,'annules':0}}))
        def noter(n):
            def f(*a,**k):p.evenements.append((n,*a))
            return f
        for n in ('charger','verifier_sh','maintenance','run','comptes','sauvegarde','recette','preparer_release','activer','fermer','sauver'):
            setattr(p,n,noter(n))
        def inventaire():p.evenements.append(('inventaire',));p.infos={'demo':{},'principal':{}}
        p.inventaire=inventaire
        return p
    def test_toutes_les_copies_et_recettes_avant_toute_bascule(self):
        with tempfile.TemporaryDirectory() as d:
            p=self.preparer(d);p.executer();ev=p.evenements
            first=next(i for i,x in enumerate(ev) if x[0]=='activer')
            self.assertEqual([x[1] for x in ev[:first] if x[0]=='sauvegarde'],['demo','principal'])
            self.assertEqual([x[1] for x in ev[:first] if x[0]=='preparer_release'],['demo','principal'])
            self.assertTrue(any(x[0]=='recette' for x in ev[:first]));self.assertTrue(p.rapport['publication_verifiee'])
    def test_echec_sauvegarde_interdit_recette_et_bascule(self):
        with tempfile.TemporaryDirectory() as d:
            p=self.preparer(d);p.sauvegarde=lambda *a:(_ for _ in ()).throw(m.Refus('sauvegarde'))
            with self.assertRaises(m.Refus):p.executer()
            self.assertFalse(any(x[0] in ('recette','preparer_release','activer') for x in p.evenements))
    def test_echec_recette_interdit_toute_release(self):
        with tempfile.TemporaryDirectory() as d:
            p=self.preparer(d);p.recette=lambda:(_ for _ in ()).throw(m.Refus('recette'))
            with self.assertRaises(m.Refus):p.executer()
            self.assertFalse(any(x[0] in ('preparer_release','activer') for x in p.evenements))
    def test_audit_ne_cree_pas_de_copie_et_ne_connecte_pas_les_comptes(self):
        with tempfile.TemporaryDirectory() as d:
            p=self.preparer(d);p.args.audit=True;p.executer()
            self.assertFalse(any(x[0] in ('maintenance','sauvegarde','comptes','recette','activer') for x in p.evenements))
            self.assertEqual(p.rapport['statut'],'audit_sans_publication')
    def test_rollback_refuse_un_pointeur_modifie_par_un_tiers(self):
        p=m.Publication.__new__(m.Publication);p.infos={'demo':{'root':'/sans-acces','ancien':'releases/avant','candidate':'apres'}};p.rapport={'environnements':{'demo':{}}}
        p.run=lambda *a,**k:self.fail('Ne pas basculer après une modification tierce')
        with patch.object(m,'courant',return_value='releases/tiers'):
            with self.assertRaises(m.Refus):p.revenir('demo')

if __name__=='__main__':unittest.main()

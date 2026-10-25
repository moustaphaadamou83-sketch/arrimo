"""Garde-fous de publication : fichiers temporaires et services simulés, aucune base publique."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('publication',ROOT/'scripts/publication-arrimo.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class Politiques(unittest.TestCase):
    def test_preuves_reelles_archivees_valides(self):
        self.assertEqual(m.verifier_preuves()['commit'],m.CANDIDAT)

    def test_journal_altere_refuse(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);p=root/'docs/preuves-recette-validee-20261025'
            shutil.copytree(ROOT/'docs/preuves-recette-validee-20261025',p)
            with (p/'api.log').open('a') as f:f.write('modification')
            with self.assertRaises(m.Refus):m.verifier_preuves(root)

    def test_liste_de_suites_dupliquee_refusee(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);p=root/'docs/preuves-recette-validee-20261025'
            shutil.copytree(ROOT/'docs/preuves-recette-validee-20261025',p)
            r=json.loads((p/'resume.json').read_text());r['suites'].append(r['suites'][0]);(p/'resume.json').write_text(json.dumps(r))
            with self.assertRaises(m.Refus):m.verifier_preuves(root)

    def test_url_distante_refusee(self):
        with self.assertRaises(m.Refus):m.cible_pg('postgresql://u@db.example/hopital')

    def test_hote_injecte_refuse(self):
        with self.assertRaises(m.Refus):m.cible_pg('postgresql:///arrimo?host=db.example')

    def test_options_redirection_refusees(self):
        for param in ['options=-csearch_path%3Dpublic','database=autre','host=localhost&host=db.example']:
            with self.assertRaises(m.Refus):m.cible_pg('postgresql:///arrimo?'+param)

    def test_local_et_socket_connus_acceptes(self):
        self.assertEqual(m.cible_pg('postgresql://u@127.0.0.1/arrimo'), 'arrimo')
        self.assertEqual(m.cible_pg('postgresql:///postgres?host=/var/run/postgresql'),'postgres')

    def test_url_copie_conserve_identifiants_et_socket(self):
        self.assertEqual(m.url_copie('postgresql://u:p@localhost/source?host=/var/run/postgresql','arrimo_publication_restore_demo_abc'),
                         'postgresql://u:p@localhost/arrimo_publication_restore_demo_abc?host=/var/run/postgresql')

    def test_url_copie_nom_public_refuse(self):
        with self.assertRaises(m.Refus):m.url_copie('postgresql:///source','arrimo')

    def test_env_secret_litteral_non_execute(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'env';p.write_text("A='mot # privé'\nB=secret#suffixe\nC=valeur # commentaire\nD=\n")
            self.assertEqual(m.lire_env(p),{'A':'mot # privé','B':'secret#suffixe','C':'valeur','D':''})

    def test_env_substitution_refusee(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'env'
            for expression in ['A=$(id)','A=`id`','A=${HOME}']:
                p.write_text(expression)
                with self.assertRaises(m.Refus):m.lire_env(p)

    def test_current_hors_releases_refuse(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);(p/'ailleurs').mkdir();(p/'current').symlink_to('ailleurs')
            with self.assertRaises(m.Refus):m.cible_lien(p)

    def test_release_symlink_refusee(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);(p/'releases').mkdir();(p/'ailleurs').mkdir();(p/'releases/r').symlink_to(p/'ailleurs');(p/'current').symlink_to('releases/r')
            with self.assertRaises(m.Refus):m.cible_lien(p)

    def test_current_relativement_valide(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);(p/'releases/r').mkdir(parents=True);(p/'current').symlink_to('releases/r')
            self.assertEqual(m.cible_lien(p),'releases/r')


class FaussePublication(m.Publication):
    def __init__(self, root, panne=None):
        super().__init__(Path(root)/'preuve')
        self.app=Path(root)/'app';(self.app/'releases/ancienne').mkdir(parents=True);(self.app/('releases/arrimo-'+m.CANDIDAT)).mkdir()
        (self.app/'current').symlink_to('releases/ancienne')
        self.infos={'demo':{'root':self.app,'actuel':'releases/ancienne','service':'demo-factice','port':39999,'role':'role_fictif'}}
        self.etat['environnements']={'demo':{'changement_necessaire':True,'publie':False}}
        self.preparees={'demo':{'preuves':{'restauration':True,'migration_copie':True,'ancien_code':True}}}
        self.envs={'demo':{}};self.code=Path(root);self.appels=[];self.panne=panne
    def preparer_release(self,t):self.appels.append('preparer');return 'arrimo-'+m.CANDIDAT
    def commande(self,nom,argv,**kw):
        self.appels.append(nom)
        if nom.startswith(('activer-','rollback-')):
            (self.app/'current').unlink();(self.app/'current').symlink_to('releases/'+argv[4])
        return b''
    def pg(self,nom,*a,**kw):
        self.appels.append(nom)
        if self.panne=='migration':raise m.Refus('échec migration simulé')
        return {}
    def controle_public(self,t):
        self.appels.append('verification-publique')
        if self.panne=='public':raise m.Refus('échec HTTPS simulé')
        if self.panne=='interruption':raise KeyboardInterrupt()
        return {'sante':{'base':'ok'}}
    def version(self,p):return p.name
    def sante(self,t):return {'base':'ok'}


class RetoursArriere(unittest.TestCase):
    def test_aucune_bascule_sans_restauration_verifiee(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=FaussePublication(tmp);p.preparees['demo']['preuves']['restauration']=False
            with self.assertRaises(m.Refus):p.deployer('demo')
            self.assertEqual(p.appels,[])
            self.assertEqual(m.cible_lien(p.app),'releases/ancienne')

    def test_echec_migration_redemarre_ancien_code_sans_restaurer_base(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=FaussePublication(tmp,'migration')
            with self.assertRaises(m.Refus):p.deployer('demo')
            self.assertEqual(m.cible_lien(p.app),'releases/ancienne')
            self.assertIn('redemarrer-ancienne-demo',p.appels)
            self.assertNotIn('activer-demo',p.appels)
            self.assertFalse(p.etat['environnements']['demo']['publie'])

    def test_echec_public_revient_exactement_a_ancienne_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=FaussePublication(tmp,'public')
            with self.assertRaises(m.Refus):p.deployer('demo')
            self.assertEqual(m.cible_lien(p.app),'releases/ancienne')
            self.assertIn('rollback-demo',p.appels)
            self.assertEqual(p.etat['publication_verifiee'],[])

    def test_interruption_pendant_controle_provoque_rollback(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=FaussePublication(tmp,'interruption')
            with self.assertRaises(KeyboardInterrupt):p.deployer('demo')
            self.assertEqual(m.cible_lien(p.app),'releases/ancienne')

    def test_publication_declaree_seulement_apres_controles(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=FaussePublication(tmp);p.deployer('demo')
            self.assertEqual(p.appels,['preparer','arreter-demo','migration-publique-demo','activer-demo','verification-publique'])
            self.assertEqual(p.etat['publication_verifiee'],['demo'])
            self.assertTrue(p.etat['environnements']['demo']['publie'])

    def test_modification_du_pointeur_par_tiers_refuse_la_bascule(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=FaussePublication(tmp);(p.app/'releases/autre').mkdir();(p.app/'current').unlink();(p.app/'current').symlink_to('releases/autre')
            with self.assertRaises(m.Refus):p.deployer('demo')
            self.assertEqual(p.appels,[])

    def test_arret_pipeline_avant_principal_si_demo_echoue(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=m.Publication(Path(tmp)/'test');appels=[]
            for methode in ['inventaire','authentifier','verifier_acces_navigateurs','preparer_code']:
                setattr(p,methode,lambda x=methode:appels.append(x))
            p.sauvegarder_et_restaurer=lambda t:appels.append('copie-'+t)
            p.commande=lambda *a,**kw:b''
            def deployer(t):appels.append('deployer-'+t);raise m.Refus('demo refusee')
            p.deployer=deployer
            with self.assertRaises(m.Refus):p.executer()
            self.assertEqual(appels[-4:],['copie-demo','copie-principal','copie-sh','deployer-demo'])
            self.assertNotIn('deployer-principal',appels)


if __name__=='__main__':unittest.main()

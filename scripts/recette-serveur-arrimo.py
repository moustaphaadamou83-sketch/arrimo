#!/usr/bin/env python3
"""Recette réelle sur serveur autorisé : application copiée, bases neuves, zéro publication."""
import argparse
import datetime
import hashlib
import io
import json
import os
import pathlib
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import urllib.parse

RACINE = pathlib.Path(__file__).resolve().parent.parent


def configuration_pg(valeur):
    u = urllib.parse.urlsplit(valeur)
    q = urllib.parse.parse_qs(u.query, strict_parsing=True)
    if u.scheme not in ('postgres', 'postgresql') or u.hostname not in (None, 'localhost', '127.0.0.1') or u.path not in ('/postgres', '/template1'):
        raise ValueError('URL PostgreSQL locale de maintenance requise ; aucune base applicative acceptée')
    if set(q) - {'host', 'sslmode', 'application_name'} or any(len(v) != 1 for v in q.values()):
        raise ValueError('Paramètres de connexion PostgreSQL refusés')
    host = q.get('host', [u.hostname or '/var/run/postgresql'])[0]
    if host not in ('localhost', '127.0.0.1') and not re.match(r'^/(var/run/postgresql|tmp|root)(/|$)', host):
        raise ValueError('Socket local requis')
    return u, q, host


def url_base_isolee(u, q, host, nom):
    if not re.fullmatch(r'arrimo_[a-z0-9_]{1,55}', nom):
        raise ValueError('Nom de base de recette invalide')
    # Les suites A/B/C exigent un hostname local explicite. Le paramètre host
    # conserve la connexion UNIX réellement sélectionnée, sans passer en TCP.
    parametres = {cle: valeurs[0] for cle, valeurs in q.items()}
    parametres['host'] = host
    return u.scheme + '://' + (u.netloc or 'localhost') + '/' + nom + '?' + urllib.parse.urlencode(parametres)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sortie', required=True, type=pathlib.Path)
    parser.add_argument('--reference', default='2ed912745f6338e185c8c31bd0cb97385a9fce1d')
    args = parser.parse_args()
    # Authentification locale existante par défaut ; aucun compte ni droit créé.
    # Une URL protégée explicite permet de sélectionner un rôle déjà autorisé.
    valeur = os.environ.get('ARRIMO_RECETTE_ADMIN_URL') or 'postgresql:///postgres?host=/var/run/postgresql'
    u, q, host = configuration_pg(valeur)
    for commande in ('node', 'git', 'psql', 'pg_dump', 'pg_restore'):
        if not shutil.which(commande):
            raise ValueError('Prérequis absent : ' + commande)
    if subprocess.run(['git', 'status', '--porcelain'], cwd=RACINE, capture_output=True, check=True).stdout.strip():
        raise ValueError('Dépôt non propre : aucune recette d’un autre code que le commit courant')
    sortie = args.sortie.resolve()
    sortie.mkdir(parents=True, exist_ok=False)
    sortie.chmod(0o700)
    rapport = {'date': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'statut': 'en_cours',
               'application_isolee': str(sortie / 'application'), 'bases_creees': [], 'etapes': [],
               'sauvegarde_fictive_restauree': False, 'copie_isolee_validee': False,
               'publication_effectuee': False, 'migration_publique_effectuee': False}
    secret = urllib.parse.unquote(u.password or '')

    def sauver():
        (sortie / 'rapport.json').write_text(json.dumps(rapport, ensure_ascii=False, indent=2) + '\n')

    def executer(nom, argv, env=None, cwd=None, entree=None, timeout=1800):
        try:
            r = subprocess.run(argv, input=entree, env=env, cwd=cwd, capture_output=True, timeout=timeout)
            texte = (r.stdout + r.stderr).decode(errors='replace')
            for interdit in (valeur, secret, urllib.parse.quote(secret, safe='') if secret else ''):
                if interdit:
                    texte = texte.replace(interdit, '[SECRET MASQUÉ]')
            (sortie / f'{nom}.log').write_text(texte)
            ok = r.returncode == 0
            rapport['etapes'].append({'nom': nom, 'sortie': r.returncode, 'reussi': ok})
            sauver()
            print(nom, 'RÉUSSI' if ok else 'ÉCHEC', flush=True)
            return ok, r.stdout
        except subprocess.TimeoutExpired:
            rapport['etapes'].append({'nom': nom, 'reussi': False, 'cause': 'timeout'}); sauver()
            print(nom, 'TIMEOUT', flush=True)
            return False, b''

    pg_env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    pg_env.update({'PGHOST': host, 'PGDATABASE': u.path[1:], 'PGCONNECT_TIMEOUT': '10', 'PGAPPNAME': 'arrimo-recette-isolee'})
    if u.username:
        pg_env['PGUSER'] = urllib.parse.unquote(u.username)
    if secret:
        pg_env['PGPASSWORD'] = secret
    if u.port:
        pg_env['PGPORT'] = str(u.port)
    if 'sslmode' in q:
        pg_env['PGSSLMODE'] = q['sslmode'][0]
    permises = {'PATH','HOME','USER','LOGNAME','LANG','LC_ALL','TZ','TMPDIR','NODE_PATH','PLAYWRIGHT_BROWSERS_PATH'}
    test_env = {k: v for k, v in os.environ.items() if k in permises}
    test_env.update({'ARRIMO_ENV': 'demo', 'ARRIMO_DEMO': '1'})
    nom_session = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S') + '_' + secrets.token_hex(3)

    def url_base(nom):
        return url_base_isolee(u, q, host, nom)

    def creer(prefixe):
        nom = prefixe + nom_session
        if not re.fullmatch(r'arrimo_[a-z0-9_]{1,55}', nom):
            raise ValueError('Nom de base généré invalide')
        ok, _ = executer('creer-' + prefixe.rstrip('_'), ['psql', '-X', '-w', '-v', 'ON_ERROR_STOP=1', '-c', f'CREATE DATABASE "{nom}"'], env=pg_env)
        if not ok:
            raise RuntimeError('Création de base dédiée refusée ; aucun droit serveur modifié')
        rapport['bases_creees'].append(nom); sauver()
        return nom

    try:
        rapport['commit'] = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=RACINE, capture_output=True, check=True).stdout.decode().strip()
        archive = subprocess.run(['git', 'archive', '--format=tar', 'HEAD'], cwd=RACINE, capture_output=True, check=True).stdout
        application = sortie / 'application'; application.mkdir()
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(application, filter='data')
        dependances = RACINE / 'node_modules'
        if not dependances.is_dir():
            raise ValueError('Dépendances absentes : installation isolée selon package-lock.json requise')
        (application / 'node_modules').symlink_to(dependances.resolve(), target_is_directory=True)
        for nom, argv in [('runtime-node', ['node', '-e', 'if(Number(process.versions.node.split(".")[0])!==24)process.exit(1);console.log(process.version)']),
                          ('runtime-ipc', ['node', 'scripts/verifier-runtime-tests.cjs']),
                          ('runtime-chromium', ['node', '-e', 'const p=require("playwright");p.chromium.launch({headless:true}).then(async b=>{console.log(require("playwright/package.json").version);await b.close()}).catch(e=>{console.error(e.message);process.exitCode=1})'])]:
            ok, _ = executer(nom, argv, env=test_env, cwd=application)
            if not ok:
                raise RuntimeError('Runtime non autorisé ou incomplet : aucune base créée')
        ok, _ = executer('postgres-maintenance', ['psql', '-X', '-w', '-v', 'ON_ERROR_STOP=1', '-Atc', 'SELECT current_database(),current_user,version()'], env=pg_env)
        if not ok:
            raise RuntimeError('Connexion PostgreSQL refusée ; configuration serveur préservée')
        source = creer('arrimo_recette_source_')
        ancien = subprocess.run(['git', 'show', args.reference + ':db/schema.sql'], cwd=RACINE, capture_output=True, check=True).stdout
        (sortie / 'schema-reference.sql').write_bytes(ancien)
        e = dict(test_env, ARRIMO_FIXTURE_DATABASE_URL=url_base(source), ARRIMO_FIXTURE_SCHEMA=str(sortie / 'schema-reference.sql'))
        ok, _ = executer('preparer-fictif-ancien-schema', ['node', 'scripts/preparer-base-fictive.cjs'], env=e, cwd=application)
        if not ok:
            raise RuntimeError('Préparation fictive échouée')
        dump = sortie / 'copie-fictive.dump'
        ok, _ = executer('sauvegarde-fictive', ['pg_dump', '-w', '--format=custom', '--file=' + str(dump), '--dbname=' + source], env=pg_env)
        if not ok:
            raise RuntimeError('Sauvegarde fictive échouée')
        rapport['sauvegarde_sha256'] = hashlib.sha256(dump.read_bytes()).hexdigest()
        ok, _ = executer('lecture-sauvegarde', ['pg_restore', '--list', str(dump)], env=pg_env)
        if not ok:
            raise RuntimeError('Sauvegarde illisible')
        restauree = creer('arrimo_vnext_restore_')
        ok, _ = executer('restauration-fictive', ['pg_restore', '-w', '--exit-on-error', '--no-owner', '--no-acl', '--dbname=' + restauree, str(dump)], env=pg_env)
        if not ok:
            raise RuntimeError('Restauration sur base neuve échouée')
        # Même contenu et multiplicité, sans sortir les lignes pseudonymisées ni les hashes de comptes.
        tables = ['etablissements','utilisateurs','utilisateur_etablissements','lits','civieres','demandes_admission','transferts','journal','patients','conges']
        sql = ' UNION ALL '.join(f"SELECT '{t}',count(*)::text,md5(COALESCE(string_agg(md5(row_to_json(x)::text),'' ORDER BY md5(row_to_json(x)::text)),'')) FROM {t} x" for t in tables)
        traces = []
        for label, nom in [('source', source), ('restauree', restauree)]:
            ok, empreintes = executer('empreintes-' + label, ['psql', '-X', '-w', '-v', 'ON_ERROR_STOP=1', '--dbname=' + nom, '-Atc', sql], env=pg_env)
            if not ok:
                raise RuntimeError('Empreinte de restauration non vérifiée')
            traces.append(empreintes)
        if traces[0] != traces[1]:
            raise RuntimeError('Le contenu restauré ne correspond pas à la source fictive')
        rapport['sauvegarde_fictive_restauree'] = True; sauver()
        ok, _ = executer('migrations-copie-restauree', ['node', 'scripts/verifier-migration-priorites.cjs'],
                         env=dict(test_env, ARRIMO_RESTORE_DATABASE_URL=url_base(restauree)), cwd=application)
        if not ok:
            raise RuntimeError('Migration refusée : aucune publication admissible')
        suites = [
            ('api', 'arrimo_test_', 'TEST_DATABASE_URL', ['tests/api.test.js','tests/finalisation.test.cjs']),
            ('priorites-sql', 'arrimo_vnext_test_', 'PRIORITES_TEST_DATABASE_URL', ['tests/priorites-postgres.test.cjs']),
            ('interop-sql', 'arrimo_simulation_test_', 'SIMULATION_TEST_DATABASE_URL', ['tests/simulation-postgres.test.cjs']),
            ('securite-multietablissement', 'arrimo_audit_multi_', 'AUDIT_DATABASE_URL', ['tests/audit-multi-etab.test.cjs']),
            ('scenarios-abc', 'arrimo_demo_trio_scenarios_', 'TRIO_TEST_DATABASE_URL', ['tests/scenarios-abc.test.cjs']),
            ('dashboards-abc-reseau', 'arrimo_demo_trio_ui_', 'TRIO_TEST_DATABASE_URL', ['tests/demo-trio.test.cjs']),
            ('interface-parcours', 'arrimo_interface_', 'TEST_DATABASE_URL', ['tests/interface.spec.js']),
            ('priorites-navigateur', 'arrimo_vnext_ui_test_', 'PRIORITES_UI_DATABASE_URL', ['tests/priorites.interface.spec.cjs']),
            ('structure-navigateur', 'arrimo_demo_trio_structure_', 'STRUCTURE_DATABASE_URL', ['tests/structure-ui.spec.cjs']),
            ('sh-erp', 'arrimo_sh_test_', 'TEST_DATABASE_URL', ['tests/sh-erp.test.cjs']),
            ('sh-navigateur', 'arrimo_sh_ui_test_', 'TEST_DATABASE_URL', ['tests/sh-erp.interface.spec.cjs']),
            ('securite-xss', 'arrimo_audit_xss_', 'AUDIT_DATABASE_URL', ['tests/audit-xss.spec.cjs']),
        ]
        valides = True
        for nom, prefixe, variable, fichiers in suites:
            try:
                base = creer(prefixe)
                ok, texte = executer(nom, ['node','--test','--test-concurrency=1','--test-reporter=tap', *fichiers],
                                     env=dict(test_env, **{variable: url_base(base)}), cwd=application)
                # Une suite ignorée, vide ou dont le runner ne rapporte rien n'est jamais verte.
                compte = re.search(rb'^# tests (\d+)\s*$', texte, re.M)
                ignores = re.search(rb'^# skipped (\d+)\s*$', texte, re.M)
                fichier_sans_tests = re.search(rb'^# Subtest: tests/[^\n ]+\.(?:js|cjs)\s*$', texte, re.M)
                if not ok or not compte or int(compte[1]) < 1 or not ignores or int(ignores[1]) != 0 or fichier_sans_tests:
                    valides = False
                    rapport['etapes'][-1]['reussi'] = False
                    rapport['etapes'][-1]['cause'] = 'échec, tests absents ou tests ignorés'
                sauver()
            except Exception:
                valides = False
                rapport['etapes'].append({'nom': nom, 'reussi': False, 'cause': 'préparation isolée échouée'}); sauver()
        rapport['copie_isolee_validee'] = valides
        rapport['statut'] = 'copie_validee' if valides else 'recette_incomplete'
        sauver()
        return 0 if valides else 1
    except Exception as e:
        # Aucun détail de connexion ni secret dans le bilan.
        rapport['statut'] = 'bloque'; rapport['blocage'] = str(e) if isinstance(e, (ValueError, RuntimeError)) else type(e).__name__
        sauver(); print('Recette interrompue. Voir rapport.json ; aucune publication effectuée.', flush=True)
        return 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError) as e:
        print('Recette non exécutée : ' + str(e), file=sys.stderr)
        sys.exit(1)

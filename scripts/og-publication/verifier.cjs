'use strict';
// Entrée privée sur stdin ; ne jamais imprimer réponses patient, URL SQL ou jetons.
const assert = require('node:assert/strict');
const path = require('node:path');
async function verifier(p) {
  let etape = 'connexion_sql', compteCourant = 'aucun';
  const { Pool } = require(path.join(p.code, 'node_modules/pg'));
  const db = new Pool({ connectionString: p.url, max: 2, connectionTimeoutMillis: 10000, options: '-c default_transaction_read_only=on' });
  let serveur;
  try {
    assert.equal((await db.query('SELECT current_database() AS nom')).rows[0].nom, p.nom);
    let base = p.base;
    if (p.copie) {
      assert.match(p.nom, /^(?:arrimo_publication_restore_og_[a-z0-9_]+|arrimo_og_test_[a-f0-9]+)$/);
      process.env.ARRIMO_ENV = 'demo'; process.env.ARRIMO_DEMO = '1';
      delete process.env.COPILOTE_IA_CLE;
      serveur = await require(path.join(p.code, 'tests/serveur-test.cjs')).demarrerServeur(require(path.join(p.code, 'src/app')).creerApp(db));
      base = 'http://127.0.0.1:' + serveur.address().port;
    } else assert.ok(base.startsWith('https://'));
    const controles = [];
    for (const compte of p.comptes) {
      compteCourant = /^(?:[abc]|reseau)$/.test(compte.nom) ? compte.nom : 'invalide';
      etape = 'identite';
      const headers = { Authorization: 'Bearer ' + compte.token, 'Content-Type': 'application/json' };
      async function api(chemin, corps, attendu = 200) {
        const r = await fetch(base + '/api' + chemin, { headers, method: corps ? 'POST' : 'GET', body: corps ? JSON.stringify(corps) : undefined, redirect: 'error', signal: AbortSignal.timeout(60000) });
        assert.equal(r.status, attendu, 'Statut API inattendu : ' + chemin.split('?')[0]);
        return r.json();
      }
      const moi = await api('/moi');
      assert.equal(moi.environnement, 'demo'); assert.equal(moi.demo, true);
      assert.equal(moi.utilisateur.mdp_temporaire, false);
      const attendu = compte.code;
      const e = moi.etablissements.find(x => x.code === attendu);
      assert.ok(e, 'Établissement attendu absent du compte ' + compte.nom);
      const regional = compte.nom === 'reseau';
      if (regional) {
        assert.equal(moi.utilisateur.gestionnaire, true);
        assert.equal(moi.utilisateur.role, 'gestionnaire');
        const autorises = (await db.query('SELECT id FROM etablissements WHERE actif ORDER BY id')).rows.map(x => x.id);
        assert.deepEqual(moi.etablissements.map(x => x.id).sort((a,b)=>a-b), autorises);
      } else {
        assert.equal(moi.utilisateur.gestionnaire, false, 'Compte hospitalier dédié requis');
        assert.equal(moi.etablissements.length, 1, 'Un seul établissement par compte hospitalier');
      }
      const question = async texte => {
        const r = await api('/copilote/question', { etablissement_id: e.id, question: texte });
        assert.equal(r.moteur, 'og-outils'); assert.ok(r.sources?.length);
        assert.ok(r.sources.every(x => Number.isFinite(Date.parse(x.lu_le))));
        return r;
      };
      const resultat = { compte: compte.nom, etablissement_code: attendu, tests: [] };
      if (p.suivi_reel) {
        etape='suivi_tr00067';
        const tr=(await db.query(`SELECT t.*,l.code,l.etat,l.patient_ref AS ref_lit,l.transfert_id AS lien_lit,u.nom AS service,ch.numero AS chambre
          FROM transferts t LEFT JOIN lits l ON l.id=t.lit_id LEFT JOIN unites u ON u.id=l.unite_id LEFT JOIN chambres ch ON ch.id=l.chambre_id
          WHERE t.numero='TR-00067' AND t.patient_ref='P-43267'`)).rows[0];
        assert.ok(tr,'Transfert fictif témoin absent');
        const autorise=regional || [tr.origine_id,tr.destination_id].includes(e.id);
        for (const question of ['P-43267','Patient P-43267','Où se trouve actuellement le patient P-43267 ?','Quel lit occupe P-43267 ?', 'Patient P-43267 : établissement, service, chambre, lit, admission et transfert ?', 'Suivi du transfert TR-00067']) {
          const r=await api('/copilote/question',{etablissement_id:e.id,question});assert.equal(r.moteur,'og-outils');
          if (autorise) {
            assert.ok(r.reponse.includes('TR-00067'));assert.match(r.reponse,/Statut du transfert : Reçu/);
            if (tr.lien_lit===tr.id && tr.ref_lit===tr.patient_ref && tr.etat==='occupe') {
              assert.ok(r.reponse.includes(tr.code));assert.ok(r.reponse.includes(tr.service));assert.ok(r.reponse.includes('chambre '+tr.chambre));assert.match(r.reponse,/Situation actuelle vérifiée : admis/);
            } else assert.match(r.reponse,/Dernière situation connue/);
            assert.match(r.reponse,/n’occupe plus la civière URG-02/);
            assert.ok(r.sources.every(x=>Number.isFinite(Date.parse(x.lu_le))));
          } else assert.doesNotMatch(r.reponse,/SI-108|URG-02|Statut du transfert|Val-des-Pins|Sainte-Aurore/);
        }
        resultat.suivi_tr00067={autorise,verifie:true,patient:'P-43267',transfert:'TR-00067',statut:autorise?tr.statut:'aucun_detail_divulgue'};
        resultat.tests.push(autorise?'suivi_interhospitalier_reel_compare_sql':'confidentialite_suivi_interhospitalier');
        const capacites=await api('/copilote/question',{etablissement_id:e.id,question:'Cherche un lit disponible de soins intensifs pour P-43267'});
        assert.equal(capacites.moteur,'og-outils');assert.ok(capacites.intentions.includes('pourquoi'));
        assert.match(capacites.reponse,/ne réserve aucun lit/);assert.match(capacites.reponse,/revérifiée avant réservation/);
        resultat.tests.push('recherche_interhospitaliere_sans_action_automatique');
      }
      etape = 'patient_individuel';
      // Patient réel de la copie ou de la Démo, sans supposer qu'il est toujours à son ancienne place.
      const temoin = (await db.query("SELECT patient_ref, code, etat FROM lits WHERE etablissement_id=$1 AND etat='occupe' AND patient_ref IS NOT NULL ORDER BY (patient_ref='P-01004') DESC,id LIMIT 1", [e.id])).rows[0];
      const litTemoin = temoin || (await db.query('SELECT code FROM lits WHERE etablissement_id=$1 ORDER BY id LIMIT 1', [e.id])).rows[0];
      assert.ok(litTemoin, 'Aucun lit témoin');
      const reference = temoin ? temoin.patient_ref : 'P-999999999999';
      let questionTemoin=`Quel est le statut actuel du patient ${reference} ?`;
      let r1 = await question(questionTemoin);
      if (temoin && /ambiguë/.test(r1.reponse)) {
        const identite=(await db.query(`SELECT t.numero FROM transferts t JOIN lits l ON l.id=t.lit_id AND l.transfert_id=t.id
          WHERE t.patient_ref=$1 AND l.code=$2 AND l.etablissement_id=$3 AND l.etat='occupe' AND (t.origine_id=$3 OR t.destination_id=$3)`,[reference,temoin.code,e.id])).rows;
        assert.equal(identite.length,1,'Témoin ambigu sans transfert unique lié au lit');
        resultat.tests.push('reference_ambigue_precision_par_transfert');
        questionTemoin='Suivi du transfert '+identite[0].numero;r1=await question(questionTemoin);
      }
      assert.ok(r1.reponse.includes(reference));
      if (temoin) {
        assert.ok(r1.reponse.includes(temoin.code)); assert.match(r1.reponse, /admis/);
      } else {
        // Un établissement sans lit occupé est valide : ne jamais fabriquer un patient.
        const actifs = (await db.query("SELECT code,etat FROM lits WHERE etablissement_id=$1 AND patient_ref=$2 AND etat IN ('occupe','reserve')", [e.id,reference])).rows;
        if (actifs.length) {
          assert.ok(actifs.some(x => r1.reponse.includes(x.code)));
          assert.match(r1.reponse, /lit réservé, admission à confirmer/);
        } else assert.match(r1.reponse, /Aucune situation active accessible|Aucun lit occupé ou réservé enregistré ici/);
        resultat.patient_sans_lit_occupe = 'absence_ou_reservation_comparee_sql';
      }
      resultat.tests.push('patient_individuel_compare_sql');
      etape = 'patient_p01004';
      const p01004 = (await db.query("SELECT code,etat FROM lits WHERE etablissement_id=$1 AND patient_ref='P-01004' AND etat IN ('occupe','reserve')", [e.id])).rows;
      if (p01004.length) {
        const r = await question('Quel est le statut actuel du patient P-01004 ?');
        assert.ok(p01004.some(x => r.reponse.includes(x.code)));
        resultat.patient_p01004 = 'verifie_sur_etat_courant';
      } else resultat.patient_p01004 = 'absent_des_lits_actifs_de_ce_compte';
      const types = (await db.query("SELECT t.id,t.nom,t.code FROM types_unite t WHERE t.config_id=$1 AND EXISTS(SELECT 1 FROM lits l WHERE l.etablissement_id=$2 AND l.type_id=t.id) ORDER BY (t.code='MED') DESC,t.ordre LIMIT 1", [e.config_id,e.id])).rows;
      etape = 'lits_occupes';
      assert.ok(types.length, 'Type d’unité absent');
      const ty = types[0];
      const n = (await db.query("SELECT count(*)::int AS n FROM lits WHERE etablissement_id=$1 AND type_id=$2 AND etat='occupe'", [e.id,ty.id])).rows[0].n;
      const r2 = await question(`Combien de lits de ${ty.nom} sont occupés ?`);
      assert.ok(r2.intentions.includes('lits_occupes')); assert.ok(r2.reponse.includes(`: ${n}.`));
      resultat.tests.push('lits_occupes_compares_sql');
      etape = 'attribution_locale';
      const r3 = await question(`Pourquoi ${litTemoin.code} a-t-il été proposé ?`);
      assert.deepEqual(r3.intentions, ['attribution_locale']); assert.ok(r3.reponse.includes(litTemoin.code));
      assert.ok(/critères historiques|Proposition locale actuelle/.test(r3.reponse));
      resultat.tests.push('explication_locale_et_limites');
      etape = 'transferts';
      const r4 = await question('Quels transferts sont actuellement en cours ?');
      const trs = (await db.query("SELECT numero,statut FROM transferts WHERE origine_id=$1 OR destination_id=$1", [e.id])).rows;
      for (const tr of trs) {
        const visible = r4.reponse.includes(tr.numero);
        assert.equal(visible, ['validee','transport','en_route'].includes(tr.statut), 'Filtre de statut transfert incorrect');
      }
      resultat.tests.push('transferts_compares_sql');
      etape = 'civieres';
      const r5 = await question('Quelles civières sont occupées depuis plus de quatre heures ?');
      const cvs = (await db.query("SELECT code,etat,EXTRACT(EPOCH FROM(now()-arrivee_le))/3600 AS heures FROM civieres WHERE etablissement_id=$1", [e.id])).rows;
      const longs = cvs.filter(x => x.etat === 'occupee' && Number(x.heures) > 4).sort((a,b) => Number(b.heures)-Number(a.heures));
      for (const cv of longs.slice(0,15)) assert.ok(r5.reponse.includes(cv.code), 'Civière au-delà du seuil absente');
      for (const cv of cvs.filter(x => x.etat !== 'occupee' || Number(x.heures) < 3.9)) assert.ok(!r5.reponse.includes('• '+cv.code+' '));
      assert.match(r5.reponse, /ne mesure pas la gravité/);
      resultat.tests.push('civieres_et_absence_de_triage_autonome');
      etape = 'procedure';
      const r6 = await question('Quelle est la prochaine étape après l’organisation d’un transport ?');
      assert.deepEqual(r6.intentions, ['procedure']); assert.match(r6.reponse, /départ réel/); assert.match(r6.reponse, /réception/);
      resultat.tests.push('procedure_transport');
      etape = 'permissions';
      const autre = (await db.query('SELECT id FROM etablissements WHERE actif AND id<>$1 ORDER BY id LIMIT 1', [e.id])).rows[0];
      assert.ok(autre, 'Autre établissement requis pour le contrôle d’isolation');
      await api('/copilote/question', { etablissement_id: autre.id, question:'Quel est le statut actuel du patient P-01004 ?' }, regional ? 200 : 403);
      await api('/lits?etablissement_id='+autre.id, null, regional ? 200 : 403);
      if (regional) {
        for (const etab of moi.etablissements.filter(x => x.module_actif)) {
          const n = (await db.query("SELECT count(*)::int AS n FROM lits WHERE etablissement_id=$1 AND etat='occupe'", [etab.id])).rows[0].n;
          const r = await api('/copilote/question', {etablissement_id:etab.id,question:'Combien de lits sont occupés ?'});
          assert.equal(r.moteur,'og-outils'); assert.ok(r.reponse.includes(`: ${n}.`));
        }
        resultat.tests.push('coordination_regionale_perimetre_compare_sql');
      }
      resultat.tests.push('permissions_patient_et_lits');
      if (!p.copie) {
        etape = 'navigateur';
        const { chromium } = require(path.join(p.code, 'node_modules/playwright'));
        const browser = await chromium.launch({headless:true});
        try {
          const ctx = await browser.newContext(); const page = await ctx.newPage(); const erreurs = [];
          page.on('pageerror', () => erreurs.push('javascript'));
          await page.addInitScript(p => { localStorage.setItem('arrimo-token', p.token); localStorage.setItem('arrimo-ctx', String(p.etab)); localStorage.setItem('arrimo-langue','fr'); }, {token:compte.token,etab:e.id});
          await page.goto(base, {waitUntil:'domcontentloaded',timeout:60000});
          await page.waitForSelector('body[data-pret="1"]', {timeout:60000});
          if (await page.locator('#b-premiers-pas-ok').isVisible()) await page.click('#b-premiers-pas-ok');
          await page.click('#og-open'); await page.waitForSelector('#og-panel[open]');
          await page.fill('#og-question', questionTemoin);
          await page.click('#og-envoyer');
          await page.waitForFunction(attendu => [...document.querySelectorAll('#og-messages .og-message:not(.utilisateur)')].some(x => {
            const texte = x.textContent;
            return texte.includes(attendu.reference) && (attendu.code
              ? texte.includes(attendu.code) && texte.includes('admis')
              : /Aucune situation active accessible|Aucun lit occupé ou réservé enregistré ici|lit réservé, admission à confirmer/.test(texte));
          }), {reference, code:temoin?.code}, {timeout:60000});
          if (p.suivi_reel) {
            await page.fill('#og-question','Où se trouve actuellement le patient P-43267 ?');
            const reponse=page.waitForResponse(r=>r.url().endsWith('/api/copilote/question') && r.request().method()==='POST');
            await page.click('#og-envoyer');const r=await reponse;assert.equal(r.status(),200);const j=await r.json();
            if (compte.nom==='b') assert.doesNotMatch(j.reponse,/SI-108|URG-02|Statut du transfert/);
            else {assert.match(j.reponse,/TR-00067/);assert.match(j.reponse,/n’occupe plus la civière URG-02/);}
            await page.waitForFunction(()=>!document.querySelector('#og-envoyer').disabled);
            resultat.tests.push('navigateur_suivi_patient_transfere');
            if (compte.nom!=='b') {
              await page.click('#og-close');await page.click('#onglets button[data-v="transferts"]');
              await page.waitForSelector('#v-transferts .kanban');
              for (let tentative=0;tentative<20;tentative++) {
                if (await page.locator('#v-transferts .fiche').filter({hasText:'TR-00067'}).count()) break;
                if (await page.locator('#v-transferts [data-tout-termines]').count()) await page.locator('#v-transferts [data-tout-termines]').first().click();
                else if (await page.locator('#v-transferts [data-plus="transferts"]').count()) await page.locator('#v-transferts [data-plus="transferts"]').click();
                else break;
              }
              const fiche=page.locator('#v-transferts .fiche').filter({hasText:'TR-00067'});await fiche.waitFor();
              const texte=await fiche.textContent();
              assert.match(texte,/Trajet routier estimé/);assert.match(texte,/Temps écoulé depuis la création/);assert.match(texte,/Durée réelle du transport/);
              assert.match(texte,/11\s*min/);resultat.tests.push('navigateur_trois_temps_transport_11_minutes');
            }
          }
          assert.deepEqual(erreurs, []); await ctx.close(); resultat.tests.push('navigateur_panneau_og');
        } finally { await browser.close(); }
      }
      controles.push(resultat);
    }
    return { valide:true, controles };
  } catch (e) {
    e.diagnosticOg = `compte=${compteCourant} etape=${etape}`;
    throw e;
  } finally { if (serveur) await new Promise(r => serveur.close(r)); await db.end(); }
}
if (require.main === module) {
  let entree=''; process.stdin.on('data', b => entree+=b);
  process.stdin.on('end', () => Promise.resolve().then(() => verifier(JSON.parse(entree))).then(r => process.stdout.write(JSON.stringify(r))).catch(e => {
    const code = String(e.code || e.name || 'erreur').replace(/[^A-Za-z0-9_]/g, '');
    console.error('VERIFICATION_OG_ECHOUEE ' + code + ' ' + (e.diagnosticOg || 'etape=entree')); process.exitCode=1;
  }));
}
module.exports = { verifier };

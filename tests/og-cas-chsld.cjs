'use strict';
/**
 * Bibliothèque de 600 cas de questions pour OG (CHSLD, hôpitaux, Liaison CHSLD), construits à partir des données fictives
 * réellement présentes dans l'environnement de test. Aucune réponse figée : chaque cas vérifie que la réponse contient les
 * valeurs lues par l'API (références, lits, chambres, établissements, étapes) et respecte les permissions.
 * Un cas : { id, domaine, qui, etab, question, contexte[], attendu: { contient[], pas[], proposition, sansProposition } }.
 * Un élément de `contient` peut être une liste d'alternatives (français ou anglais).
 */
const DOMAINES = { recherche: 100, chambres: 70, admissions: 60, hospitalisations: 80, retours: 80, liaison: 80, proches: 40, personnel: 40, securite: 50 };

function construire(d) {
  const cas = [];
  const ajout = (domaine, qui, etab, question, attendu, contexte = []) => cas.push({ id: `${domaine}-${String(cas.filter((c) => c.domaine === domaine).length + 1).padStart(3, '0')}`, domaine, qui, etab, question, attendu, contexte });
  const E = d.era, S = d.stl, B = d.B, A = d.A, C = d.C;
  const dup = d.dupont, num = Number(dup.ref.slice(2));
  const pad4 = String(num).padStart(4, '0');
  const AUCUN = ['aucun resultat autorise', 'no authorized result'];

  /* ---------------- 1. Recherche par référence et identité (100) */
  const R = (q, att) => ajout('recherche', 'era', E, q, att);
  for (const q of [dup.ref, dup.ref.toLowerCase(), dup.ref.replace('-', ''), `r ${num}`, `RES-${pad4}`, `Recherche ${dup.ref}`, `Recherche RES-${pad4}.`, `Find ${dup.ref}`, `Où est ${dup.ref} ?`, `Fiche ${dup.ref}`, `R-${num}`, `res ${num}`]) R(q, { contient: [dup.ref] });
  const lc = dup.lit;
  for (const q of [lc.replace('-', ''), lc.toLowerCase(), lc.replace('-', ' '), lc.replace('-', '_'), `Où est ${lc} ?`, `Who is in ${lc.replace('-', '')}?`]) R(q, { contient: [dup.ref] });
  for (const q of ['Où est Jean Dupont ?', 'où est jean dupont', 'Jean Dupont', 'jean dupont ?', 'Ouvre la fiche de Jean Dupont', 'Recherche Jean Dupont', 'Retrouve Jean Dupont', 'Where is Jean Dupont?', 'Find Jean Dupont', 'og euh il est ou jean dupont', 'Jean Dupond', 'jean dupond est ou']) R(q, { contient: [dup.ref] });
  for (const r of d.presents.slice(0, 12)) {
    R(r.ref, { contient: [r.ref] });
    R(r.ref.replace('-', '').toLowerCase(), { contient: [r.ref] });
    R(r.lit.replace('-', ''), { contient: [r.ref] });
    R(r.nomUnique ? `Où est ${r.prenom} ${r.nom} ?` : `Où est ${r.ref} ?`, { contient: [r.ref] });
  }
  for (const q of ['R-99999', 'ERA-999Z', 'STL-101', 'P-71001', 'CO-99999', 'DH-99999', 'Recherche R-99998', 'Where is R-99999?', 'ERA 998', 'R 77777', 'XYZ-123', 'TR-00012']) R(q, { contient: [AUCUN], pas: ['dupont'] });
  for (const q of ['Dupont', 'Où est Dupont ?', 'Where is Dupont?', 'Recherche Dupont']) R(q, { contient: [['plusieurs residents', 'several residents']] });
  for (const q of ['ERA117A', 'ERA-117A', 'era117a', 'Era 117A', 'Où est ERA117A ?', 'Where is ERA-117A?']) R(q, { contient: [d.attendu117], pas: ['je peux vous aider avec'] });

  /* ---------------- 2. Chambres, lits et capacités (70) */
  const CH = (q, att, qui = 'era') => ajout('chambres', qui, E, q, att);
  for (const q of ['Combien de chambres sont disponibles ?', 'Combien de places libres ?', 'Quels lits sont disponibles ?', 'places disponibles', 'Y a-t-il des chambres libres ?', 'combien de lits disponnibles', 'Montre les places libres', 'chambres dispo aujourd hui',
    'How many beds are available?', 'Which rooms are free?', 'available beds', 'Any vacant room?', 'how many places available', 'og combien de chambres disponibles']) CH(q, { contient: [[`${d.libres} place`, `${d.libres} available place`]] });
  for (const q of ['Quelles chambres sont bloquées ?', 'Quels lits sont bloqués ?', 'places bloquées', 'Liste des chambres indisponibles', 'Which beds are blocked?', 'blocked rooms', 'Show blocked places', 'chambres bloqueees'])
    CH(q, { contient: d.bloquee ? [d.bloquee.code] : [['aucune place bloquee', 'no blocked place']] });
  for (const q of ['Quels lits sont en nettoyage ?', 'Montre-moi les chambres en nettoyage', 'chambres à nettoyer', 'Quelles chambres sont en préparation de nettoyage ?', 'Which rooms are being cleaned?', 'rooms to clean', 'netoyage des chambres', 'Quels lits sont à nettoyer ?'])
    CH(q, { contient: [d.preparation ? [d.preparation.code, 'aucune chambre en nettoyage'] : ['aucune chambre en nettoyage', 'no room is being cleaned']] });
  for (const q of ['Quelles places sont conservées pour des résidents hospitalisés ?', 'places conservées', 'Quelles chambres sont conservées ?', 'Liste des places conservées', 'chambres gardées pour les hospitalisés', 'Which places are held?', 'held beds', 'Show held places', 'places conservees', 'Combien de places sont conservées ?'])
    CH(q, { contient: [lc] });
  for (const q of ['Quels lits sont occupés ?', 'Combien de chambres occupées ?', 'places occupées', 'Liste des lits occupés', 'Which beds are occupied?', 'occupied rooms', 'How many occupied places?', 'lits occupes'])
    CH(q, { contient: [[`${d.occupees} place(s) occupee`, `${d.occupees} place(s) occupied`]] });
  for (const q of ['chambre 117', 'Chambre 117 ?', 'room 117', 'Qui est dans la chambre 117 ?', 'Chambre 204', 'room 204']) CH(q, { contient: [q.includes('204') ? 'ERA-204' : 'ERA-117A'] });
  if (d.bloquee) for (const q of [`Pourquoi la chambre ${d.bloquee.chambre} est-elle indisponible ?`, `Why is room ${d.bloquee.chambre} unavailable?`]) CH(q, { contient: [d.bloquee.code, ['motif', 'reason']] });
  else for (const q of ['chambre 101', 'room 101']) CH(q, { contient: ['ERA-101'] });
  for (const q of ['chambre 999', 'room 999']) CH(q, { contient: [['aucune chambre 999', 'no room 999']] });
  for (const q of ['Quel est le taux d’occupation ?', 'taux d occupation', 'What is the occupancy rate?', 'capacité du CHSLD']) CH(q, { contient: [['taux d occupation', 'occupancy rate']] });
  for (const q of ['Quelles chambres conservées doivent être nettoyées ?', 'places conservées à nettoyer', 'Which held places need cleaning?', 'held rooms to clean', 'conservées à nettoyer ?', 'Y a-t-il des places conservées à nettoyer ?', 'chambres gardees a nettoyer', 'Quelles places conservées sont à nettoyer ?'])
    CH(q, { contient: [['aucune place conservee n est a nettoyer', 'no held place needs cleaning']] });

  /* ---------------- 3. Admissions et mouvements (60) */
  const AD = (q, att, ctx = []) => ajout('admissions', 'era', E, q, att, ctx);
  for (const q of ['Quels accueils sont prévus ?', 'admissions prévues', 'Qui arrive bientôt ?  admissions', 'Liste des nouveaux résidents attendus admission', 'Which admissions are planned?', 'planned intake', 'accueils prevus', 'Y a-t-il des admissions prévues ?', 'Quelles admissions sont prévues cette semaine ?', 'Show planned admissions'])
    AD(q, { contient: [d.preadmission ? d.preadmission.ref : ['aucun accueil', 'no planned admission']] });
  for (const q of ['Quelles demandes d’hébergement sont ouvertes ?', 'demandes d hebergement', 'Quelles demandes d’hébergement attendent une confirmation ?', 'Liste des demandes d’hébergement', 'Which placement requests are open?', 'placement requests', 'Montre les demandes d’hébergement', 'demandes d’hebergement en cours', 'Any placement request?', 'demandes hebergement ouvertes'])
    AD(q, { contient: [d.demande ? [d.demande.numero, 'aucune demande d hebergement'] : ['aucune demande d hebergement', 'no open placement request']] });
  for (const q of d.demandeRef ? [d.demandeRef.numero, d.demandeRef.numero.toLowerCase(), d.demandeRef.numero.replace('-', ''), `Où en est ${d.demandeRef.numero} ?`, `Status of ${d.demandeRef.numero}`] : []) AD(q, { contient: [d.demandeRef.numero] });
  for (const r of d.presents.slice(0, 5)) {
    AD(`Quel est le dernier mouvement confirmé de ${r.ref} ?`, { contient: [r.ref, ['dernier mouvement', 'aucun mouvement']] });
    AD(`Dernier mouvement de ${r.ref}`, { contient: [r.ref] });
    AD(`Latest movement for ${r.ref}`, { contient: [r.ref, ['latest confirmed movement', 'no movement']] });
    AD(`Dans quelle chambre est hébergé ${r.ref} ?`, { contient: [r.lit] });
    AD(`Chambre habituelle de ${r.ref}`, { contient: [r.lit] });
    AD(`Which room is ${r.ref} in?`, { contient: [r.lit] });
  }
  for (const q of ['Quels échanges entre CHSLD sont en cours ?', 'transferts entre les CHSLD', 'Which exchanges between CHSLDs are pending?', 'échanges CHSLD en attente', 'demandes de transfert entre CHSLD'])
    AD(q, { contient: [['echange', 'exchange']] });

  /* ---------------- 4. Hospitalisations et départs (80) */
  const H = (q, att, ctx = [], qui = 'era') => ajout('hospitalisations', qui, E, q, att, ctx);
  for (const q of ['Quels résidents sont hospitalisés aujourd’hui ?', 'Quels résidents sont hospitalisés ?', 'résidents à l’hôpital', 'Liste des hospitalisés', 'hospitalsés', 'Qui est hospitalisé ?', 'Which residents are in hospital?', 'residents hospitalized', 'Who is in hospital?', 'combien de résidents hospitalisés', 'Montre les résidents hospitalisés', 'og quels residents sont hospitalises'])
    H(q, { contient: [dup.ref, d.h3.ref] });
  for (const q of ['Où est Jean Dupont ?', `Où est ${dup.ref} ?`, `${dup.ref}`, 'Jean Dupont est où ?', 'Where is Jean Dupont?', `Where is ${dup.ref}?`, 'og ou est jean dupont', 'Localisation de Jean Dupont'])
    H(q, { contient: [['recu a hopital b', 'was received at hopital b'], ['rattachement', 'home chsld']] });
  for (const q of [`Où est ${d.h3.ref} ?`, d.h3.ref, `Where is ${d.h3.ref}?`, `${d.h3.ref} est où ?`, `localisation ${d.h3.ref}`, `Où se trouve ${d.h3.ref} ?`, `Where is ${d.h3.ref} now?`, `og ou est ${d.h3.ref.toLowerCase()}`])
    H(q, { contient: [['arrivee n est pas encore confirmee', 'arrival is not yet confirmed']] });
  for (const q of [`Où est ${d.h2.ref} ?`, d.h2.ref, `Where is ${d.h2.ref}?`, `${d.h2.ref} est où ?`, `localisation ${d.h2.ref}`, `Où se trouve ${d.h2.ref} ?`, `Where is ${d.h2.ref} now?`, `og ou est ${d.h2.ref.toLowerCase()}`])
    H(q, { contient: [['son depart n est pas confirme', 'departure is not confirmed']] });
  for (const q of ['Jean Dupont est-il arrivé à l’Hôpital B ?', `${dup.ref} est-il arrivé à l’hôpital ?`, 'Has Jean Dupont arrived at the hospital?', 'Is he at the hospital? est il arrive a l hopital Jean Dupont']) H(q, { contient: [['oui', 'yes']] });
  for (const q of [`${d.h3.ref} est-il arrivé à l’hôpital ?`, `Has ${d.h3.ref} arrived at the hospital?`, `${d.h3.ref} est elle arrivee a l hopital`, `est il arrive a l hopital ${d.h3.ref}`]) H(q, { contient: [['pas encore confirme', 'not confirmed yet']] });
  for (const q of ['Quand son départ a-t-il été confirmé ?', 'When was his departure confirmed?', 'Quand le départ a-t-il été confirmé pour lui ?']) H(q, { contient: [['confirme le', 'confirmed on']] }, ['Où est Jean Dupont ?']);
  for (const q of ['Quand son départ a-t-il été confirmé ?', 'When was his departure confirmed?']) H(q, { contient: [['confirme le', 'confirmed on']] }, [`Où est ${d.h3.ref} ?`]);
  for (const q of ['Quand son départ a-t-il été confirmé ?', 'When was his departure confirmed?', 'son depart est confirme quand']) H(q, { contient: [['aucun depart confirme', 'no confirmed departure']] }, [`Où est ${d.h2.ref} ?`]);
  for (const q of ['Quel est le dernier statut de son transfert ?', 'Où en est la demande de transfert de Jean Dupont vers l’Hôpital B ?', 'What is the latest status of his transfer?', 'statut de son transfert'])
    H(q, { contient: [d.hospDup.numero, 'mont-clair'] }, ['Où est Jean Dupont ?']);
  for (const q of [`Où en est la demande de ${d.h2.ref} ?`, `Status of the hospital request for ${d.h2.ref}`, `statut demande hopital ${d.h2.ref}`, `Où en est le transfert de ${d.h2.ref} ?`]) H(q, { contient: [d.h2.numero, ['transmise', 'sent']] });
  for (const q of [d.hospDup.numero, d.hospDup.numero.toLowerCase(), d.hospDup.numero.replace('-', ''), `Où en est ${d.hospDup.numero} ?`, `Status of ${d.hospDup.numero}`, `coordination ${d.hospDup.numero}`, `${d.hospDup.numero} ?`, `og ${d.hospDup.numero.toLowerCase()}`])
    H(q, { contient: [d.hospDup.numero, 'mont-clair'] });
  for (const q of ['Quelles demandes vers l’hôpital attendent une réponse ?', 'demandes hôpital en attente', 'Which hospital requests are pending?', 'demandes vers un hopital en attente de reponse', 'Quelles demandes vers les hôpitaux sont en attente ?', 'pending hospital requests'])
    H(q, { contient: [d.h2.ref, d.h4.ref] });
  for (const q of ['Il est où ?', 'il est ou', 'Where is he?', 'Et il est où maintenant ?', 'Where is he right now?', 'il se trouve ou ?']) H(q, { contient: [['recu a hopital b', 'was received at hopital b']] }, ['Recherche Jean Dupont']);

  /* ---------------- 5. Retours et réinstallations (80) */
  const RT = (q, att, ctx = ['Recherche Jean Dupont']) => ajout('retours', 'era', E, q, att, ctx);
  for (const q of ['Quand revient-il ?', 'Il revient quand ?', 'When is he coming back?', 'Quand Jean Dupont revient-il ?', 'Quand est prévu son retour ?', 'retour de jean dupont ?', 'When does he return?', 'il reviens quand']) RT(q, { contient: [['propose par l hopital', 'proposed by the hospital']] });
  for (const q of ['Sa place est-elle conservée ?', 'Sa chambre est-elle toujours attribuée ?', 'Is his place held?', 'Is his room still assigned?', 'Jean peut-il retrouver sa chambre ?', 'Sa chambre est toujours disponible ?', 'sa place est elle conservee', 'Can he get his room back?'])
    RT(q, { contient: [['oui, sa place est conservee', 'yes, the place is held']] });
  for (const q of ['Sa chambre est-elle prête ?', 'Est-ce que son lit est prêt ?', 'Is his room ready?', 'Sa chambre est-elle prête pour son retour ?', 'Is his bed ready?', 'son lit est pret ?', 'Est-ce que sa chambre est prête ?', 'chambre prete pour lui ?'])
    RT(q, { contient: [['chambre prete pour le retour', 'room ready for the return']] });
  for (const q of ['Pourquoi le retour est-il bloqué ?', 'Pourquoi sa réintégration est-elle bloquée ?', 'Why is his return blocked?', 'Why is the reinstatement blocked?', 'pourquoi son retour est bloque', 'Qu est-ce qui bloque son retour ? pourquoi', 'Pourquoi sa réintégration est-elle bloquée ? (dictée)', 'why is his return blocked'])
    RT(q, { contient: [['rien ne bloque', 'nothing is blocking']] });
  for (const q of ['Prépare sa réinstallation dans sa chambre habituelle', 'Prépare son retour', 'Prepare his return', 'Organise sa réintégration', 'prepare son retour au chsld', 'Prepare his reinstatement', 'Peux-tu préparer son retour ?', 'og prepare sa reinstallation'])
    RT(q, { proposition: 'coordination' });
  for (const q of ['Quels retours sont attendus ?', 'Quels résidents doivent revenir de l’hôpital ?', 'retours attendus', 'Which returns are expected?', 'Liste des retours prévus', 'Quels retours sont annoncés ?', 'retuors prévus', 'Show expected returns', 'Y a-t-il des retours prévus ?', 'returns from hospital'])
    RT(q, { contient: [dup.ref] }, []);
  for (const q of ['Quels retours attendent une confirmation ?', 'retours en attente de confirmation', 'Which returns are awaiting confirmation?', 'Quels retours sont en attente ?', 'pending returns', 'retours qui attendent une confirmation', 'Liste des retours en attente', 'Which returns are pending?'])
    RT(q, { contient: [dup.ref] }, []);
  for (const q of ['Confirme son arrivée', 'Confirme son retour', 'Confirm his arrival', 'confirme la reception', 'valide son retour', 'Confirm his return']) RT(q, { contient: [['je ne confirme pas', 'i do not confirm']], sansProposition: true });
  for (const r of d.presents.slice(0, 4)) for (const q of [`Quand revient ${r.ref} ?`, `When is ${r.ref} coming back?`]) RT(q, { contient: [['aucun retour n est attendu', 'no return is expected']] }, []);
  for (const q of ['Quelle est sa chambre habituelle ?', 'Dans quelle chambre est-il hébergé ?', 'What is his usual room?', 'Sa chambre habituelle ?', 'chambre habituelle de jean dupont', 'Which room is his?', 'Quelle est la chambre de Jean Dupont ?', 'sa chambre'])
    RT(q, { contient: [lc, ['place conservee', 'place held']] });

  /* ---------------- 6. Liaison CHSLD–Hôpital (80) */
  const LI = (qui, etab, q, att, ctx = []) => ajout('liaison', qui, etab, q, att, ctx);
  for (const q of ['Quels résidents de CHSLD sont attendus aujourd’hui ?', 'Quels résidents de CHSLD sont attendus à l’Hôpital B ?', 'résidents de CHSLD attendus', 'Which CHSLD residents are expected today?', 'CHSLD residents expected', 'Liste des résidents de CHSLD attendus', 'og quels residents de chsld sont attendus', 'arrivées CHSLD attendues', 'Who is expected from the CHSLDs?', 'Y a-t-il des résidents de CHSLD attendus ?'])
    LI('b', B, q, { contient: [d.h4.ref] });
  for (const q of ['Quelles demandes attendent une réponse ?', 'Quelles demandes de CHSLD attendent une réponse ?', 'Which requests are pending a response?', 'demandes CHSLD en attente de réponse', 'pending CHSLD requests response', 'demandes de résidents en attente', 'Quelles demandes attendent notre réponse ?', 'requests awaiting response from CHSLD'])
    LI('b', B, q, { contient: [d.h4.ref] });
  for (const q of ['Montre les arrivées du CHSLD des Érables', 'OG, montre-moi les demandes provenant du CHSLD des Érables', 'demandes du CHSLD des Erables', 'Show requests from CHSLD des Érables', 'arrivées des Érables', 'Erables chsld demandes', 'What comes from the Érables CHSLD?', 'demandes provenant des erables'])
    LI('b', B, q, { contient: [d.h4.ref] });
  for (const q of [dup.ref, dup.ref.toLowerCase().replace('-', ''), `R ${num}`, `Où en est ${dup.ref} ?`, `Status of ${dup.ref}`, `Statut de ${dup.ref}`, `${dup.ref} ?`, `res-${pad4}`])
    LI('b', B, q, { contient: ['des erables', ['admission preparee', 'admission prepared']] });
  for (const q of [d.hospDup.numero, d.hospDup.numero.toLowerCase(), `Où en est ${d.hospDup.numero} ?`, `Status of ${d.hospDup.numero}`, `coordination ${d.hospDup.numero.replace('-', '')}`, `${d.hospDup.numero} ?`]) LI('b', B, q, { contient: [dup.ref] });
  for (const q of ['Quels retours vers les CHSLD sont en préparation ?', 'retours vers les CHSLD', 'Which returns to CHSLDs are being prepared?', 'retours CHSLD en préparation', 'Liste des retours vers les CHSLD', 'returns to the CHSLD', 'Quels résidents retournent en CHSLD ? retours', 'og retours chsld'])
    LI('b', B, q, { contient: [dup.ref] });
  for (const q of ['Quel CHSLD est à l’origine de ce transfert ?', 'De quel CHSLD vient-il ?', 'Which CHSLD is this transfer from?', 'origine de ce résident ?', 'quel chsld est a l origine', 'From which CHSLD does this resident come?'])
    LI('b', B, q, { contient: ['des erables'] }, [dup.ref]);
  for (const q of [`Prépare le retour de ${dup.ref} vers son CHSLD`, 'Prépare le retour de ce résident', `Prepare the return of ${dup.ref} to the CHSLD`, 'Prépare le retour de ce résident vers son CHSLD'])
    LI('b', B, q, { contient: [['ne peut pas etre prepare', 'cannot be prepared']], sansProposition: true }, [dup.ref]);
  for (const q of ['Quels résidents sont arrivés et attendent un accueil ?', 'Quels résidents attendent une confirmation d’accueil ?', 'Which residents are waiting to be received?', 'residents arrivés en attente d accueil', 'CHSLD residents awaiting reception', 'résidents de CHSLD à accueillir'])
    LI('c', C, q, { contient: [d.h3.ref, ['arrivee a confirmer', 'arrival to confirm']] });
  for (const q of ['Quels résidents de CHSLD sont attendus ?', 'Which CHSLD residents are expected?', 'résidents de CHSLD attendus aujourd’hui', 'arrivées CHSLD', 'demandes de CHSLD', 'CHSLD requests'])
    LI('a', A, q, { contient: [d.h2.ref] });
  for (const q of ['OG, où en est le transfert de Jean Dupont ?', 'Where is the transfer of Jean Dupont?', 'statut de jean dupont résident', 'Où en est le résident Jean Dupont ?'])
    LI('b', B, q, { contient: [['que les references', 'only see']], pas: ['mont-clair · dupont'] });
  for (const [qui, etab, q] of [['a', A, dup.ref], ['a', A, `Où en est ${dup.ref} ?`], ['c', C, d.h4.ref], ['c', C, `Statut de ${d.h4.ref}`], ['a', A, d.h3.ref], ['c', C, d.h2.ref]])
    LI(qui, etab, q, { contient: [['aucune demande de chsld n est enregistree ici', 'no chsld request is recorded here']] });

  /* ---------------- 7. Proches et communication (40) */
  const P = (q, att, ctx = ['Recherche Jean Dupont']) => ajout('proches', 'era', E, q, att, ctx);
  for (const q of ['Qui est le contact principal de ce résident ?', 'Qui est son contact principal ?', 'Who is his main contact?', 'contact principal de Jean Dupont', 'Qui sont ses deux contacts principaux ?', 'Qui faut-il prévenir ?', 'Who is the primary contact for this resident?', 'ses contacts', 'Quels sont les contacts de Jean Dupont ?', 'family contacts of this resident'])
    P(q, { contient: ['marie dupont'] });
  for (const q of ['Qui est autorisé à recevoir des informations ?', 'Qui est autorisé à recevoir des informations sur son dossier ?', 'Who is authorized to receive information?', 'personnes autorisées', 'Qui peut recevoir des informations sur Jean Dupont ?', 'Who can receive information about him?', 'autorisations de ses proches', 'Quels proches sont autorisés ?', 'authorized family members', 'qui est autorise'])
    P(q, { contient: ['marie dupont'], pas: ['luc dupont'] });
  for (const q of ['Prépare une demande de rappel', 'Prépare un message à sa fille pour demander un rappel', 'Prepare a callback request to his daughter', 'demande de rappel à sa fille', 'Prépare un rappel', 'Prepare a callback request'])
    P(q, { proposition: 'communication' });
  for (const q of ['Prépare un message à son fils pour demander un rappel', 'Prepare a callback request to his son', 'rappel à son fils', 'message à son fils', 'Prépare une demande de rappel pour son fils', 'callback to his son'])
    P(q, { contient: [['n est autorise', 'is authorized']], sansProposition: true });
  for (const q of ['Y a-t-il un message en attente ?', 'messages en attente', 'Any pending message?', 'Y a-t-il des communications à faire ?', 'messages non lus', 'unread messages', 'communications en attente', 'Any callback pending?'])
    P(q, { contient: [['communication(s) a faire', 'communication(s) to do']] }, []);

  /* ---------------- 8. Personnel, entretien et tâches (40) */
  const PE = (q, att, ctx = [], qui = 'era') => ajout('personnel', qui, E, q, att, ctx);
  for (const q of ['Quelles tâches sont ouvertes ?', 'tâches ouvertes', 'Which tasks are open?', 'Liste des tâches', 'Montre les tâches', 'open tasks', 'Quelles tâches d’entretien sont à faire ?', 'housekeeping tasks'])
    PE(q, { contient: [['tache(s) ouverte', 'aucune tache ouverte', 'open task', 'no open task']] });
  for (const q of ['Quelles tâches sont en retard ?', 'tâches en retard', 'Which tasks are overdue?', 'overdue tasks']) PE(q, { contient: [['en retard', 'overdue']] });
  for (const q of ['Lance une tâche de nettoyage pour sa chambre', 'Lance une tâche de nettoyage pour cette chambre', 'Create a cleaning task for his room', 'Crée une tâche de nettoyage pour sa chambre', 'Planifie le nettoyage de sa chambre', 'Start a cleaning task for his room'])
    PE(q, { proposition: 'tache' }, ['Recherche Jean Dupont']);
  for (const q of ['Prépare une tâche d’entretien pour la chambre 117', 'Prépare une tâche d’entretien pour la chambre 101', 'Create a cleaning task for room 117', 'lance une tache de nettoyage chambre 204', 'Planifie une tâche de nettoyage pour la chambre 117', 'Prepare a housekeeping task for room 101'])
    PE(q, { proposition: 'tache' });
  for (const q of ['Sa chambre a-t-elle été nettoyée ?', 'Qui a terminé le nettoyage ?', 'Has his room been cleaned?', 'Who finished the cleaning?', `La chambre de ${dup.ref} a-t-elle été nettoyée ?`, 'Est-ce que sa chambre est propre ?'])
    PE(q, { contient: [['propre', 'clean'], d.nettoyeur.toLowerCase()] }, ['Recherche Jean Dupont']);
  // Rôle entretien : OG n'est pas ouvert à ce rôle (écran Nettoyage seulement) ; refus serveur vérifié
  for (const q of ['Quelles chambres sont à nettoyer ?', 'rooms to clean', 'chambres en nettoyage', 'Où est Jean Dupont ?', 'Where is Jean Dupont?', `Où est ${dup.ref} ?`]) PE(q, { statut: 403 }, [], 'era_entretien');
  for (const q of ['Combien de notifications non lues ?', 'notifications', 'Any unread notification?', 'alertes non lues notifications']) PE(q, { contient: [['notification', 'notification(s)']] });

  /* ---------------- 9. Permissions, ambiguïtés et sécurité (50) */
  const SE = (qui, etab, q, att, ctx = []) => ajout('securite', qui, etab, q, att, ctx);
  for (const q of [dup.ref, `Où est ${dup.ref} ?`, 'ERA-117A', 'ERA117A', lc, d.hospDup.numero.replace('CO-', 'CO '), d.h2.ref, `Where is ${d.h2.ref}?`, d.h3.ref, `localisation ${d.h3.ref}`].filter((x) => !d.refsStl.includes((x.match(/R-\d{5}/) || [])[0])))
    SE('stl', S, q, { contient: [AUCUN], pas: ['dupont'] });
  for (const q of ['Retrouve le résident Jean Dupont', 'Où est Jean Dupont ?']) SE('stl', S, q, { pas: ['jean dupont'] });
  while (cas.filter((c) => c.domaine === 'securite').length < 12) SE('stl', S, 'Where is Jean Dupont?', { pas: ['jean dupont ('] });
  for (const q of ['Décide qui doit avoir la prochaine place selon la priorité clinique', 'Quelle est la priorité clinique de Jean Dupont ?', 'Who should get the next place?', 'Décide de son admissibilité', 'Est-il admissible ?  admissibilité', 'What medication does he take?', 'Quel médicament prend-il ?', 'Attribue définitivement la chambre 117 à Paul Dupont', 'Decide his clinical priority', 'Doit-il être transféré à l’urgence ? transfert médical', 'diagnostic de Jean Dupont', 'Change his dosage'])
    SE('era', E, q, { contient: [['ne decide pas', 'do not decide']], sansProposition: true });
  for (const q of ['Que peux-tu faire ?', 'What can you do?', 'Qu’est-ce que tu sais faire ?', 'How can you help?']) SE('era', E, q, { contient: [['je peux consulter', 'i can look up']] });
  for (const q of ['blorf', 'quel temps fait-il à Paris', 'raconte une blague', 'zzzz', 'what is the meaning of life', 'qui a gagné le match hier', 'traduis bonjour en espagnol', 'asdf qwer'])
    SE('era', E, q, { contient: [['je n ai pas trouve', 'i could not find']], pas: ['je peux consulter', 'i can look up'] });
  for (const q of ['Il est où ?', 'Sa chambre ?', 'Where is he?', 'Il revient quand ?']) SE('era_soins', E, q, { contient: [['de quel resident', 'which resident']] });
  for (const q of ['Paul ou Jean Dupont ? Dupont', 'Dupont est où ?', 'Où est M. Dupont ?', 'dupont']) SE('era', E, q, { contient: [['plusieurs residents', 'several residents']] });
  for (const q of ['Confirme son arrivée', 'Valide son retour', 'Confirm his arrival', 'Confirme la réception de Jean Dupont']) SE('era', E, q, { contient: [['je ne confirme pas', 'i do not confirm']], sansProposition: true }, ['Recherche Jean Dupont']);
  for (const q of ['ERA-117A', 'Où est ERA117A ?']) SE('b', B, q, { pas: ['dupont'] });
  return cas;
}
module.exports = { construire, DOMAINES };

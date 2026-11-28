/**
 * Registre universel des modules d'Arrimo (cahiers « architecture fonctionnelle » et « architecture modulaire pilotée par SH »,
 * 27 nov. 2026). UNE source, lue par le serveur (contrôle des routes et des API) ET par l'interface (menus, sous-menus, cartes,
 * filtres) : servie telle quelle au navigateur à l'adresse /registre-modules.js.
 *
 * Quatre conditions, toutes obligatoires (§7) :
 *   1. compatibilité avec le type d'établissement (famille : hôpital, hébergement, secours) ;
 *   2. activation commerciale (licence : drapeau `licence` de src/types-etablissement.js, piloté par SH) ;
 *   3. permission du rôle de l'utilisateur ;
 *   4. autorisation d'accès aux données (contrôlée ensuite par chaque route : exigerEtablissement, périmètre, etc.).
 *
 * Hiérarchie d'activation (§ complément) : module → sous-module → fonctionnalité. SH peut désactiver un module entier
 * (`sm:<module>` = false) ou un seul sous-module (`sm:<module>.<sous>` = false) dans etablissements.modules ; un module désactivé rend
 * ses sous-modules inaccessibles. Rien n'est supprimé : les données, historiques et événements Chrono restent en base et réapparaissent
 * à la réactivation. Seule la console SH écrit ces clés (jamais l'administrateur d'un établissement).
 *
 * Aucun moteur par établissement : Chrono, notifications, journal et Sillage sont des SERVICES TECHNIQUES internes, toujours présents,
 * qui ne se vendent pas séparément ; ce sont les fonctionnalités commerciales qui s'activent.
 */
(function (racine, fabrique) {
  if (typeof module === 'object' && module.exports) module.exports = fabrique();
  else racine.ArrimoRegistre = fabrique();
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';
  /** Familles d'interface : le type d'établissement choisit la famille (une RPA, une RI ou un CHSLD partagent l'hébergement). */
  const FAMILLES = {
    // Les cliniques sont des types locaux d'hôpital dans SH (même famille d'interface)
    hopital: { fr: 'Hôpital ou clinique', en: 'Hospital or clinic', types: ['hopital'] },
    hebergement: { fr: 'Hébergement (CHSLD, RPA, autres)', en: 'Residential care (CHSLD, RPA, other)', types: ['chsld', 'maison_aines', 'rpa', 'ressource_intermediaire'] },
    ccs: { fr: 'Centre de communication santé', en: 'Health communication centre', types: ['ccs', 'urgences_sante'] },
    ambulance: { fr: 'Entreprise ambulancière', en: 'Ambulance company', types: ['entreprise_ambulanciere', 'urgences_sante'] },
    embarque: { fr: 'Ambulancier embarqué', en: 'On-board paramedic', types: ['entreprise_ambulanciere', 'urgences_sante'] },
    territorial: { fr: 'Gestionnaire territorial', en: 'Territorial manager', types: [] },
    national: { fr: 'Administration nationale', en: 'National administration', types: [] },
  };
  const familleDe = (type) => (!type || type === 'hopital' ? 'hopital' : FAMILLES.hebergement.types.includes(type) ? 'hebergement' : null);

  // Rôles du personnel d'un établissement (le rôle entretien a son propre périmètre réduit)
  const PERSONNEL = ['coordonnateur', 'admin_etab', 'gestionnaire', 'equipe_soins'];
  const RESPONSABLES = ['coordonnateur', 'admin_etab', 'gestionnaire'];
  const ADMIN = ['admin_etab', 'gestionnaire'];

  /**
   * Sous-module : v = écran (data-v, route d'interface conservée), licence = code de module commercial (types-etablissement.js) ou
   * null (socle inclus), roles = rôles autorisés (absent = PERSONNEL), routes = préfixes d'API dont il est l'emplacement principal.
   * fr/en = intitulé du sous-menu (seul intitulé affiché : aucun texte en dur ailleurs).
   */
  const sm = (id, v, fr, en, o = {}) => ({ id, v, fr, en, licence: null, roles: PERSONNEL, routes: [], ...o });

  const NAV = {
    hopital: [
      // Accueil de l'agent d'entretien (28 nov. 2026) : tableau de bord propre à son métier, même moteur que Nettoyage et Chrono
      { id: 'accueil', icone: 'house', fr: 'Accueil', en: 'Home', sous: [sm('accueil', 'copilote', 'Accueil', 'Home'), sm('accueil_entretien', 'entretien-accueil', 'Accueil', 'Home', { roles: ['entretien'] })] },
      { id: 'patients', icone: 'stethoscope', fr: 'Patients', en: 'Patients', sous: [
        sm('patients', 'patients', 'Patients', 'Patients'), sm('dsn', 'dsn', 'Dossier santé', 'Health record', { licence: 'dsn', routes: ['/dsn'] }),
        sm('admissions', 'admissions', 'Admissions', 'Admissions', { licence: 'admissions_hopital' }),
        sm('nsa', 'nsa', 'NSA', 'ALC', { licence: 'nsa', routes: ['/nsa'] })] },
      { id: 'capacites', icone: 'bed-double', fr: 'Capacités', en: 'Capacity', sous: [
        sm('lits', 'lits', 'Lits', 'Beds', { licence: 'lits' }), sm('bourse', 'bourse', 'Bourse des places', 'Placement exchange', { licence: 'bourse_places', routes: ['/bourse'] })] },
      { id: 'conges', icone: 'log-out', fr: 'Congés', en: 'Discharges', sous: [sm('conges', 'conges', 'Congés', 'Discharges', { licence: 'lits', routes: ['/conges'] })] },
      { id: 'transferts', icone: 'arrow-right-left', fr: 'Transferts', en: 'Transfers', sous: [
        sm('flux', 'flux', 'Flux', 'Flows', { routes: ['/arrimo-flux'] }),
        sm('interhospitalier', 'transferts', 'Interhospitalier', 'Inter-hospital', { licence: 'transferts' }),
        // Fusion de « Liaison CHSLD et résidences » : arrivées, accueils, hospitalisations et retours, dans les deux directions
        sm('hopital_hebergement', 'liaison', 'Hôpital et hébergement', 'Hospital and residence', { licence: 'liaison_chsld', routes: ['/liaison-chsld'] }),
        sm('transports_planifies', 'transports-planifies', 'Transports planifiés', 'Scheduled transports', { licence: 'transport_planifie' }),
        sm('domicile', 'flux-domicile', 'Domicile', 'Home'), sm('autres', 'flux-autres', 'Autres mouvements', 'Other movements'),
        sm('historique', 'flux-historique', 'Historique', 'History', { routes: ['/arrimo-flux/historique'] })] },
      { id: 'urgences', icone: 'siren', fr: 'Urgences', en: 'Emergency', sous: [
        sm('vue_generale', 'urgence', 'Vue générale des urgences', 'Emergency overview', { licence: 'urgence' }),
        // Emplacement principal de Secours 911 (ex-« Liaison Secours ») : préalertes, arrivées ambulancières, préparation de l'accueil
        sm('secours_911', 'secours', 'Secours 911', '911 emergency', { licence: 'liaison_secours' }),
        sm('statuts', 'urgence-statuts', 'Statuts et fermetures', 'Status and closures', { licence: ['liaison_secours', 'urgences_direct'], roles: RESPONSABLES }),
        sm('crise', 'crise', 'Mode crise', 'Crisis mode', { licence: 'mode_crise', routes: ['/crise'], roles: RESPONSABLES })] },
      { id: 'chrono', icone: 'timer', fr: 'Chrono', en: 'Chrono', sous: [sm('chrono', 'chrono', 'Chrono', 'Chrono', { licence: 'chrono' })] },
      { id: 'alertes', icone: 'bell', fr: 'Alertes', en: 'Alerts', sous: [sm('alertes', 'vigilance', 'Alertes', 'Alerts', { routes: ['/vigilance', '/coordination/alertes'] })] },
      { id: 'operations', icone: 'spray-can', fr: 'Opérations', en: 'Operations', sous: [
        // Décision de Moustafa (28 nov. 2026) : l'espace Opérations est réservé au rôle entretien, dans tous les établissements
        sm('mes_taches', 'mes-taches', 'Mes tâches', 'My tasks', { roles: ['entretien'] }),
        sm('nettoyage', 'nettoyage', 'Nettoyage', 'Cleaning', { licence: 'nettoyage', roles: ['entretien'] })] },
      { id: 'pilotage', icone: 'chart-column', fr: 'Pilotage', en: 'Steering', sous: [
        sm('indicateurs', 'indicateurs', 'Indicateurs', 'Indicators', { licence: 'rapports' }),
        sm('donnees', 'donnees', 'Données', 'Data', { licence: 'donnees_regionales', routes: ['/donnees'] }),
        sm('sillage', 'continuite', 'Sillage', 'Trail')] },
      { id: 'reseau', icone: 'network', fr: 'Réseau', en: 'Network', sous: [sm('reseau', 'reseau', 'Réseau', 'Network')] },
      // National : seulement les profils qui en ont la responsabilité (gestionnaire du réseau)
      { id: 'national', icone: 'map-pin', fr: 'National', en: 'National', sous: [sm('national', 'national', 'National', 'National', { licence: 'national', roles: ['gestionnaire'] })] },
      { id: 'administration', icone: 'settings', fr: 'Administration', en: 'Administration', sous: [
        sm('parametres', 'params', 'Paramètres', 'Settings', { roles: RESPONSABLES }), sm('admin', 'admin', 'Administration', 'Administration', { roles: ADMIN }),
        sm('journal', 'journal', 'Journal', 'Activity log', { roles: RESPONSABLES }), sm('support', 'support', 'Assistance', 'Support')] },
    ],
    hebergement: [
      { id: 'accueil', icone: 'house', fr: 'Accueil', en: 'Home', sous: [sm('accueil', 'c-accueil', 'Accueil', 'Home'), sm('accueil_entretien', 'entretien-accueil', 'Accueil', 'Home', { roles: ['entretien'] })] },
      { id: 'residents', icone: 'users', fr: 'Résidents', en: 'Residents', sous: [
        sm('residents', 'c-residents', 'Résidents', 'Residents', { licence: 'residents' }),
        sm('admissions', 'c-admissions', 'Admissions', 'Admissions', { licence: 'residents' }),
        // Déplacés depuis Opérations (28 nov. 2026) : la coordination les garde
        sm('taches', 'c-taches', 'Personnel et tâches', 'Staff and tasks', { licence: 'taches' }),
        sm('visites', 'visites', 'Visites confirmées', 'Confirmed visits', { licence: 'visites_confirmees', routes: ['/visites'] })] },
      { id: 'capacites', icone: 'bed-double', fr: 'Capacités', en: 'Capacity', sous: [
        sm('places', 'c-chambres', 'Chambres et places', 'Rooms and places', { licence: 'chambres' }),
        sm('bourse', 'bourse', 'Bourse des places', 'Placement exchange', { licence: 'bourse_places', routes: ['/bourse'] })] },
      // Départs : sorties et fins d'hébergement ; une hospitalisation temporaire n'est jamais un départ (place conservée)
      { id: 'departs', icone: 'log-out', fr: 'Départs', en: 'Departures', sous: [sm('departs', 'c-departs', 'Départs', 'Departures', { licence: 'residents' })] },
      { id: 'transferts', icone: 'arrow-right-left', fr: 'Transferts', en: 'Transfers', sous: [
        sm('flux', 'flux', 'Flux', 'Flows', { routes: ['/arrimo-flux'] }),
        sm('demandes', 'c-demandes', 'Demandes d’hébergement', 'Placement requests', { licence: 'demandes_hebergement' }),
        sm('interhebergement', 'c-reseau', 'Inter-hébergement', 'Between residences', { licence: 'reseau_chsld' }),
        // Fusion de « Transferts et hospitalisations » : hospitalisations et retours, avec filtres dédiés
        sm('hopital_hebergement', 'c-mouvements', 'Hôpital et hébergement', 'Hospital and residence', { licence: 'hospitalisations' }),
        sm('transports_planifies', 'transports-planifies', 'Transports planifiés', 'Scheduled transports', { licence: 'transport_planifie' }),
        sm('domicile', 'flux-domicile', 'Domicile', 'Home'), sm('autres', 'flux-autres', 'Autres mouvements', 'Other movements'),
        sm('historique', 'flux-historique', 'Historique', 'History', { routes: ['/arrimo-flux/historique'] })] },
      { id: 'urgences', icone: 'siren', fr: 'Urgences', en: 'Emergency', sous: [
        // Secours 911 de l'hébergement : demandes de prise en charge ambulancière, interventions, départs vers l'hôpital, suivi autorisé.
        // Intègre l'ancien « Avant l'appel » (préparation de l'intervention) : jamais une condition préalable à l'appel au 911.
        sm('secours_911', 'c-urgences', 'Secours 911', '911 emergency', { licence: ['transport_ambulancier', 'eviter_transferts'], routes: ['/urgences-proches', '/eviter'] }),
        sm('crise', 'crise', 'Mode crise', 'Crisis mode', { licence: 'mode_crise', routes: ['/crise'], roles: RESPONSABLES })] },
      { id: 'chrono', icone: 'timer', fr: 'Chrono', en: 'Chrono', sous: [sm('chrono', 'chrono', 'Chrono', 'Chrono', { licence: 'chrono' })] },
      { id: 'alertes', icone: 'bell', fr: 'Alertes', en: 'Alerts', sous: [sm('alertes', 'c-alertes', 'Alertes', 'Alerts', { routes: ['/coordination/alertes'] })] },
      { id: 'operations', icone: 'spray-can', fr: 'Opérations', en: 'Operations', sous: [
        // Décision de Moustafa (28 nov. 2026) : l'espace Opérations est réservé au rôle entretien
        sm('mes_taches', 'mes-taches', 'Mes tâches', 'My tasks', { roles: ['entretien'] }),
        sm('nettoyage', 'nettoyage', 'Entretien', 'Housekeeping', { licence: 'entretien_chsld', roles: ['entretien'] })] },
      { id: 'pilotage', icone: 'chart-column', fr: 'Pilotage', en: 'Steering', sous: [
        sm('indicateurs', 'c-indicateurs', 'Indicateurs', 'Indicators', { licence: 'rapports' }),
        sm('donnees', 'donnees', 'Données', 'Data', { licence: 'donnees_regionales', routes: ['/donnees'] }),
        sm('sillage', 'continuite', 'Sillage', 'Trail', { licence: 'hospitalisations' })] },
      { id: 'reseau', icone: 'network', fr: 'Réseau', en: 'Network', sous: [sm('reseau', 'reseau', 'Réseau', 'Network')] },
      { id: 'administration', icone: 'settings', fr: 'Administration', en: 'Administration', sous: [
        sm('parametres', 'params', 'Paramètres', 'Settings', { roles: RESPONSABLES }), sm('admin', 'admin', 'Administration', 'Administration', { roles: ADMIN }),
        sm('journal', 'journal', 'Journal', 'Activity log', { roles: RESPONSABLES }), sm('support', 'support', 'Assistance', 'Support')] },
    ],
    // Écrans de secours (public/secours.html), cahiers Ambulance/CCS du 27 nov. 2026 : un profil = une famille ; chaque module est activable
    // depuis SH par organisation (organisations_secours.modules, clé `sm:<profil>.<module>`). routes = API dont il est l'emplacement principal.
    ccs: [
      { id: 'accueil', fr: 'Accueil', en: 'Home', routes: ['/secours/og-ccs'] }, { id: 'missions', fr: 'Missions', en: 'Missions', routes: ['/secours/missions', '/secours/interventions-demo'] },
      { id: 'flotte', fr: 'Flotte', en: 'Fleet', routes: ['/secours/messages'] }, { id: 'bourse', fr: 'Bourse des places', en: 'Placement exchange', routes: ['/secours/urgences-classees', '/secours/destinations'] },
      { id: 'chrono', fr: 'Chrono', en: 'Chrono', routes: [] }, { id: 'alertes', fr: 'Alertes', en: 'Alerts', routes: ['/secours/flotte/alertes'] },
      { id: 'pilotage', fr: 'Pilotage', en: 'Steering', routes: [] }, { id: 'historique', fr: 'Historique', en: 'History', routes: ['/secours/flotte/historique'] },
      { id: 'administration', fr: 'Administration', en: 'Administration', routes: [] }],
    ambulance: [
      { id: 'accueil', fr: 'Accueil', en: 'Home', routes: [] }, { id: 'missions', fr: 'Missions', en: 'Missions', routes: ['/secours/transports'] },
      { id: 'flotte', fr: 'Flotte', en: 'Fleet', routes: [] }, { id: 'equipes', fr: 'Équipes', en: 'Crews', routes: [] },
      { id: 'chrono', fr: 'Chrono', en: 'Chrono', routes: [] }, { id: 'alertes', fr: 'Alertes', en: 'Alerts', routes: ['/secours/flotte/alertes'] },
      { id: 'pilotage', fr: 'Pilotage', en: 'Steering', routes: [] }, { id: 'historique', fr: 'Historique', en: 'History', routes: ['/secours/flotte/historique'] },
      { id: 'administration', fr: 'Administration', en: 'Administration', routes: [] }],
    embarque: [
      { id: 'accueil', fr: 'Accueil', en: 'Home', routes: [] }, { id: 'mission', fr: 'Mission', en: 'Mission', routes: [] },
      { id: 'chrono', fr: 'Chrono', en: 'Chrono', routes: [] }, { id: 'historique', fr: 'Historique', en: 'History', routes: ['/secours/flotte/historique'] }],
  };

  /** Catégories de mouvements pertinentes par famille (§8-10) : jamais Inter-hébergement à l'hôpital, jamais Interhospitalier en hébergement. */
  const CATEGORIES_FLUX = {
    hopital: ['interhospitalier', 'hopital_hebergement', 'secours_911', 'transport_planifie', 'domicile', 'autre'],
    hebergement: ['interhebergement', 'hopital_hebergement', 'secours_911', 'transport_planifie', 'domicile', 'autre'],
    territorial: ['interhospitalier', 'interhebergement', 'hopital_hebergement', 'secours_911', 'transport_planifie', 'domicile', 'autre'],
  };

  /** Services techniques internes : toujours présents, jamais vendus ni désactivés séparément (un seul moteur pour tous). */
  const SERVICES_TECHNIQUES = [
    { id: 'chrono_moteur', fr: 'Moteur Chrono (horloge commune, événements, durées)', en: 'Chrono engine (shared clock, events, durations)' },
    { id: 'notifications', fr: 'Notifications (barre supérieure, sons)', en: 'Notifications (top bar, sounds)' },
    { id: 'journal', fr: 'Journal immuable', en: 'Immutable log' }, { id: 'sillage', fr: 'Sillage (chronologie des parcours)', en: 'Trail (path timeline)' },
    { id: 'comptes', fr: 'Comptes et permissions', en: 'Accounts and permissions' }, { id: 'og', fr: 'OG, assistant', en: 'OG assistant' },
  ];

  /**
   * Offres commerciales (§4) : combinaisons de licences proposées par SH. Chaque offre liste les codes de modules commerciaux de
   * src/types-etablissement.js ; ce qui n'est pas compatible avec le type de l'établissement est ignoré à l'application.
   * `besoins` = dépendances expliquées dans SH (jamais activées en cachette).
   */
  const OFFRES = [
    { id: 'complet', fr: 'Arrimo complet', en: 'Full Arrimo', modules: '*' },
    { id: 'chrono_seul', fr: 'Chrono seul', en: 'Chrono only', modules: ['chrono'],
      besoins_fr: 'Chrono lit les événements des systèmes existants autorisés (connecteur validé) ; sans connecteur, seules les saisies faites dans Arrimo sont mesurées.',
      besoins_en: 'Chrono reads events from authorised existing systems (validated connector); without one, only entries made in Arrimo are measured.' },
    { id: 'chrono_capacites', fr: 'Chrono avec Capacités', en: 'Chrono with Capacity', modules: ['chrono', 'bourse_places'],
      besoins_fr: 'Les capacités du socle (lits, chambres) sont incluses ; la Bourse des places est ajoutée.', besoins_en: 'Core capacity (beds, rooms) is included; the placement exchange is added.' },
    { id: 'chrono_transferts', fr: 'Chrono avec Transferts', en: 'Chrono with Transfers', modules: ['chrono', 'transferts_suivi', 'transport_planifie', 'liaison_chsld', 'hospitalisations', 'reseau_chsld', 'demandes_hebergement'] },
    { id: 'chrono_secours', fr: 'Chrono avec Secours 911', en: 'Chrono with 911 emergency', modules: ['chrono', 'liaison_secours', 'transport_ambulancier', 'urgences_direct'],
      besoins_fr: 'Secours 911 exige une entreprise ambulancière ou un CCS relié à la région.', besoins_en: '911 emergency requires an ambulance company or CCS linked to the region.' },
    { id: 'chrono_performance', fr: 'Chrono avec Performance', en: 'Chrono with Performance', modules: ['chrono', 'donnees_regionales'] },
  ];

  const modulesDe = (etab) => (etab && etab.modules) || {};
  /** Licence d'un sous-module : un code, ou une liste dont UN code suffit (fusion de deux anciens écrans). */
  const sousLicence = (etab, lic, licenceActive) => !lic || (Array.isArray(lic) ? lic.some((c) => licenceActive(etab, c)) : licenceActive(etab, lic));
  /** Le module de navigation (ou un sous-module) a-t-il été désactivé par SH ? */
  const desactiveParSh = (etab, cle) => modulesDe(etab)[`sm:${cle}`] === false;

  /**
   * Interface autorisée pour un établissement et un utilisateur : modules de navigation et sous-menus, dans l'ordre du registre.
   * licenceActive(etab, code) est fournie par l'appelant (serveur : types-etablissement.moduleActif ; navigateur : drapeaux reçus).
   */
  function interfacePour(etab, utilisateur, licenceActive) {
    const fam = familleDe(etab && etab.type_etablissement);
    if (!fam) return { famille: null, modules: [] };
    const role = (utilisateur && utilisateur.role) || 'coordonnateur';
    const modules = [];
    for (const m of NAV[fam]) {
      if (desactiveParSh(etab, m.id)) continue;
      const sous = m.sous.filter((s) => s.roles.includes(role) && !desactiveParSh(etab, `${m.id}.${s.id}`) && sousLicence(etab, s.licence, licenceActive));
      if (sous.length) modules.push({ ...m, sous });
    }
    return { famille: fam, modules, categories_flux: CATEGORIES_FLUX[fam] };
  }
  /** Écrans (data-v) autorisés : ensemble plat pour masquer les onglets et rediriger les anciennes routes. */
  const ecransAutorises = (etab, utilisateur, licenceActive) => new Set(interfacePour(etab, utilisateur, licenceActive).modules.flatMap((m) => m.sous.map((s) => s.v)));

  /** Anciennes routes d'interface → emplacement principal (§21 : redirection des anciens intitulés). */
  const REDIRECTIONS = { eviter: 'c-urgences', 'liaison-secours': 'secours', 'c-hospitalisations': 'c-mouvements' };

  /** Sous-modules propriétaires d'une route d'API (contrôle côté serveur), par famille. */
  function proprietaires(fam, chemin) {
    const r = [];
    for (const m of (['hopital', 'hebergement'].includes(fam) ? NAV[fam] : [])) for (const s of m.sous || []) if (s.routes.some((p) => chemin === p || chemin.startsWith(`${p}/`) || chemin.startsWith(`${p}.`))) r.push([m, s]);
    return r;
  }
  /**
   * Route d'API autorisée pour cet établissement ? Une route sans propriétaire n'est pas concernée (null). Sinon il suffit qu'UN de
   * ses sous-modules propriétaires soit compatible, sous licence et non désactivé par SH. Le rôle reste contrôlé par la route elle-même.
   */
  function routeAutorisee(etab, chemin, licenceActive) {
    const fam = familleDe(etab && etab.type_etablissement);
    if (!fam) return null;
    const p = proprietaires(fam, chemin);
    // Route d'une autre famille : la compatibilité de type reste contrôlée par la route elle-même (jamais de refus par déduction ici)
    if (!p.length) return null;
    const ok = p.some(([m, s]) => !desactiveParSh(etab, m.id) && !desactiveParSh(etab, `${m.id}.${s.id}`) && sousLicence(etab, s.licence, licenceActive));
    return ok ? { ok: true } : { ok: false, raison: p.some(([m, s]) => desactiveParSh(etab, m.id) || desactiveParSh(etab, `${m.id}.${s.id}`)) ? 'sous_module' : 'licence', module: p[0][0].id };
  }
  /** Famille « secours » (une organisation peut porter plusieurs profils) : un module par profil, ses écrans en sous-modules. */
  const NAV_SECOURS = [['ccs', 'Profil CCS', 'CCS profile'], ['ambulance', 'Gestionnaire ambulancier', 'Ambulance manager'], ['embarque', 'Ambulancier embarqué', 'On-board paramedic']]
    .map(([id, fr, en]) => ({ id, fr, en, sous: NAV[id].map((x) => ({ ...x, v: x.id })) }));
  const navDe = (fam) => (fam === 'secours' ? NAV_SECOURS : NAV[fam] || []);
  /** Clés de sous-modules valides pour une famille (validation de ce que SH envoie). */
  const clesSousModules = (fam) => navDe(fam).flatMap((m) => (m.sous ? [m.id, ...m.sous.map((s) => `${m.id}.${s.id}`)] : []));
  /** Profil d'interface d'un rôle de secours. */
  const profilSecours = (role) => ({ repartiteur: 'ccs', superviseur_secours: 'ambulance', paramedic: 'embarque' }[role] || null);
  /** Modules de secours visibles pour un profil, selon les organisations de l'utilisateur (un module coupé partout disparaît). */
  function modulesSecours(profil, organisations) {
    const orgs = organisations && organisations.length ? organisations : [{}];
    return (NAV[profil] || []).filter((m) => orgs.some((o) => !desactiveParSh(o, profil) && !desactiveParSh(o, `${profil}.${m.id}`))).map((m) => m.id);
  }
  /** Route de secours autorisée ? null si aucun module n'en est propriétaire pour ce profil. */
  function routeSecoursAutorisee(profil, organisations, chemin) {
    const p = (NAV[profil] || []).filter((m) => m.routes.some((r) => chemin === r || chemin.startsWith(`${r}/`)));
    if (!p.length) return null;
    const vis = modulesSecours(profil, organisations);
    return p.some((m) => vis.includes(m.id)) ? { ok: true } : { ok: false, module: `${profil}.${p[0].id}` };
  }

  return { NAV_SECOURS, navDe, profilSecours, modulesSecours, routeSecoursAutorisee, FAMILLES, NAV, CATEGORIES_FLUX, SERVICES_TECHNIQUES, OFFRES, REDIRECTIONS, familleDe, interfacePour, ecransAutorises, routeAutorisee, clesSousModules, desactiveParSh };
}));

/* Langue d'une question posée à OG (français ou anglais), sans aucun service externe.
   Ordre de décision : langue demandée explicitement (« réponds en anglais », « answer in French »),
   puis langue reconnue dans la question, puis préférence de conversation si la question est ambiguë
   (référence seule, mot isolé commun aux deux langues). Partagé par le navigateur et le serveur. */
(function (root) {
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Mots outils propres à chaque langue (les mots communs aux deux, comme « a », « on », « patient », « transfert/transfer », sont exclus).
  const FR = new Set(('le la les des du de un une est sont combien quel quels quelle quelles lit lits libre libres disponible disponibles pour avec dans sur '
    + 'que qui quoi ou il elle ils elles nous vous je mon ma mes ce cette ces au aux et mais donc pas plus moins tous toutes tout '
    + 'urgence civiere civieres demande demandes attente patients alertes alerte priorite priorites faire dois peux peut-on y-a-t-il '
    + 'aujourd hui demain hier ou-est quand comment pourquoi bonjour merci oui non svp etat chambre unite unites service soins intensifs '
    + 'liste montre affiche donne trouve cherche besoin a-t-il est-ce').split(/\s+/));
  const EN = new Set(('the an is are how many much which what where who whom whose bed beds free available with in of to do does did can could '
    + 'should would will my me your this that these those there their any some all and but not more less show give find list please '
    + 'today tomorrow yesterday when why hello thanks yes no status room ward unit units emergency stretcher stretchers request requests '
    + 'waiting alerts alert priority priorities first next need i we you it its open icu intensive care hi hey').split(/\s+/));
  const DEMANDE_EN = /(?:reponds?|repondez|reponse|parle|parlez|answer|reply|respond|speak|talk)\s+(?:moi\s+|to me\s+)?(?:en\s+|in\s+)?(?:anglais|english)\b|\b(?:en anglais|in english)\s*(?:svp|please|stp)?\s*[:,.!?]?\s*$/;
  const DEMANDE_FR = /(?:reponds?|repondez|reponse|parle|parlez|answer|reply|respond|speak|talk)\s+(?:moi\s+|to me\s+)?(?:en\s+|in\s+)?(?:francais|french)\b|\b(?:en francais|in french)\s*(?:svp|please|stp)?\s*[:,.!?]?\s*$/;

  /** Langue demandée explicitement dans la question, ou null. */
  function demandee(question) {
    const q = norm(question);
    if (DEMANDE_EN.test(q)) return 'en';
    if (DEMANDE_FR.test(q)) return 'fr';
    return null;
  }
  /** Langue reconnue dans la question ('fr', 'en') ou null si elle est ambiguë. */
  function detecter(question) {
    const brut = String(question || '');
    // Références (P-00012, TR-4, MED-204A) et nombres : sans valeur linguistique.
    const sansRefs = brut.replace(/\b[A-Za-z]{1,6}-\d+[A-Za-z]?\b/g, ' ').replace(/\d+/g, ' ');
    let fr = 0, en = 0;
    // Lettres accentuées et élisions : indices forts du français.
    fr += Math.min(3, (sansRefs.match(/[àâçéèêëîïôûùüÿœ]/gi) || []).length);
    fr += 2 * (sansRefs.match(/\b(?:[cdjlmnstq]u?)['’]\s?[a-zàâéèêîôûœh]/gi) || []).length;
    // Contractions anglaises : indice fort de l'anglais.
    en += 2 * (sansRefs.match(/\b\w+['’](?:s|t|re|ll|ve|d|m)\b/gi) || []).filter((m) => !/^(?:[cdjlmnstq]u?)['’]/i.test(m)).length;
    for (const mot of norm(sansRefs).replace(/['’]/g, ' ').split(/[^a-z-]+/).filter(Boolean)) {
      if (FR.has(mot)) fr++;
      if (EN.has(mot)) en++;
    }
    if (fr === en) return null;
    if (fr > en) return fr >= 1 && fr - en >= 1 ? 'fr' : null;
    return en >= 1 && en - fr >= 1 ? 'en' : null;
  }
  /** Langue de la réponse : demande explicite, sinon langue de la question, sinon préférence (fr par défaut). */
  function langueReponse(question, preference) {
    return demandee(question) || detecter(question) || (preference === 'en' ? 'en' : 'fr');
  }
  const api = { demandee, detecter, langueReponse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ArrimoOgLangue = api;
})(typeof window === 'undefined' ? globalThis : window);

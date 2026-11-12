### EXTENSION DU PÉRIMÈTRE — ARRIMO LIAISON ÉTABLISSEMENTS

Nous ajoutons une dimension importante au chantier Arrimo Préhospitalier.

Arrimo ne doit pas connecter uniquement les ambulances aux hôpitaux. Nous voulons également intégrer les établissements d'hébergement et de soins de longue durée :

- EHPAD.
- CHSLD.
- RPA.
- Autres établissements comparables selon les pays.

Nous souhaitons créer une composante appelée provisoirement **Arrimo Liaison Établissements**.

Cette composante doit permettre aux établissements de communiquer avec les ambulances et les hôpitaux.

Les parcours à prendre en compte sont :

1. Un résident nécessite un transport vers un hôpital.
2. L'établissement prépare et transmet les informations autorisées.
3. L'ambulance reçoit les informations nécessaires selon les permissions.
4. L'hôpital est averti et prépare la réception.
5. OG facilite la coordination et le suivi.
6. L'établissement d'origine suit le départ et le transfert.
7. Après hospitalisation, l'hôpital peut coordonner le retour du résident.
8. L'établissement d'hébergement est informé et prépare son accueil.
9. Le retour ou le transfert est confirmé et historisé.

Prévoir également les transferts entre établissements lorsque cela est pertinent.

L'interface de l'établissement doit permettre :
- La gestion des résidents autorisés.
- La création d'une demande de transport ou de transfert.
- La transmission des informations nécessaires.
- Le suivi des ambulances et des transports autorisés.
- La communication avec les hôpitaux.
- La réception des notifications.
- La préparation des départs et des retours.
- Le suivi de l'historique des transferts.

OG doit rester l'intelligence centrale et faciliter les échanges entre ces différents acteurs.

Attention : distinguer les demandes de transport, les préalertes ambulancières, les transferts hospitaliers et les retours en établissement. Ce sont des parcours différents qui doivent avoir leurs propres règles métier.

Ne pas confondre les capacités hospitalières avec les disponibilités de chambres ou de places en EHPAD, CHSLD et RPA.

Ne pas donner aux ambulanciers un accès général aux dossiers des résidents. Les informations partagées doivent être strictement limitées aux besoins du transport et aux autorisations applicables.

Les décisions médicales, l'orientation, la destination et l'acceptation d'un résident restent sous la responsabilité des professionnels et organisations compétents.

**INSTRUCTION POUR L'AUDIT :** intégrer cette nouvelle dimension dans l'analyse du dépôt existant. Identifier les fonctions de Liaison CHSLD déjà présentes, les services réutilisables, les données existantes et les modifications nécessaires. Ne modifier aucun fichier et ne commencer aucun développement avant validation explicite.
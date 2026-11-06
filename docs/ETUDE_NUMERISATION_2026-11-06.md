# Numérisation : ce qui est livré et ce qui reste à l'étude (6 novembre 2026)

## Livré et testé
- Registre structuré : type, référence, contenu, auteur, date, statut, historique (`src/evenements.js`).
- Import CSV en deux temps : vérification sans écriture, puis confirmation humaine sur la même empreinte. Tout ou rien.
- Un PDF ou un fichier binaire est refusé ; il se saisit à la main.

## À l'étude, non construit
- **PDF, documents numérisés et fax :** un document peut contenir une vraie donnée de patient. Avant de construire, il faut l'hébergement approuvé et l'évaluation Loi 25.
- **Reconnaissance de texte :** à faire tourner sur nos serveurs, sans service externe. Le texte extrait reste une proposition jusqu'à la validation d'une personne ; il n'est jamais une donnée médicale validée.
- **Excel :** à ajouter avec la même vérification ; le CSV couvre le besoin pour l'instant.

## Interopérabilité
Point d'entrée existant : `src/connecteurs.js` (événements HL7 ADT traduits en JSON, simulés). Une connexion réelle demande l'accès et l'autorisation de l'hôpital, le rapprochement des identifiants, la prévention des doublons par identifiant de message, et aucun remplacement du dossier clinique officiel.

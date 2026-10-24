# Rapport de validation — vidéo Arrimo

## Fichier

- `ARRIMO_DEMONSTRATION_2MIN.mp4`, 4 803 291 octets, régénéré le 22 octobre 2026 après correction de l’affichage des distances non routières.
- Conteneur MP4, vidéo H.264, 1920 × 1080, 30 images/s, pixel format `yuv420p`, durée exacte 120,000 secondes.
- Aucune piste audio; sous-titres français incrustés et script de narration fourni séparément.
- L’intégralité du flux a été décodée par FFmpeg sans erreur. Des images aux secondes 10, 28, 38, 40, 49, 63, 70, 92 et 115 ont été inspectées : interface lisible, texte net, OG identifiable, indications de trajet indisponible visibles.

## Origine et confidentialité

La vidéo a été enregistrée en continu depuis l’application candidate locale, dans Chromium piloté avec Playwright. Une base PostgreSQL jetable, créée pour cet enregistrement et supprimée ensuite, contenait uniquement les données synthétiques de démonstration. Les actions d’interface sur le lit, la confirmation, le chat OG, l’acceptation, la préparation, le refus et la réception fictive ont été exécutées localement. Aucune opération n’a ciblé le domaine ou la base publique.

Le fournisseur routier n’est pas configuré. La candidate a donc conservé son comportement sûr : « trajet indisponible », distances absentes et départ empêché lorsqu’une durée d’itinéraire vérifiée est exigée. La scène de réception concerne un autre transfert préchargé dans le jeu fictif; la vidéo le précise. Le moteur n’a pas reçu de confirmation clinique ni de validation pédiatrique d’un établissement.

## Capacités présentées

- Accueil Arrimo modernisé : indicateurs, saturation, alertes et recommandations.
- Cycle réel d’un lit fictif : occupé → nettoyage → libre → disponibilité confirmée.
- Vue d’urgence et taux des civières; la civière est consultée, sans changement d’état montré.
- OG, robot bleu et blanc, chat et source « règles locales ».
- Recherche interhospitalière à partir des capacités fictives et confirmations visibles.
- Acceptation et préparation d’une demande locale fictive, puis blocage prudent du départ sans routage.
- Refus local fictif, recommandation Plan B OG et réception d’un scénario distinct préchargé.

## Limites de la vidéo

La demande de transfert était préchargée par l’API dans la base jetable avant l’enregistrement; sa création à l’écran n’est pas montrée. Le parcours du transfert accepté ne peut pas être conduit jusqu’au départ et à la réception du même dossier sans fournisseur de routage approuvé. Le transfert distinct reçu est une donnée synthétique de scénario. L’alternative Plan B est signalée, mais aucune destination n’est confirmée car aucun trajet fiable n’est disponible. La narration n’est pas enregistrée; le MP4 est la version sous-titrée sans narration.

Empreinte SHA-256 du MP4 : `36c91723f3af3bd3eb5c9f5f00bc06002fc3f46efde08eeadb0ce6e4ea24cb9c`.

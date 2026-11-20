# Limites de fonctionnement

Configuration → Limites (`#settings-policies`) expose les choix globaux du
propriétaire. Ils s’appliquent au **prochain tour de chaque conversation**, y
compris un fil existant. Un tour déjà lancé garde son instantané jusqu’à la fin,
revue mémoire et compression comprises. Modifier ces valeurs ne lance aucun LLM.

| Groupe | Réglage | Défaut |
| --- | --- | ---: |
| Messages | Caractères par message | 8000 |
| Outils | Appels proposés par réponse du modèle | 16 |
| Contexte | Compression, pourcentage du budget utilisable | 80 % |
| Contexte | Appels de résumé par compression | 16 |
| Mémoire | Mots-clés de recherche après filtrage | 16 |
| Mémoire | Candidats correspondants examinés | 200 |
| Mémoire | Résultats classés par recherche | 12 |
| Mémoire | Souvenirs injectés dans le contexte | 3 |
| Mémoire | Caractères injectés, références comprises | 3000 |

**0 = sans plafond Heart pour ce réglage**, sauf le pourcentage de compression
qui reste entre 1 et 100. Zéro n’est pas une désactivation de la mémoire.
Les autres valeurs sont des entiers positifs représentables exactement en JS.
Aucun maximum arbitraire supplémentaire. Le pourcentage déclenche la compression, sans devenir un plafond dur du tour.
Un message reste soumis à la capacité
réelle du modèle ; augmenter l’injection peut remplir le contexte ou accroître
le coût. L’estimation de contexte est signalée comme telle.

Le nombre de résultats s’applique au service de recherche et à `memory.search`.
L’ancien second plafond caché de cinq références de cet outil est supprimé.
Les références longues continuent d’exiger `memory.get` pour le détail.
Le plafond de candidats agit avant classement : le diminuer peut masquer un
souvenir ancien. La recherche reste littérale, sans inférence supplémentaire.

## Stockage et assemblage

- `src/contracts/policies.ts` : valeurs neutres et défauts versionnés avec le code.
- `app/runtime-policies.ts` : validation stricte et résolution des valeurs effectives.
- `AssistantSettings.runtimePolicies` : seulement les écarts aux défauts, dans le
  profil JSON existant. `effectivePolicies` est dérivé, jamais une seconde source.
- Aucun SQL supplémentaire ni migration. PostgreSQL/SQLite utilisent le même profil.
  Pour la recherche mémoire, `limit: 0` signifie tous les candidats correspondants
  (PostgreSQL `LIMIT NULL`, SQLite `LIMIT -1`).
- `Conversations` capture une seule version du profil par tour, incluant identité,
  instructions et limites. L’assemblage web les
  transmet au module mémoire, au contexte et au budget de lot du core.
  Le core n’importe aucun module ou service de configuration.

Les clients qui sauvegardent un ancien profil sans `runtimePolicies` conservent
les limites courantes. Aucun accès fichier, réseau, YOLO ou modèle n’est changé.
Les lectures de profil ne provoquent aucune écriture de migration implicite.

## API et interface

`GET /api/policies` retourne profil, version, valeurs effectives et défauts.
`POST /api/policies` reçoit `section`, `version`, `baseValue` et `value` : champs
numériques de la section, ou `null` pour son reset complet. Les champs inconnus,
valeurs invalides et bases incomplètes sont refusés. Authentification, origine et
CSRF identiques aux autres réglages. Un conflit sur un champ modifié est refusé ;
le navigateur envoie les seuls champs changés et ignore une sauvegarde inchangée ;
les changements indépendants se fusionnent, puis le repository applique son CAS.

L’onglet est chargé à la demande, catalogue mis en cache par version et cartes
conservées si leurs valeurs n’ont pas changé. Aucun polling ajouté. Un GET ancien
ne remplace pas une sauvegarde récente. Déconnexion : cache/brouillons purgés, résultats tardifs ignorés. Onglets
horizontaux sur petit écran, sélection visible après redimensionnement et clavier.

Chaque section ouvre l’overlay commun. Enregistrement visible, boutons bloqués
pendant l’écriture, brouillon conservé après erreur/conflit. Rétablir prépare les
défauts ; Enregistrer les applique. Le composeur et les prompts rapides utilisent
la limite effective ; pas de troncature du brouillon lors d’un changement de limite.
Le corps JSON des messages authentifiés n’est plus plafonné à l’ancien transport
32 Kio : le service applique la politique puis le contexte vérifie le modèle.

## Portée et garde-fous distincts

Ce lot ne crée pas de plafond financier. Les limites natives fournisseur, les
permissions, le budget d’étapes par fil, la réserve de sortie et les contrôles
historiques restent applicables. La validation du résumé (6000 caractères), les
limites des fiches mémoire (titre 160/contenu 4000), les pièces jointes et les
pages d’administration restent distinctes des limites configurées ici.
« Sans plafond » n’est pas une promesse de ressources matérielles infinies.

## Qualification

`tests/policies.test.ts` vérifie validation, défauts dérivés, concurrence,
compatibilité des anciens clients, reset ciblé, lots autorisés/refusés,
permissions, recherche/injection, seuil et budget de résumé, conservation du
journal et instantané par tour dans l’assemblage web avec réouverture SQLite.

`tests/policies.e2e.ts` vérifie API privée, sauvegarde/reset, conflits, cache,
GET périmé, feedback d’écriture, persistance, composeur sans plafond et message
UTF-8 de 17 000 caractères (>32 Kio) conservé via HTTP jusqu’au fournisseur simulé.
Quatre largeurs 320/390/820/1440 sans débordement. La suite SQL commune vérifie le
sens de `limit: 0` sur les deux moteurs. Les fournisseurs de ce lot sont simulés :
aucun nouvel appel payant et aucune nouvelle qualification de modèle réel.
[Preuves](qualification/policies/README.md).

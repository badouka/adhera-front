# Adhera — frontend (`badouka/adhera-front`)

La page du membre (`/m/{jeton}`), la vérification d'une carte (`/v/{code}`), « Adhérer » (`/adherer`) et l'espace du bureau (`/bureau`). Next.js, servi par PM2. Le backend (Laravel d'EventFlow, `api.eventflow.africa`) n'est **jamais** modifié depuis ce dépôt : une donnée qui manque à l'API se note au rapport, elle ne s'invente pas.

Le détail des règles et de chaque sprint est dans `README.md`. Ce fichier rappelle ce qui ne se négocie pas.

## Le texte à l'écran

- **« cliquez sur »**, sur téléphone comme sur ordinateur : jamais « touchez », « tapez sur » ni « appuyez sur ». Une seule exception, nommée dans `LEXIQUE_EXCEPTIONS` : « Appuyez longuement sur l'image » (`SaveCard.tsx`).
- **Une phrase en haut de chaque écran, un bouton principal.**
- **Côté membre, c'est l'association qui parle** ; « Propulsé par Adhera » en pied de page.
- **Montants** : toujours suivis de « FCFA » en entier, affichés depuis le champ `*_formatted` de l'API (R1 : aucun formatage de montant côté client, hors la saisie, voir le README).
- **Apostrophe typographique `’`** dans tout texte affiché.
- Une phrase composée à l'écran avec un nom élide : `de` → `d’` et `que` → `qu’` devant une voyelle ou un h (`src/lib/elision.ts`). Aucun article devant le nom d'une association.

## Les erreurs de l'API : afficher son message

- Le **comportement** se branche sur le `code` (ou le statut), **jamais sur le texte**.
- Le **texte affiché** est le `message` de l'API dès qu'il existe. Les libellés locaux ne servent que de repli.
- `BY_CODE` (`src/lib/bureau/messages.ts`), `PROOF_CODES` et `RELOAD_CODES` (`src/components/PaymentSheet.tsx`) sont **gelés** : aucun code n'y entre, `tests/guards.test.ts` refuse toute clé ajoutée.
- Un `422` : `fieldMessages(error)` donne le message de chaque champ, tel quel.
- Exception décidée par Alioune (F7) : la licence (`license_expired`, `trial_expired`, `tenant_inactive`) a ses propres phrases, dans un écran à part (`src/lib/licence.ts`), suivies des contacts d'Adhera.
- « Erreur technique » est réservé aux vraies pannes réseau, jamais à une réponse que le serveur a rendue.

## Sécurité

- **Aucun jeton de membre** dans un log, une capture, un commit ou un rapport. Masquer l'aperçu d'un message WhatsApp avant toute capture.
- **Aucun secret dans une variable `NEXT_PUBLIC_*`.**
- **Les mots de passe se demandent à Alioune**, ils ne s'essaient jamais (ni par l'écran, ni par l'API, ni avec une valeur relevée ailleurs). Une fois reçu, il ne vit que dans une variable d'environnement le temps de la commande.
- Les coordonnées d'Adhera (WhatsApp, e-mail) sont publiques et vivent à un seul endroit : `src/lib/adhera.ts`.

## Tester

```bash
npm test           # vitest, fuseau America/Los_Angeles forcé
npm run typecheck  # tsc --noEmit
node scripts/poids.mjs <origine> [hôte]   # 180 Ko au plus par page, en Brotli
```

`tests/guards.test.ts` porte les garde-fous exécutables (lexique, tables gelées, aucun hôte tiers, aucun fetch en SSR…), chacun avec sa contre-épreuve. Un rapport `_handoff/RAPPORT_*.md` ne doit contenir aucun emplacement fait de deux arobases (`tests/rapports.test.ts`).

## Branches

- Un sprint = une branche créée depuis `main` (`f7`, `f8`…). On ne commite jamais un sprint directement sur `main`.
- Après la validation d'Alioune : `git merge --ff-only`, étiquette `v0.N-adhera-FN`.
- **Pas de push** sans demande explicite.

## Déployer

- PM2 `adhera` sert **`/home/adhera-front/htdocs/app`** sur le port **3002** (`npm start -- -p 3002`, soit `next start`). nginx proxie `*.adhera.africa` vers ce port.
- ⚠️ `npm run build` **réécrit le `.next` que sert la production.** Il ne se lance dans ce dossier, suivi de `pm2 restart adhera`, **qu'après l'accord d'Alioune** : c'est le produit des clients.
- La branche extraite dans ce dossier est celle qui sera construite et servie.

## Recette

- Sur un tenant `f<N>-recette` créé par Alioune, avec des comptes du bureau sur ses propres adresses avec un suffixe : **jamais une adresse en `.test`**.
- Construire **hors production** : `git worktree add --detach` dans le scratchpad, `node_modules` **copié** (Turbopack refuse un lien symbolique), `next start` sur un autre port, et l'hôte du tenant mappé vers ce port dans le navigateur.
- Playwright : téléphone **390 × 844** pour le membre, ordinateur **1440 × 900** pour le bureau. Une capture par point recetté.
- La CSP interdit `unsafe-eval` : pas de `page.waitForFunction`.
- Un nouvel en-tête vers l'API se vérifie par une requête `OPTIONS` (CORS), pas seulement avec curl.
- **Aucun envoi WhatsApp**, aucun lien de membre dans une capture.

## Rapports

Chaque intervention se termine par un rapport écrit dans `_handoff/RAPPORT_<AAAA-MM-JJ>_<sujet>.md` : ce qui a changé, les sorties brutes des commandes, les captures, et ce que l'API ne servait pas. `_handoff/` est exclu du dépôt. Les captures servent à la relecture interne de DIGISSOL : aucune association ne valide le rendu.

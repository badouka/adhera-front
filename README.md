# Adhera — la page du membre et l'espace du bureau

L'écran que voit un membre quand il ouvre le lien reçu par WhatsApp :
ce qu'il doit, comment payer, « J'ai payé », ses reçus.

Pas de compte, pas de mot de passe : **le jeton de 64 caractères dans l'URL
est l'unique clé**. Le backend vit dans le Laravel d'EventFlow
(`api.eventflow.africa`, namespace `App\Membership`) et n'est pas modifié par
ce dépôt.

- Route du membre : `https://{slug}.adhera.africa/m/{jeton}`
- Le tenant est le sous-domaine, envoyé à l'API en en-tête `X-Tenant-Slug`.

## Lancer

```bash
npm ci
npm run dev        # http://localhost:3002
```

En local, le sous-domaine n'existe pas : passez le tenant en query, accepté
**uniquement** hors production — `http://localhost:3002/m/{jeton}?tenant=demo-asso`.

## Tester

```bash
npm test           # vitest, TZ=America/Los_Angeles forcé
npm run typecheck  # tsc --noEmit
```

Le fuseau hostile est forcé par le script : c'est le cas qui casse le
formatage des dates (`2027-03-13` relu à Los Angeles rend le 12 mars).

`tests/guards.test.ts` tient les garde-fous exécutables — R1 (aucun
formatage de montant côté client, hors l'exception § D), R2 (aucun fetch en
SSR), R3 (aucun hôte tiers dans `src/`), l'interdiction des couleurs en
hexadécimal hors de `tokens.css`, et ceux de l'étape 1 (vocabulaire du
membre, aucun champ « nom complet », aucun retri du registre). Chacun a sa
contre-épreuve.

## Déployer

```bash
npm ci && npm test && npm run build
pm2 start npm --name adhera -- start -- -p 3002
pm2 save
```

nginx proxie `*.adhera.africa` vers `127.0.0.1:3002`. Le redémarrage au boot
demande `pm2 startup` (root) : il n'est pas encore posé.

## R2 — pourquoi les données se chargent dans le navigateur

`src/app/m/[token]/page.tsx` est un composant serveur **sans aucun fetch** :
il ne fait que rendre `<MemberPage>`, qui appelle l'API depuis le navigateur.

Le limiteur `membership-public` compte 20 requêtes/min **par IP**. Un fetch
côté serveur ferait passer tous les membres derrière l'IP du VPS, et le 21ᵉ
membre de la minute recevrait un 429 — pendant une campagne, c'est la panne.

## Les autres règles qui ne se négocient pas

- **R1** — aucun montant servi par l'API n'est formaté ici : il s'affiche
  depuis son champ `*_formatted` ; l'autorité est `ReceiptData::formatAmount()`
  côté serveur. **Exception unique (§ D de l'étape 1)** : la SAISIE de
  l'utilisateur est réaffichée formatée avant l'envoi, pour qu'un zéro de
  trop saute aux yeux — par `formatTypedAmount` (`src/lib/typedAmount.ts`),
  que seuls les composants de saisie de montant ont le droit d'importer
  (liste blanche tenue par `tests/guards.test.ts`). Un montant ne se coupe
  jamais en deux lignes (`.money`, `.amount` : `nowrap`).
- **R3** — le jeton ne fuit pas : `Referrer-Policy: no-referrer`, aucun script
  tiers, police téléchargée au build et servie par l'app, `noindex, nofollow`,
  `rel="noreferrer"` sur le lien de reçu.
- **R4** — le comportement se branche sur le `code`, jamais sur le message ;
  le texte affiché est le `message` de l'API dès qu'il existe, les libellés
  locaux ne servent que de repli. Un code nouveau affiche le message de l'API :
  les tables de libellés par code (`BY_CODE`, `PROOF_CODES`, `RELOAD_CODES`)
  sont gelées, et `tests/guards.test.ts` refuse toute clé ajoutée. Les messages
  de validation d'un `422` s'affichent tels quels (`fieldMessages`) : l'API
  parle français partout dans Adhera (v3.8.2).
- **R5** — rien n'est mis en cache : `cache: 'no-store'` sur chaque appel, et
  la route est `force-dynamic`. **Une exception, bornée (F4)** : le service
  worker de la carte (`public/m/sw.js`), qui ne contrôle que `/m/` et garde,
  en « réseau d'abord », la dernière réponse de `GET m/{jeton}` pour montrer
  la carte hors connexion. Il ne garde jamais une requête qui porte
  `Authorization`, ni l'espace du bureau, ni `/v/`, ni un PDF
  (`tests/serviceWorker.test.ts` exécute le fichier livré).
- **R6** — le bouton principal dit ce qu'il fait : « J'ai payé », puis
  « Confirmer » (étape 1 : deux touchers). Le mode est préchoisi (Wave s'il
  est configuré), le montant est le solde ; autre montant, référence et
  capture sont facultatifs et repliés. Seul le bureau valide.
- **Vocabulaire du membre** — jamais « déclarer », « déclaration » ni
  « justificatif » à son écran : « J'ai payé », « signaler mon paiement »,
  « capture d'écran ». Un refus du bureau s'affiche au-dessus du montant
  (`last_rejection`), motif tel quel.
- **Prénom et nom** — deux champs distincts, en saisie comme en affichage
  (une organisation : « Raison sociale »). On affiche `name`, que le serveur
  dérive. Le registre arrive trié par nom de famille : jamais retrié ici.

## L'espace du bureau (`/bureau`, F2)

Le président, le trésorier, le secrétaire s'y connectent par e-mail et mot de
passe (`POST /admin/login`). Le geste le plus visible est **« Encaisser »**
(`/bureau/encaisser`) : chercher un membre, le toucher, « Encaisser {montant} »
— le reçu est émis. L'accueil est ensuite **« À valider »** : les paiements
signalés par les membres, que le bureau confirme d'un « Reçu ✓ » (ce qui émet
le reçu) ou refuse avec un motif **que le membre lira sur sa page**. Autour :
le registre, la fiche membre (lien WhatsApp, encaissement, sortie) et les
réglages.

Le contrat est `_handoff/adhera-api-bureau.md`, hors dépôt.

- **Un seul client HTTP** : `src/lib/bureau/api.ts`. Il lit les DEUX
  enveloppes (`{success, message, data}` pour `login`, réponse nue pour
  `admin/membership/*`).
- **R7** — le jeton vit en mémoire + `sessionStorage`
  (`src/lib/bureau/session.ts`), jamais ailleurs. Un `401` sur n'importe quelle
  route le purge et renvoie à `/bureau/connexion?session=expiree`.
- **R8** — ni `dangerouslySetInnerHTML`, ni `innerHTML`, ni `eval` dans `src/`.
- **R9** — chaque geste qui touche à l'argent ou à l'accès récapitule avant
  d'agir. Pour l'argent (encaisser, « Reçu ✓ », refuser), le récapitulatif
  tient sur UNE ligne au-dessus du bouton, dans un panneau léger : pas de
  seconde fenêtre. Régénérer un lien, déclarer une sortie, retirer un
  contact passent toujours par `ConfirmDialog`.
- Le reçu PDF exige le Bearer : il est tiré en blob, jamais par un lien nu.
- La capture du membre : lien signé de 60 min, demandé au clic, ouvert tel
  quel dans un nouvel onglet (servie `inline` depuis v3.5.7).
- Un `429` de connexion affiche le délai réel, en minutes arrondies au
  supérieur (`retry_after` du corps, puis l'en-tête `Retry-After`). L'API
  n'expose pas cet en-tête en CORS : sans `retry_after`, l'écran retombe sur
  la borne du limiteur reconnu à son `code` (1 minute par IP, 1 heure par
  compte).
- Les rôles ne cachent rien : le serveur ne les lit pas (contrat §2).

## F3 — tableau de bord, relances, campagnes, annulation

Le contrat est `_handoff/adhera-api-bureau.md` (§9 à §11).

- **L'accueil `/bureau` est le tableau de bord** : trois boutons (« Encaisser »,
  « À valider (n) », « À envoyer (n) » — un zéro reste visible, grisé), puis
  qui est à jour, combien est entré, combien reste à entrer. « Signalé » est
  une ligne à part, **jamais additionnée** à « encaissé » ; un taux `null`
  s'affiche « — ». Le graphique des 12 mois est un SVG écrit à la main
  (`EvolutionChart.tsx`) : aucune bibliothèque, garde-fou à l'appui. Les deux
  exports Excel sont tirés en blob avec le jeton.
- **« À valider »** a sa route : `/bureau/a-valider`.
- **« À envoyer »** (`/bureau/a-envoyer`) : la file WhatsApp, un membre à la
  fois. « Ouvrir WhatsApp » ne marque RIEN ; « Envoyé ✓ » déclare l'envoi et
  affiche la carte suivante ; « Passer » exige un motif. Le message est celui
  du serveur, et la file est relue après chaque geste (un membre qui a réglé
  disparaît sans bruit).
- **Campagnes** (`/bureau/campagnes`) : à qui, quand, avec ou sans e-mail, un
  récapitulatif d'une ligne, puis les nombres du serveur. Une campagne
  programmée s'annule ; `422 campaign_already_sent` recharge la liste.
- **Idempotency-Key** (`src/lib/idempotency.ts`) sur « Encaisser » et
  « J'ai payé » : une clé tirée à l'ouverture du panneau, gardée tant que
  l'envoi n'a pas réussi, renouvelée après un succès. `409 duplicate_payment`
  conduit au versement existant, sans proposer de recommencer.
- **Annuler un encaissement** (fiche membre, versement validé seulement) :
  motif de 10 caractères, récapitulatif des conséquences ; rien n'est
  supprimé, le reçu reste téléchargeable et marqué annulé — chez le membre
  aussi.
- **Vocabulaire** : « déclarer » et « justificatif » sont bannis de l'écran du
  bureau comme de celui du membre (« Enregistrer une sortie »).

En local, le tenant passe en query sur la page de connexion
(`/bureau/connexion?tenant=demo-asso`), puis voyage avec la session.

`tests/guards.test.ts` tient aussi R7, R8 et R1 étendu à `/bureau`, chacun
vérifié par contre-épreuve.

## La carte, l'attestation et la vérification (F4)

Tout est derrière l'option vendable `membership_card` (contrat §16,
`_handoff/adhera-api-bureau.md`). Sans elle, `card` vaut `null`
et la page du membre reste celle de F1.

- **« Ma carte » / « Ma cotisation »** (`/m/{jeton}`) : la carte s'ouvre pour
  un membre à jour, la cotisation sinon ; `?vue=carte` force la carte (c'est
  l'adresse de l'icône posée sur l'écran d'accueil). La carte porte le nom de
  **l'association**, jamais celui de la plateforme : la vue carte n'a ni
  en-tête doublé ni « Propulsé par Adhera ».
- **Le QR** de `verify_url` est engendré dans le navigateur par
  `qrcode-generator` (version exacte), chargé par `import()` dans
  `src/components/card/QrCode.tsx` seulement — un garde-fou le vérifie : il
  n'entre dans le premier chargement d'aucune route.
- **L'attestation** : le lien de l'API, tenant en query, comme un reçu ; un
  refus (`not_up_to_date`, `not_a_member`, `feature_disabled`,
  `issuer_missing`) s'affiche avec le `message` du serveur.
- **Le manifeste** reste (`/m/{jeton}/manifest.webmanifest`, R2 : le nom et
  l'icône arrivent dans son adresse), mais le bouton « Garder sur mon
  téléphone » a été retiré en F5 : voir plus bas. L'icône neutre est dans
  `public/carte/`.
- **`/v/{code}`** : la vérification publique, sans compte. Un seul cas
  d'erreur, le 404. Seul écran tourné vers un tiers à nommer la plateforme :
  « Vérification assurée par Adhera », en pied de page.
- **Bureau** : la colonne « N° » et le champ « Numéro de membre » (le 422 nomme
  le porteur, tel quel), les attestations de la fiche (si
  `features.membership_card === true`), et les « Années sans période
  enregistrée » (`missing_periods`). Ces deux blocs sont chargés à la demande :
  la fiche est au plafond de 200 Ko.


## F5 — le bureau simplifié, d'après la maquette validée

La référence de l'écran est la maquette cliquable `maquette-tresorier.zip`
(`_handoff/`), et ce que le serveur donne est le §18 du contrat
(`v3.8.4-adhera-simple`). Le principe : **la technologie s'adapte à
l'utilisateur** — un geste par écran, une phrase en tête, la preuve avant la
décision, des choix tout prêts, un mot par chose. Aucune fonction n'est
retirée : ce qui sert rarement est rangé dans « Plus ».

- **Quatre entrées** (N1) : Accueil · Membres · Paiements (avec le nombre à
  vérifier) · Plus. Barre du bas sur téléphone, barre latérale `ink` de
  248 px à partir de 1024 px. En tête : le nom de l'association, jamais
  coupé, et « Connecté·e : nom, rôle » lu par `GET admin/me`. Un écran d'un
  geste (refus, saisie, fiche, écrans de « Plus ») porte « Retour » à la
  place de l'en-tête et de la barre du bas (`useBackBar`).
- **Accueil** (`/bureau`) : tout vient du bloc `simple` de `GET dashboard` ;
  l'année est `simple.year`, jamais celle du téléphone. Les tuiles et les
  lignes ouvrent la liste filtrée (`?filtre=retard|a-jour|renouveler`).
- **Paiements à vérifier** (`/bureau/a-verifier`, l'ancienne `a-valider`
  y mène) : un à la fois, la preuve avant les deux décisions. Le refus prend
  une raison toute prête (`reason_code`, la phrase est composée et stockée
  par le serveur) ou un texte libre de 10 caractères, puis ouvre
  `share.whatsapp_url`. L'onglet est ouvert AU TOUCHER (`pendingTab.ts`) :
  un `window.open` après un `await` serait bloqué.
- **Un membre a payé** (`/bureau/enregistrer?membre={id}`, l'ancienne
  `encaisser` y mène) : quatre questions numérotées, la date toujours écrite
  en toutes lettres (P7), « Vous allez enregistrer », puis « C'est
  enregistré » et le reçu à envoyer par WhatsApp (`share`, ou « pas de
  téléphone »).
- **« Est-ce le même paiement ? »** : `409 possible_duplicate` (§18.1), pour
  la saisie comme pour « J'ai bien reçu cet argent ». « Oui » n'envoie rien ;
  « Non » rejoue avec `confirm_duplicate: true` et une `Idempotency-Key`
  NEUVE (la même clé avec un autre corps serait refusée). Jamais coché par
  défaut.
- **Les membres** : les actifs, dans l'ordre du serveur ; « En retard » /
  « À jour » selon `is_up_to_date`, « À renouveler » par
  `standing=renewing_soon`. « Imprimer cette liste » : une feuille A4 par
  `print:` (A12).
- **La fiche** : un seul montant, « {prénom} a payé : l'enregistrer » (le
  prénom remplace « il » et « elle »), ses paiements, les années non
  réclamées repliées (P6), et « Autres actions » pour le reste.
- **Plus** : relances, file WhatsApp, demandes d'adhésion, anciens membres,
  tous les paiements (A6), chiffres détaillés et Excel, types de membres,
  paramètres (les deux cases d'e-mail, §18.6), Mon profil (§18.7), mot de
  passe, déconnexion.
- **Page du membre** : « Bonjour {prénom} », « J'ai payé : le signaler »,
  « Ma carte de membre ». « Garder sur mon téléphone » est remplacé par
  **« Enregistrer ma carte dans mes photos »** : la carte est dessinée en
  PNG dans le navigateur (`cardImage.ts`, chargé par `import()` au toucher),
  puis partagée (`navigator.share({ files })`), téléchargée, ou — dans le
  navigateur intégré de WhatsApp — montrée en plein écran pour un appui long.
- **Un mot par chose** (A11) : `tests/guards.test.ts` (`LEXIQUE_BANNIS`)
  refuse dans tout texte affiché de `src/` les mots que le lexique bannit
  (versement, encaisser, valider, rejeté, reste dû, couvert, pas à jour,
  catégorie…), lus par l'analyseur de TypeScript. La liste vit là, une seule
  fois.

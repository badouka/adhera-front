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
- **R4** — le code d'erreur est le contrat, jamais le message.
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

Le contrat est `_handoff/adhera-api-bureau.md` (v3.7.2-adhera-S3c, §9 à §11).

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
`_handoff/adhera-api-bureau-s4a-extrait.md`). Sans elle, `card` vaut `null`
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
- **« Garder sur mon téléphone »** : un manifeste par membre
  (`/m/{jeton}/manifest.webmanifest`). R2 tient : le serveur Next n'appelle
  pas l'API, le nom et le logo arrivent dans l'adresse du manifeste, posée
  par la page. Invite de Chrome, notice de Safari, et — dans le navigateur
  intégré de WhatsApp, Facebook ou Instagram — « Ouvrez ce lien dans Chrome
  (ou Safari sur iPhone) » avec « Copier le lien ». L'icône neutre est dans
  `public/carte/`.
- **`/v/{code}`** : la vérification publique, sans compte. Un seul cas
  d'erreur, le 404. Seul écran tourné vers un tiers à nommer la plateforme :
  « Vérification assurée par Adhera », en pied de page.
- **Bureau** : la colonne « N° » et le champ « Numéro de membre » (le 422 nomme
  le porteur, tel quel), les attestations de la fiche (si
  `features.membership_card === true`), et les « Années sans période
  enregistrée » (`missing_periods`). Ces deux blocs sont chargés à la demande :
  la fiche est au plafond de 200 Ko.

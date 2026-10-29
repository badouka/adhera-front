# Adhera — la page du membre

L'écran que voit un membre quand il ouvre le lien reçu par WhatsApp :
ce qu'il doit, comment payer, la déclaration de son paiement, ses reçus.

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

`tests/guards.test.ts` tient quatre garde-fous exécutables — R1 (aucun
formatage de montant côté client), R2 (aucun fetch en SSR), R3 (aucun hôte
tiers dans `src/`), et l'interdiction des couleurs en hexadécimal hors de
`tokens.css`. Chacun a été vérifié par contre-épreuve : injection de la
violation, échec constaté, retrait.

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

- **R1** — aucun montant n'est formaté ici. Seuls les champs `*_formatted`
  servis par l'API sont affichés ; l'autorité est `ReceiptData::formatAmount()`
  côté serveur. Le seul nombre brut manipulé est la valeur du champ montant du
  formulaire.
- **R3** — le jeton ne fuit pas : `Referrer-Policy: no-referrer`, aucun script
  tiers, police téléchargée au build et servie par l'app, `noindex, nofollow`,
  `rel="noreferrer"` sur le lien de reçu.
- **R4** — le code d'erreur est le contrat, jamais le message.
- **R5** — rien n'est mis en cache : `cache: 'no-store'` sur chaque appel, et
  la route est `force-dynamic`. Pas de service worker, pas de PWA.
- **R6** — le bouton principal dit ce qu'il fait : « J'ai payé, je confirme »,
  puis « Envoyer ma confirmation ». Déclarer n'est pas payer ; seul le bureau
  valide.

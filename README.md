# CTF Writeups

Site local pour rédiger et archiver tes writeups de CTF / challenges : éditeur type Word,
cheatsheet de commandes, encodeur/décodeur, palette de commandes, thème clair ou sombre (bouton ☀/☾ en bas à gauche).

## Installation
    git clone https://github.com/akaabaneee/ctf-writeups.git
    cd ctf-writeups
    ./lancer.sh

Seul **Python 3** est nécessaire (aucune dépendance à installer). Tout tourne en local sur `127.0.0.1`,
tes writeups restent sur ta machine dans `data/` (ignoré par git).

## Lancer
    ./lancer.sh      # démarre le serveur et ouvre http://127.0.0.1:8137
    ./arreter.sh     # arrête le serveur

## Mettre en ligne sur Vercel (writeups enregistrés pour toujours)
1. Importe le repo sur Vercel (Framework : *Other*, rien d'autre à régler — `vercel.json` s'occupe du reste).
2. **Storage → Create Database → Blob** → crée-le et **connecte-le** au projet (Vercel ajoute `BLOB_STORE_ID`, ou `BLOB_READ_WRITE_TOKEN` sur les anciens stores).
3. **Settings → Environment Variables** → un mot de passe par compte (long, et différent pour chacun) :
   `CW_PASSWORD_BENJAMIN` et `CW_PASSWORD_HUGO`. L'ancien `CW_PASSWORD` reste accepté pour le compte benjamin.
4. **Redeploy**.

**Comptes** : le site a deux comptes, `benjamin` et `hugo`, choisis sur l'écran de verrouillage. Chacun a son espace
privé : un compte ne peut ni lister, ni ouvrir, ni modifier les writeups, images et commandes de l'autre
(c'est l'API qui cloisonne, pas seulement l'affichage). Pour ajouter un compte : `USERS` dans `api/main.js`.

Tes writeups et images sont alors stockés dans ton **Blob privé** Vercel : accessibles depuis n'importe quel
appareil après connexion, et personne d'autre ne peut les lire. Les writeups supprimés vont dans `trash/`.
Si le stockage n'est pas configuré, le site l'indique. Sans API du tout (hébergement purement statique),
il passe en mode navigateur (IndexedDB) et propose ensuite de transférer ces writeups dans le cloud.

## Où sont mes données ? (mode local avec ./lancer.sh)
- `data/writeups/*.json` : un fichier par writeup (métadonnées + contenu HTML)
- `data/images/`         : les images collées / glissées
- `data/corbeille/`      : writeups supprimés (récupérables : remets le fichier dans `data/writeups/` en retirant le suffixe `-<timestamp>`)
- Bouton ↓ (en bas à gauche) : télécharge une sauvegarde `.json` complète (images incluses), réimportable avec le bouton ↑.

## Fonctions
- Éditeur type Word (TinyMCE) : images collées/redimensionnables, code coloré, blocs terminal / flag / encadrés, modèle de writeup
- **Arsenal** (Ctrl+J) : cheatsheet de ~200 commandes CTF avec variables ({RHOST}, {LPORT}…), tes propres commandes,
  encodeur/décodeur (base64/32, hex, XOR, César, JWT, hash, auto-détection), sommaire du writeup
- **Palette** (Ctrl+K) : cherche writeups, commandes et actions au même endroit
- Tableau de bord : stats, activité, catégories, tags, favoris · mode focus · export HTML / Markdown / PDF

## Raccourcis
Ctrl+K palette · / filtrer · Ctrl+J cheatsheet · Ctrl+Maj+E encodeur · Ctrl+Maj+F focus · Ctrl+Alt+N nouveau ·
Ctrl+S enregistrer · Ctrl+P imprimer · Ctrl+E code en ligne · Ctrl+V coller une capture

## Ajouter des commandes à la cheatsheet
Depuis le site (« + Ma commande », stocké dans `data/cheatsheet.json`) ou en éditant `static/cheatsheet.js`.

Aucune dépendance : Python 3 (stdlib) + TinyMCE 7 et Prism embarqués dans `static/vendor/` (fonctionne hors-ligne).

## Licences
- TinyMCE 7 : GPLv2+ (`static/vendor/tinymce/license.md`)
- Prism : MIT · Inter et JetBrains Mono : SIL Open Font License

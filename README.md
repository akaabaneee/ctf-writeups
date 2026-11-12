# CTF Writeups

Site local pour rédiger et archiver tes writeups de CTF / challenges : éditeur type Word,
cheatsheet de commandes, encodeur/décodeur, palette de commandes, thème terminal.

## Installation
    git clone https://github.com/akaabaneee/ctf-writeups.git
    cd ctf-writeups
    ./lancer.sh

Seul **Python 3** est nécessaire (aucune dépendance à installer). Tout tourne en local sur `127.0.0.1`,
tes writeups restent sur ta machine dans `data/` (ignoré par git).

## Lancer
    ./lancer.sh      # démarre le serveur et ouvre http://127.0.0.1:8137
    ./arreter.sh     # arrête le serveur

## Mettre en ligne (Vercel, GitHub Pages…)
Le site marche aussi sans serveur Python : importe le repo sur Vercel, `vercel.json` sert le dossier `static/`.
En ligne, il passe en **mode navigateur** : chaque visiteur a ses writeups stockés dans **son propre navigateur**
(IndexedDB, images comprises) — personne ne voit ceux des autres. Pense au bouton **Backup** (fichier .json)
et à **Importer** pour passer d'un navigateur/PC à un autre.

## Où sont mes données ? (mode local avec ./lancer.sh)
- `data/writeups/*.json` : un fichier par writeup (métadonnées + contenu HTML)
- `data/images/`         : les images collées / glissées
- `data/corbeille/`      : writeups supprimés (récupérables : remets le fichier dans `data/writeups/` en retirant le suffixe `-<timestamp>`)
- Bouton « Sauvegarde » : télécharge un .zip de tout.

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

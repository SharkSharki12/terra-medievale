# Terra Médiévale

Jeu de construction de ville médiévale sur la **vraie Terre** : un globe 3D que l'on fait tourner, puis une carte 2D
à taille réelle (1 case = 10 m) où l'on fonde sa ville n'importe où. Application Windows (.exe) avec mise à jour
automatique, mode multijoueur en ligne et des centaines de villages IA qui grandissent en même temps que les joueurs.

## Télécharger

Prends `TerraMedievale.exe` dans la dernière [release](https://github.com/SharkSharki12/terra-medievale/releases/latest).
Le jeu se met ensuite à jour tout seul (vérification toutes les 3 heures, ou Menu → Réglages → Vérifier).

## Version 3.2 : compatible PEAM

- Succès, statistiques, présence visible par les amis et invitations « Rejoindre la partie » via la plateforme PEAM.
- `tools/publier-peam.sh 3.2.0` fabrique la version PEAM (licence PEAM, mises à jour gérées par PEAM) et son .zip avec `peam.json`.

## Nouveautés de la version 3.1.1

- Le terrain (côtes, rivières, forêts) est désormais identique pour tous les joueurs : les villes des autres sont bien sur la terre ferme, avec leurs routes.
- Alliances entre joueurs en multijoueur (vos armées défendent la ville de l'autre).
- Seigneur beaucoup plus rapide à pied, à cheval et en barque, sur toutes les routes (même celles des autres villages) et hors des routes.

## Nouveautés de la version 3.1

- **Habitants simulés un par un** : nom, famille, date de naissance, maison, métier, mariage, enfants, maladies, mort.
  Clique sur un habitant pour voir sa vie ; registre des habitants, des défunts et chronique de la ville (touche R).
- **Mode Seigneur** (touche L) : incarne ton seigneur et parcours la Terre à vitesse réelle, à pied, à cheval ou en barque.
- **Déplacements réalistes** : les habitants suivent les routes (recherche de chemin), charrettes, animaux, bateaux de pêche et navires.
- **13 nouveaux bâtiments** : chemin, rue pavée, porte fortifiée, cimetière, bergerie, boulangerie, apothicaire,
  tisserand, grenier, embarcadère, scierie, vignoble, monastère.
- **Meilleures routes** : chemins, routes et rues pavées, tracé en diagonale, ponts de bois ou de pierre, portes dans les remparts.
- **Villages IA** plus rapides et construits en damier (îlots, place du marché, remparts et portes, campagne, routes vers les voisins).
- **Diplomatie automatique** : les seigneurs IA écrivent des lettres (alliances, mariages, commerce, tributs, guerres, paix)
  et se font la guerre entre eux.

## Compiler

Il faut Go 1.24 et [rsrc](https://github.com/akavel/rsrc) (icône et manifeste Windows, déjà générés dans `rsrc_windows_amd64.syso`).

```sh
tools/publier.sh 3.2.1 "Notes de version"
```

produit `dist/TerraMedievale.exe` et `dist/latest.json`. Publie les deux fichiers dans une release `v3.2.1` :
les jeux déjà installés téléchargent `releases/latest/download/latest.json` pour trouver la nouvelle version.

## Organisation

- `main.go`, `ui_windows.go`, `hub.go`, `updater.go` : lanceur Go (serveur local, fenêtre WebView2, zone de notification,
  serveur multijoueur en connexion directe, mises à jour).
- `web/` : le jeu (JavaScript, sans dépendance de compilation), embarqué dans l'exe.
  - `js/game.js` ville et économie, `js/people.js` habitants, `js/life.js` et `js/nav.js` déplacements,
    `js/lord.js` mode Seigneur, `js/roads.js` routes, `js/bots.js` villages IA, `js/diplo.js` diplomatie, `js/war.js` guerre.
- `third_party/sys` : copie de `golang.org/x/sys` utilisée par le lanceur.

Géographie : Natural Earth, relief NASA.

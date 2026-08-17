# Security App Agency

Prototype PWA mobile pour le contrôle de tournées d'agents de sécurité.

## Fonctionnalités

- Connexion locale de l'agent par nom et matricule.
- Démarrage d'une tournée uniquement après scan du QR code du poste A.
- Validation de trois points de contrôle dans n'importe quel ordre.
- Clôture uniquement après les trois points, en rescannant le poste A.
- Journal des scans avec agent, point, type et heure.
- Annulation avec motif facultatif et suggestions : Incident, Urgence, QR code inaccessible.
- Nouvelle tournée possible immédiatement après clôture ou annulation.
- PWA installable avec cache hors ligne de l'interface.

Le prototype est volontairement local : les données sont conservées dans `localStorage`.

## Lancer localement

```powershell
npm start
```

Ouvrir ensuite :

```text
http://localhost:8080
```

Pour utiliser la caméra, ouvrez l'app depuis `localhost` dans un navigateur compatible avec `BarcodeDetector`. Si la caméra ou `BarcodeDetector` n'est pas disponible, utilisez la saisie manuelle dans le panneau de scan.

## Codes QR de test

- Poste A : `POST_A`
- Point 1 : `CP_1`
- Point 2 : `CP_2`
- Point 3 : `CP_3`

Les QR peuvent aussi contenir du JSON, par exemple :

```json
{ "pointId": "CP_1" }
```

## Vérifier

```powershell
npm test
```

# SAB Sécurité

Prototype PWA mobile pour le contrôle de tournées d'agents de sécurité.

## Fonctionnalités

- Connexion locale de l'agent par nom et matricule.
- Démarrage d'une tournée uniquement après scan du QR code du poste A.
- Validation de trois points de contrôle dans n'importe quel ordre.
- Clôture uniquement après les trois points, en rescannant le poste A.
- Écran commentaire optionnel après clôture de la tournée.
- Journal des scans avec agent, point, type et heure.
- Annulation avec motif facultatif et suggestions : Incident, Urgence, QR code inaccessible.
- Nouvelle tournée possible immédiatement après clôture ou annulation.
- PWA installable avec cache hors ligne de l'interface.
- Version web avec deux espaces : salarie agent et patron employeur.

L'application conserve une copie locale dans `localStorage` et synchronise les tournees avec Supabase lorsque la configuration est disponible.

## Lancer localement

```powershell
npm start
```

Ouvrir ensuite :

```text
http://localhost:8080
```

Espace patron :

```text
http://localhost:8080/manager.html
```

Pour utiliser la camera, ouvrez l'app depuis `localhost` ou depuis l'URL HTTPS publiee. Le scan QR se fait par camera ; la saisie manuelle n'est pas disponible dans l'interface agent.

## Codes QR de test

- Poste A : `POST_A`
- Point 1 : `CP_1`
- Point 2 : `CP_2`
- Point 3 : `CP_3`

Les QR peuvent aussi contenir du JSON, par exemple :

```json
{ "pointId": "CP_1" }
```

## Suite Supabase

La conception de la version web agent + patron est documentee dans :

```text
docs/supabase-web-test-plan.md
```

Pour connecter Supabase :

1. Creer un projet Supabase.
2. Executer le script SQL `supabase/schema.sql`.
3. Copier l'URL du projet et la cle `anon public`.
4. Renseigner `src/config.js`.

Sans ces valeurs, l'application reste en mode local de demonstration.

Si le projet Supabase existait avant l'ajout des commentaires de tournee, relancer au minimum cette ligne dans le SQL Editor :

```sql
alter table public.tours add column if not exists comment text;
```

## Vérifier

```powershell
npm test
```

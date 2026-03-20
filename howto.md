# Workflow

1) Déposer un fichier vidéo dans le dossier `/in`
2) Lancer `pnpm process-video` qui génère :
   - La diarisation (qui parle quand) et les sous-titres (.srt)
   - Le FCP XML pour import dans Final Cut Pro
   - Les vignettes
   - La version sans voix (vocal removed)
3) Corriger la diarisation manuellement dans Final Cut Pro
4) Enregistrer le FCPXML corrigé dans `out/final-xml/`
5) Lancer `pnpm batch-convert-xml` pour générer les JSON finaux

---

# Scripts disponibles

Tous les scripts se lancent depuis le dossier `obs-suite/`.

## Scripts principaux

### `pnpm process-video`

**Pipeline complet de traitement vidéo.** C'est le script principal à utiliser.

```bash
# Mode interactif - menu de sélection
pnpm process-video

# Traiter une vidéo spécifique
pnpm process-video video.mp4

# Traiter toutes les vidéos sans prompts
pnpm process-video --all

# Forcer la regénération (même si les fichiers existent)
pnpm process-video --all --force

# Uniquement le vocal removal (skip diarisation/XML/vignettes)
pnpm process-video --all --vocals-only

# Skip le vocal removal
pnpm process-video --all --skip-vocal-removal
```

**Fichiers générés par vidéo :**
- `out/video.cli.json` - Format WhisperX avec timestamps mot par mot
- `out/video.enhanced.json` - Format étendu avec scores de confiance
- `out/video.srt` - Sous-titres SRT
- `out/video.xml` - FCP XML pour import NLE
- `out/thumbs/video.jpg` - Vignette (320px)
- `out/final-vids/video.mp4` - Vidéo sans voix

### `pnpm batch-convert-xml`

**Convertit les XML corrigés en JSON.** À utiliser après correction manuelle dans Final Cut Pro.

```bash
# Avec prompts de confirmation
pnpm batch-convert-xml

# Forcer l'écrasement sans prompts
pnpm batch-convert-xml --force
```

**Entrée :** `out/final-xml/*.xml`
**Sortie :** `out/final-json/*.json`

---

## Scripts utilitaires

### `pnpm generate-fcpxml`

Génère un FCP XML depuis un fichier de diarisation CLI JSON.

```bash
pnpm generate-fcpxml <input.cli.json> <video.mp4> <output.xml>

# Exemple
pnpm generate-fcpxml ../out/scene.cli.json ../in/scene.mp4 ../out/scene.xml
```

### `pnpm convert-fcpxml`

Convertit un FCP XML en JSON pour l'overlay.

```bash
pnpm convert-fcpxml <input.xml> <output.json>

# Exemple
pnpm convert-fcpxml public/fcpxml/scene.xml public/tracks/scene.json
```

---

## Serveur de développement

### `pnpm dev`

Lance le serveur Next.js + WebSocket en mode développement.

- HTTP : `http://localhost:3006`
- WebSocket : `ws://localhost:3006/ws`
- Hot reload activé

### `pnpm build`

Build Next.js pour la production.

### `pnpm start`

Lance le serveur en mode production (après `pnpm build`).

### `pnpm lint`

Vérifie le code avec ESLint.
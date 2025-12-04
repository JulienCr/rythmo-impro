#!/bin/bash


# CLI interactif pour la diarisation de locuteurs
# Interactive CLI for speaker diarization

set -e

# Couleurs pour l'affichage
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if .env exists and load it
if [ -f "$SCRIPT_DIR/.env" ]; then
    # Load environment variables from .env
    set -a  # Automatically export all variables
    source "$SCRIPT_DIR/.env"
    set +a
fi

echo -e "${BLUE}${BOLD}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║     DIARISATION DE LOCUTEURS - RYTHMO IMPRO                   ║"
echo "║     Speaker Diarization - Interactive CLI                     ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Vérification du token Hugging Face
if [ -z "$HF_TOKEN" ]; then
    echo -e "${RED}❌ ERREUR: La variable d'environnement HF_TOKEN n'est pas définie${NC}"
    echo ""
    echo "Pour obtenir votre token:"
    echo "1. Créez un compte sur https://huggingface.co"
    echo "2. Allez dans Settings > Access Tokens"
    echo "3. Créez un nouveau token (read)"
    echo ""
    echo "Puis configurez-le avec l'une de ces méthodes:"
    echo ""
    echo "Méthode 1 (recommandée): Créez le fichier diarizer/.env"
    echo "  echo 'HF_TOKEN=votre_token_ici' > $SCRIPT_DIR/.env"
    echo ""
    echo "Méthode 2: Exportez la variable d'environnement"
    echo "  export HF_TOKEN='votre_token_ici'"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓ Token Hugging Face détecté${NC}"
echo ""

# Fonction pour demander une valeur avec une valeur par défaut
ask_with_default() {
    local prompt="$1"
    local default="$2"
    local var_name="$3"

    echo -e "${YELLOW}${prompt}${NC}"
    if [ -n "$default" ]; then
        read -p "$(echo -e ${BOLD}[Défaut: ${default}]${NC}) > " value
        eval $var_name="${value:-$default}"
    else
        read -p "> " value
        eval $var_name="$value"
    fi
}

# Fonction pour demander oui/non
ask_yes_no() {
    local prompt="$1"
    local default="$2"

    if [ "$default" = "y" ]; then
        read -p "$(echo -e ${YELLOW}${prompt}${NC} [O/n]) > " response
        response=${response:-o}
    else
        read -p "$(echo -e ${YELLOW}${prompt}${NC} [o/N]) > " response
        response=${response:-n}
    fi

    [[ "$response" =~ ^[oOyY]$ ]]
}

echo -e "${BLUE}${BOLD}═══ ÉTAPE 1: FICHIER VIDÉO ═══${NC}"
echo ""
echo "Placez votre fichier vidéo dans le dossier 'in/' à la racine du projet."
echo "Formats supportés: .mp4, .avi, .mov, .mkv, etc."
echo ""

# Vérifier que le dossier ./in existe
if [ ! -d "./in" ]; then
    echo -e "${RED}❌ ERREUR: Le dossier './in' n'existe pas${NC}"
    echo "Créez-le avec: mkdir -p ./in"
    exit 1
fi

# Lister les fichiers dans ./in
VIDEO_FILES=(./in/*)
if [ ${#VIDEO_FILES[@]} -eq 0 ] || [ ! -e "${VIDEO_FILES[0]}" ]; then
    echo -e "${RED}❌ ERREUR: Aucun fichier trouvé dans './in'${NC}"
    echo "Placez vos fichiers vidéo dans ce dossier."
    exit 1
fi

# Extraire juste les noms de fichiers (sans le chemin)
FILE_NAMES=()
for file in "${VIDEO_FILES[@]}"; do
    if [ -f "$file" ]; then
        FILE_NAMES+=("$(basename "$file")")
    fi
done

if [ ${#FILE_NAMES[@]} -eq 0 ]; then
    echo -e "${RED}❌ ERREUR: Aucun fichier trouvé dans './in'${NC}"
    echo "Placez vos fichiers vidéo dans ce dossier."
    exit 1
fi

# Menu de sélection
echo -e "${YELLOW}Sélectionnez le fichier vidéo à traiter:${NC}"
echo ""
PS3="$(echo -e ${BOLD}Votre choix [1-${#FILE_NAMES[@]}]:${NC} ) "
select VIDEO_FILE in "${FILE_NAMES[@]}"; do
    if [ -n "$VIDEO_FILE" ]; then
        echo ""
        echo -e "${GREEN}✓ Fichier sélectionné: ${BOLD}$VIDEO_FILE${NC}"
        break
    else
        echo -e "${RED}Choix invalide. Veuillez entrer un numéro entre 1 et ${#FILE_NAMES[@]}${NC}"
    fi
done

if [ ! -f "./in/$VIDEO_FILE" ]; then
    echo -e "${RED}❌ ERREUR: Le fichier './in/$VIDEO_FILE' n'existe pas${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}${BOLD}═══ ÉTAPE 2: MODÈLE WHISPER ═══${NC}"
echo ""
echo "Le modèle Whisper détermine la qualité de la transcription et de la diarisation."
echo ""

# Menu de sélection du modèle
MODELS=(
    "tiny|Le plus rapide, moins précis (tests)"
    "base|Rapide, précision correcte"
    "small|Bon équilibre vitesse/précision"
    "medium|Défaut, bonne précision (usage général) [RECOMMANDÉ]"
    "large|Très précis, plus lent"
    "large-v2|Version 2, très précis"
    "large-v3|Meilleure précision (production) [MEILLEUR]"
)

echo -e "${YELLOW}Sélectionnez le modèle Whisper:${NC}"
echo ""
PS3="$(echo -e ${BOLD}Votre choix [1-${#MODELS[@]}]:${NC} ) "
select MODEL_CHOICE in "${MODELS[@]}"; do
    if [ -n "$MODEL_CHOICE" ]; then
        MODEL="${MODEL_CHOICE%%|*}"
        echo ""
        echo -e "${GREEN}✓ Modèle sélectionné: ${BOLD}$MODEL${NC}"
        break
    else
        echo -e "${RED}Choix invalide. Veuillez entrer un numéro entre 1 et ${#MODELS[@]}${NC}"
    fi
done

echo ""
echo -e "${BLUE}${BOLD}═══ ÉTAPE 3: LANGUE ═══${NC}"
echo ""
echo "Spécifier la langue améliore la précision de la transcription."
echo ""

# Menu de sélection de la langue
LANGUAGES=(
    "auto|Détection automatique [RECOMMANDÉ]"
    "fr|Français"
    "en|Anglais"
)

echo -e "${YELLOW}Sélectionnez la langue de la vidéo:${NC}"
echo ""
PS3="$(echo -e ${BOLD}Votre choix [1-${#LANGUAGES[@]}]:${NC} ) "
select LANGUAGE_CHOICE in "${LANGUAGES[@]}"; do
    if [ -n "$LANGUAGE_CHOICE" ]; then
        LANGUAGE="${LANGUAGE_CHOICE%%|*}"
        echo ""
        echo -e "${GREEN}✓ Langue sélectionnée: ${BOLD}$LANGUAGE${NC}"
        break
    else
        echo -e "${RED}Choix invalide. Veuillez entrer un numéro entre 1 et ${#LANGUAGES[@]}${NC}"
    fi
done

echo ""
echo -e "${BLUE}${BOLD}═══ ÉTAPE 4: NOMBRE DE LOCUTEURS ═══${NC}"
echo ""
echo "Si vous connaissez le nombre de locuteurs, cela améliore grandement la précision."
echo "Cela évite la sur-segmentation (trop de locuteurs) ou la sous-segmentation (trop peu)."
echo ""

if ask_yes_no "Connaissez-vous le nombre minimum de locuteurs?" "n"; then
    ask_with_default "Nombre minimum de locuteurs:" "2" "MIN_SPEAKERS"
    ARGS_SPEAKERS="--min-speakers $MIN_SPEAKERS"
else
    ARGS_SPEAKERS=""
fi

if ask_yes_no "Connaissez-vous le nombre maximum de locuteurs?" "n"; then
    ask_with_default "Nombre maximum de locuteurs:" "4" "MAX_SPEAKERS"
    ARGS_SPEAKERS="$ARGS_SPEAKERS --max-speakers $MAX_SPEAKERS"
fi

echo ""
echo -e "${BLUE}${BOLD}═══ ÉTAPE 5: RÉGLAGES AVANCÉS ═══${NC}"
echo ""
echo "Ces paramètres permettent d'affiner la qualité de la segmentation."
echo ""

if ask_yes_no "Voulez-vous configurer les paramètres avancés?" "n"; then
    echo ""
    echo -e "${YELLOW}${BOLD}Seuil de silence (--silence-threshold)${NC}"
    echo "Coupe un segment quand le silence entre deux mots dépasse cette durée (en secondes)."
    echo "  • Plus bas (0.2-0.4): Segments plus courts, sensible aux pauses"
    echo "  • Plus haut (0.8-1.0): Tolère les pauses naturelles, segments plus longs"
    echo ""
    ask_with_default "Seuil de silence (secondes)?" "0.5" "SILENCE_THRESHOLD"

    echo ""
    echo -e "${YELLOW}${BOLD}Gap de fusion (--merge-gap)${NC}"
    echo "Fusionne les segments adjacents du même locuteur séparés par moins de cette durée."
    echo "  • Plus bas (0.2-0.3): Moins de fusion, préserve les frontières"
    echo "  • Plus haut (0.8-1.0): Fusion agressive, réduit la fragmentation"
    echo ""
    ask_with_default "Gap de fusion (secondes)?" "0.5" "MERGE_GAP"

    echo ""
    echo -e "${YELLOW}${BOLD}Durée minimale (--min-duration)${NC}"
    echo "Filtre les segments plus courts que cette durée (en secondes)."
    echo "  • Plus bas (0.1-0.2): Garde les courtes interjections ('oui', 'okay')"
    echo "  • Plus haut (0.5-1.0): Filtre les mots de remplissage"
    echo ""
    ask_with_default "Durée minimale (secondes)?" "0.3" "MIN_DURATION"

    echo ""
    echo -e "${YELLOW}${BOLD}Seuil de clustering (--clustering-threshold)${NC}"
    echo "Contrôle le regroupement des voix similaires au niveau de la diarisation."
    echo "  • Plus bas (0.5-0.6): Plus de locuteurs, moins de fusion"
    echo "  • Plus haut (0.8-1.0): Moins de locuteurs, plus de fusion"
    echo ""
    if ask_yes_no "Personnaliser le seuil de clustering?" "n"; then
        ask_with_default "Seuil de clustering?" "0.7" "CLUSTERING_THRESHOLD"
        ARGS_CLUSTERING="--clustering-threshold $CLUSTERING_THRESHOLD"
    else
        ARGS_CLUSTERING=""
    fi

    ARGS_ADVANCED="--silence-threshold $SILENCE_THRESHOLD --merge-gap $MERGE_GAP --min-duration $MIN_DURATION $ARGS_CLUSTERING"
else
    ARGS_ADVANCED=""
fi

echo ""
echo -e "${BLUE}${BOLD}═══ ÉTAPE 6: FICHIER DE SORTIE ═══${NC}"
echo ""
echo "Le fichier JSON sera créé dans le dossier 'out/'."
echo "Par défaut, il portera le même nom que la vidéo avec l'extension .json"
echo ""

# Nom de sortie par défaut basé sur le nom de la vidéo
DEFAULT_OUTPUT="${VIDEO_FILE%.*}.json"
ask_with_default "Nom du fichier de sortie:" "$DEFAULT_OUTPUT" "OUTPUT_FILE"

echo ""
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}                    RÉCAPITULATIF                              ${NC}"
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Vidéo d'entrée:        ${BOLD}$VIDEO_FILE${NC}"
echo -e "  Fichier de sortie:     ${BOLD}$OUTPUT_FILE${NC}"
echo -e "  Modèle Whisper:        ${BOLD}$MODEL${NC}"
echo -e "  Langue:                ${BOLD}$LANGUAGE${NC}"
if [ -n "$ARGS_SPEAKERS" ]; then
    echo -e "  Contraintes locuteurs: ${BOLD}$ARGS_SPEAKERS${NC}"
fi
if [ -n "$ARGS_ADVANCED" ]; then
    echo -e "  Paramètres avancés:    ${BOLD}Oui${NC}"
    [ -n "$SILENCE_THRESHOLD" ] && echo -e "    - Seuil silence:     ${BOLD}${SILENCE_THRESHOLD}s${NC}"
    [ -n "$MERGE_GAP" ] && echo -e "    - Gap fusion:        ${BOLD}${MERGE_GAP}s${NC}"
    [ -n "$MIN_DURATION" ] && echo -e "    - Durée minimale:    ${BOLD}${MIN_DURATION}s${NC}"
    [ -n "$CLUSTERING_THRESHOLD" ] && echo -e "    - Seuil clustering:  ${BOLD}${CLUSTERING_THRESHOLD}${NC}"
fi
echo ""
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo ""

if ! ask_yes_no "Lancer la diarisation avec ces paramètres?" "y"; then
    echo -e "${YELLOW}Annulé par l'utilisateur.${NC}"
    exit 0
fi

echo ""
echo -e "${BLUE}${BOLD}═══ LANCEMENT DE LA DIARISATION ═══${NC}"
echo ""

# Construction de la commande run-wsl.sh
# Les chemins sont relatifs au dossier diarizer/ où se trouve run-wsl.sh
RUN_WSL_CMD="$SCRIPT_DIR/run-wsl.sh \
  --input ../in/$VIDEO_FILE \
  --output ../out/$OUTPUT_FILE \
  --model $MODEL \
  --language $LANGUAGE \
  $ARGS_SPEAKERS \
  $ARGS_ADVANCED"

echo -e "${YELLOW}Commande:${NC}"
echo "$RUN_WSL_CMD"
echo ""
echo -e "${BLUE}Début du traitement...${NC}"
echo ""

# Exécution
eval $RUN_WSL_CMD

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}${BOLD}✓ DIARISATION TERMINÉE AVEC SUCCÈS!${NC}"
    echo ""
    echo -e "Le fichier de sortie est disponible à: ${BOLD}./out/$OUTPUT_FILE${NC}"
    echo ""
    echo -e "${YELLOW}Prochaines étapes:${NC}"
    echo "1. Copiez le fichier JSON dans obs-suite/public/cues/"
    echo "   cp ./out/$OUTPUT_FILE ./obs-suite/public/cues/"
    echo ""
    echo "2. Copiez la vidéo dans obs-suite/public/media/"
    echo "   cp ./in/$VIDEO_FILE ./obs-suite/public/media/"
    echo ""
    echo "3. Lancez le serveur Next.js:"
    echo "   cd obs-suite && pnpm dev"
    echo ""
    echo "4. Ouvrez l'overlay dans OBS Browser Source:"
    echo "   http://localhost:3000/overlay/rythmo?video=/media/$VIDEO_FILE&cues=/cues/$OUTPUT_FILE"
    echo ""
else
    echo -e "${RED}${BOLD}❌ ERREUR LORS DE LA DIARISATION${NC}"
    echo ""
    echo "Code d'erreur: $EXIT_CODE"
    echo "Vérifiez les logs ci-dessus pour plus de détails."
    echo ""
    exit $EXIT_CODE
fi

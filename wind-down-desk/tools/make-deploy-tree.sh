#!/bin/sh
# Copie allégée du dernier commit, prête à devenir le dépôt GitHub que Render construit (22 oct. 2026).
# Ne pousse rien, ne crée aucun dépôt distant : elle écrit un dossier, c'est tout.
#   sh tools/make-deploy-tree.sh [dossier de sortie, par défaut ../../wind-down-desk-deploy]
# Gardé : render.yaml + wind-down-desk/ (code, serveur, public/, tests, outils, réglages, licences, MEASUREMENTS.md
#        et ses petits fichiers de mesure JSON / TXT d'artifacts/solidite-29oct, jamais les images).
# Écarté : artifacts/ (≈ 213 Mo de vidéos et captures), archive/, film-set/ (décor de tournage, dev seulement),
#          dist/, notes internes (PLAN.md, TECH.md, DEVPOST.md, PLAYTEST.md, notes des agents,
#          .agents/, .codex/, .cursor/, opencode.json), et tout ce qui n'est pas commité.
# Résultat ≈ 20 Mo (dont 13 Mo de panoramas KTX2 dans public/environments, nécessaires à l'app).
set -eu
ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
OUT="${1:-$ROOT/../wind-down-desk-deploy}"
if [ -e "$OUT" ] && [ -n "$(ls -A "$OUT" 2>/dev/null)" ]; then
  echo "Le dossier $OUT existe déjà et n'est pas vide : choisissez-en un autre (rien n'a été écrit)." >&2
  exit 1
fi
mkdir -p "$OUT"
cd "$ROOT"
git archive --format=tar HEAD -- \
  render.yaml \
  wind-down-desk/src wind-down-desk/server wind-down-desk/public wind-down-desk/tests wind-down-desk/tools \
  wind-down-desk/index.html wind-down-desk/package.json wind-down-desk/package-lock.json \
  wind-down-desk/tsconfig.json wind-down-desk/tsconfig.node.json wind-down-desk/vite.config.ts \
  wind-down-desk/iwsdk.config.json wind-down-desk/pnpm-workspace.yaml wind-down-desk/.nvmrc wind-down-desk/.gitignore \
  wind-down-desk/LICENSE wind-down-desk/CREDITS.md wind-down-desk/README.md wind-down-desk/MEASUREMENTS.md \
  ':(glob)wind-down-desk/artifacts/solidite-29oct/*.json' ':(glob)wind-down-desk/artifacts/solidite-29oct/*.txt' \
  ':(glob)wind-down-desk/artifacts/solidite-29oct/long-final.jsonl' ':(glob)wind-down-desk/artifacts/solidite-29oct/prod-29oct/*.json' \
  ':(exclude,glob)wind-down-desk/artifacts/solidite-29oct/*-console.json' \
  | tar -x -C "$OUT"
cat > "$OUT/.gitignore" <<'EOF'
node_modules/
dist/
.env*
!.env.example
visits/
.DS_Store
EOF
echo "Copie allégée écrite dans $OUT ($(du -sh "$OUT" | cut -f1))."
echo "Ensuite (coordinateur) : cd \"$OUT\" && git init -b main && git add -A && git commit -m \"Wind-Down Desk\", puis le pousser vers le dépôt GitHub que Render lira."

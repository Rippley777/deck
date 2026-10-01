#!/usr/bin/env python3
"""Package a locally built portal for the Azure App Service F1 deployment."""

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


root = Path(__file__).resolve().parent.parent
target = root / "deck-azure-free.zip"
if not (root / "dist/index.html").is_file():
    raise SystemExit("Build first with VITE_DECK_PORTAL=true npm run build")

with ZipFile(target, "w", ZIP_DEFLATED) as archive:
    # Azure's F1 build installs production dependencies. Local assets are already
    # built, so the remote package must not invoke the dev-only TypeScript/Vite build.
    package = json.loads((root / "package.json").read_text())
    package["scripts"].pop("build", None)
    archive.writestr("package.json", json.dumps(package, indent=2) + "\n")
    for name in ("package-lock.json", "index.html", "vite.config.ts"):
        archive.write(root / name, name)
    for directory in ("src", "public", "server", "shared", "vendor", "dist"):
        for path in (root / directory).rglob("*"):
            if path.is_file() and ".DS_Store" not in path.parts:
                archive.write(path, path.relative_to(root))

print(target)

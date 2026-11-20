#!/usr/bin/env python3
"""
Zipt de inhoud van een folder naar backup.zip.

Werkwijze:
  1. Een bestaande backup.zip wordt hernoemd naar backup_ddmmyy.zip
     (datum = laatste wijzigingsdatum van die oude backup).
  2. Daarna wordt een nieuwe backup.zip gemaakt van de folderinhoud
     (inclusief submappen), zonder backup.zip en zonder oude backup_*.zip.

Gebruik:
  python backup_folder.py                 -> huidige folder
  python backup_folder.py "C:\\pad\\naar\\folder"
  python backup_folder.py /pad/naar/folder
"""
import sys
import zipfile
from datetime import datetime
from pathlib import Path

ZIP_NAME = "backup.zip"


def is_backup_file(path: Path) -> bool:
    name = path.name.lower()
    return name == ZIP_NAME or (name.startswith("backup_") and name.endswith(".zip"))


def main():
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    if not folder.is_dir():
        sys.exit(f"Folder niet gevonden: {folder}")

    backup = folder / ZIP_NAME

    # 1. Oude backup.zip hernoemen naar backup_ddmmyy.zip
    if backup.exists():
        # Wil je de datum van vandaag i.p.v. die van het bestand?
        # Vervang dan de volgende regel door: stamp = datetime.now().strftime("%d%m%y")
        stamp = datetime.fromtimestamp(backup.stat().st_mtime).strftime("%d%m%y")
        target = folder / f"backup_{stamp}.zip"
        n = 2
        while target.exists():  # twee backups op dezelfde dag: _2, _3, ...
            target = folder / f"backup_{stamp}_{n}.zip"
            n += 1
        backup.rename(target)
        print(f"Oude backup hernoemd naar {target.name}")

    # 2. Nieuwe backup.zip maken
    count = 0
    with zipfile.ZipFile(backup, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(folder.rglob("*")):
            if path.is_file() and not is_backup_file(path):
                zf.write(path, path.relative_to(folder))
                count += 1

    print(f"{count} bestanden gezipt naar {backup}")


if __name__ == "__main__":
    main()

"""
Build Script for Cloudflare Pages Manual Deployment
Creates a clean 'dist/' folder and packages 'cloudflare_deploy.zip'
"""

import os
import shutil
import zipfile
from pathlib import Path

def build():
    root_dir = Path(__file__).resolve().parent
    dist_dir = root_dir / "dist"
    zip_path = root_dir / "cloudflare_deploy.zip"

    include_patterns = [
        "index.html",
        "styles.css",
        "config.json",
        "assets",
        "vendor",
        "src",
        "li"
    ]

    print("==================================================")
    print(" Packaging GCS Certificate Portal for Cloudflare ")
    print("==================================================")

    # 1. Clean and rebuild dist/ directory
    if dist_dir.exists():
        shutil.rmtree(dist_dir)
    dist_dir.mkdir(parents=True, exist_ok=True)

    total_files = 0
    for item in include_patterns:
        item_path = root_dir / item
        if not item_path.exists():
            print(f"[!] Warning: {item} does not exist. Skipping.")
            continue

        dest_path = dist_dir / item
        if item_path.is_file():
            shutil.copy2(item_path, dest_path)
            total_files += 1
            print(f" [+] Copied: {item}")
        elif item_path.is_dir():
            shutil.copytree(item_path, dest_path)
            for _, _, files in os.walk(dest_path):
                total_files += len(files)
            print(f" [+] Copied folder: {item}/")

    # 2. Package cloudflare_deploy.zip from dist/
    if zip_path.exists():
        zip_path.unlink()

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(dist_dir):
            for file in files:
                file_full = Path(root) / file
                arcname = file_full.relative_to(dist_dir)
                zf.write(file_full, arcname=str(arcname).replace("\\", "/"))

    size_kb = zip_path.stat().st_size / 1024
    print("==================================================")
    print(f" Build Complete!")
    print(f" Total files packaged: {total_files}")
    print(f" Folder: {dist_dir} (Recommended: Drag this folder directly into Cloudflare!)")
    print(f" Archive: {zip_path.name} ({size_kb:.2f} KB)")
    print("==================================================")

if __name__ == "__main__":
    build()

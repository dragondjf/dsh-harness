#!/usr/bin/env python3
"""Link every workspace package into <pkg>/node_modules so dynamic imports
resolve in the green package.

pnpm only symlinks DECLARED deps. Packages that are imported at runtime but
not statically declared by the importer are then missing from the
node_modules walk and Node fails with ERR_MODULE_NOT_FOUND. Scanning every
packages/*/* and vendor/* workspace manifest and creating
node_modules/<name> -> source dir fixes all of them regardless of depth.
"""
import json
import os
import sys

pkg = sys.argv[1]
root_nm = os.path.join(pkg, "node_modules")
scanned = 0
linked = 0
for base in ("packages", "vendor"):
    top = os.path.join(pkg, base)
    if not os.path.isdir(top):
        continue
    for dirpath, dirs, files in os.walk(top):
        if "package.json" not in files:
            continue
        # skip nested node_modules trees
        if "node_modules" in dirpath.split(os.sep):
            continue
        pj = os.path.join(dirpath, "package.json")
        try:
            name = json.load(open(pj, encoding="utf-8")).get("name", "")
        except Exception:
            continue
        if not name or "/" not in name:
            continue
        scanned += 1
        tgt = os.path.join(root_nm, *name.split("/"))
        os.makedirs(os.path.dirname(tgt), exist_ok=True)
        rel = os.path.relpath(dirpath, os.path.dirname(tgt))
        if os.path.islink(tgt) or os.path.exists(tgt):
            continue
        try:
            os.symlink(rel, tgt)
            linked += 1
        except FileExistsError:
            pass
print(f"workspace manifests scanned={scanned} linked={linked}")

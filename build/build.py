#!/usr/bin/env python3
"""
============================================================
Catalogue Vestimentaire SRR - Script de build
============================================================

Transforme le catalogue YAML en site statique déployable :

    config/products.yaml  →  dist/
                              ├── index.html
                              ├── css/
                              ├── js/
                              │   ├── app.js
                              │   └── products-data.js   (données embarquées)
                              ├── assets/                (logos)
                              ├── images/                (photos produits)
                              └── catalogue.pdf          (catalogue complet)

Le YAML n'est PAS copié dans dist/ — seules les données nécessaires
sont embarquées dans products-data.js.

Usage :
    python3 build/build.py
    python3 build/build.py --source . --output dist

Dépendances :
    pip install pyyaml reportlab pillow
"""

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("ERREUR : PyYAML requis — pip install pyyaml", file=sys.stderr)
    sys.exit(1)

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import cm, mm
    from reportlab.platypus import (
        Image as RLImage,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )
except ImportError:
    print("ERREUR : reportlab requis — pip install reportlab", file=sys.stderr)
    sys.exit(1)


# ==========================================================
# Configuration / constantes
# ==========================================================
COLOR_BLACK = colors.HexColor("#0f0f10")
COLOR_RED = colors.HexColor("#c8102e")
COLOR_DARK_GRAY = colors.HexColor("#6b6b70")
COLOR_LIGHT_GRAY = colors.HexColor("#f5f5f7")
COLOR_MEDIUM_GRAY = colors.HexColor("#d8d8dc")

GENRES_VALIDES = ("hommes", "femmes", "mixtes", "enfants")

GENRE_LABELS = {
    "hommes": "HOMMES",
    "femmes": "FEMMES",
    "mixtes": "MIXTES",
    "enfants": "ENFANTS",
}


# ==========================================================
# Chargement et validation
# ==========================================================
def load_config(yaml_path: Path) -> dict:
    """Charge et valide le fichier YAML."""
    if not yaml_path.exists():
        raise FileNotFoundError(f"Fichier introuvable : {yaml_path}")
    with open(yaml_path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    validate_config(data)
    return data


def validate_config(data: dict) -> None:
    """Vérifie la cohérence de la structure du catalogue."""
    for key in ("boutique", "categories", "produits"):
        if key not in data:
            raise ValueError(f"Clé manquante dans le YAML : '{key}'")

    category_ids = {c["id"] for c in data["categories"]}
    seen_skus = {}

    for idx, p in enumerate(data["produits"]):
        prod_label = p.get("nom", f"#{idx + 1}")

        # Champs obligatoires au niveau produit
        for req in ("nom", "categorie", "couleurs", "genres"):
            if req not in p:
                raise ValueError(
                    f"Produit '{prod_label}' : champ requis '{req}' manquant"
                )

        if p["categorie"] not in category_ids:
            raise ValueError(
                f"Produit '{prod_label}' : catégorie inconnue '{p['categorie']}'"
            )

        couleurs = p["couleurs"]
        if not isinstance(couleurs, list) or not couleurs:
            raise ValueError(
                f"Produit '{prod_label}' : 'couleurs' doit être une liste non vide"
            )
        for c in couleurs:
            if not isinstance(c, str):
                raise ValueError(
                    f"Produit '{prod_label}' : les couleurs doivent être de simples "
                    f"chaînes (ex. \"Noir\")"
                )

        genres = p["genres"]
        if not isinstance(genres, dict) or not genres:
            raise ValueError(
                f"Produit '{prod_label}' : 'genres' doit être un dictionnaire "
                f"avec au moins une des clés {GENRES_VALIDES}"
            )

        for genre_key, variant in genres.items():
            if genre_key not in GENRES_VALIDES:
                raise ValueError(
                    f"Produit '{prod_label}' : genre inconnu '{genre_key}' "
                    f"(valides : {GENRES_VALIDES})"
                )
            if not isinstance(variant, dict):
                raise ValueError(
                    f"Produit '{prod_label}' / genre '{genre_key}' : doit être "
                    f"un dictionnaire avec les clés prix / tailles / sku"
                )
            for sub in ("prix", "tailles", "sku"):
                if sub not in variant:
                    raise ValueError(
                        f"Produit '{prod_label}' / genre '{genre_key}' : "
                        f"champ '{sub}' manquant"
                    )
            if not isinstance(variant["tailles"], list) or not variant["tailles"]:
                raise ValueError(
                    f"Produit '{prod_label}' / genre '{genre_key}' : "
                    f"'tailles' doit être une liste non vide"
                )

            sku_dict = variant["sku"]
            if not isinstance(sku_dict, dict) or not sku_dict:
                raise ValueError(
                    f"Produit '{prod_label}' / genre '{genre_key}' : "
                    f"'sku' doit être un dict {{couleur: référence}} non vide"
                )

            # Chaque clé de sku doit exister dans la liste des couleurs
            for couleur_sku in sku_dict.keys():
                if couleur_sku not in couleurs:
                    raise ValueError(
                        f"Produit '{prod_label}' / genre '{genre_key}' : "
                        f"la couleur SKU '{couleur_sku}' ne figure pas dans "
                        f"'couleurs' {couleurs}"
                    )

            # Détection des doublons de SKU (doivent être uniques globalement)
            for couleur, ref in sku_dict.items():
                if ref in seen_skus:
                    raise ValueError(
                        f"Référence fournisseur dupliquée '{ref}' : "
                        f"{seen_skus[ref]} et {prod_label}/{genre_key}/{couleur}"
                    )
                seen_skus[ref] = f"{prod_label}/{genre_key}/{couleur}"


# ==========================================================
# Génération du site statique
# ==========================================================
def write_products_data_js(data: dict, out_path: Path) -> None:
    """
    Génère le fichier JS qui expose window.PRODUCTS_DATA.
    C'est ce fichier — et non le YAML — qui sera servi au navigateur.
    """
    public_data = {
        "boutique": {
            "nom_club": data["boutique"].get("nom_club", ""),
            "nom_boutique": data["boutique"].get("nom_boutique", ""),
            "email_contact": data["boutique"].get("email_contact", ""),
            "devise": data["boutique"].get("devise", "€"),
            "logo_simple": data["boutique"].get("logo_simple", "logo_simple.png"),
            "logo_detaille": data["boutique"].get("logo_detaille", "logo_detailles.jpg"),
        },
        "categories": data["categories"],
        "produits": data["produits"],
    }
    js_body = "/* Auto-généré par build.py — ne pas éditer directement. */\n"
    js_body += "window.PRODUCTS_DATA = "
    js_body += json.dumps(public_data, ensure_ascii=False, indent=2)
    js_body += ";\n"
    out_path.write_text(js_body, encoding="utf-8")


def copy_static_files(src_root: Path, dist: Path) -> None:
    """Copie les fichiers à servir tels quels."""
    # Fichiers à la racine
    for name in ("index.html",):
        shutil.copy2(src_root / name, dist / name)

    # Dossiers à recopier intégralement
    for folder in ("css", "js", "assets", "images"):
        src = src_root / folder
        dest = dist / folder
        if dest.exists():
            shutil.rmtree(dest)
        if src.exists():
            shutil.copytree(src, dest)

    # Supprimer les READMEs internes éventuels qui auraient pu être copiés
    for junk in dist.rglob("README.txt"):
        junk.unlink()


# ==========================================================
# Génération du catalogue PDF
# ==========================================================
def build_catalog_pdf(data: dict, src_root: Path, out_pdf: Path) -> None:
    """
    Génère un catalogue PDF du club à partir des données.
    Format A4, sobre, logo détaillé en en-tête sans fond coloré.
    """
    boutique = data["boutique"]
    logo_detaille = src_root / "assets" / boutique.get("logo_detaille", "logo_detailles.jpg")
    images_dir = src_root / "images" / "produits"

    doc = SimpleDocTemplate(
        str(out_pdf),
        pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title=f"Catalogue - {boutique.get('nom_club', '')}",
        author=boutique.get("nom_club", ""),
    )

    styles = getSampleStyleSheet()
    style_title = ParagraphStyle(
        "Title", parent=styles["Title"],
        fontSize=20, textColor=COLOR_BLACK,
        alignment=1, spaceAfter=6,
    )
    style_sub = ParagraphStyle(
        "Sub", parent=styles["Normal"],
        fontSize=11, textColor=COLOR_RED,
        alignment=1, spaceAfter=18,
    )
    style_cat = ParagraphStyle(
        "Cat", parent=styles["Heading2"],
        fontSize=15, textColor=COLOR_BLACK,
        spaceBefore=14, spaceAfter=8,
    )
    style_prod_name = ParagraphStyle(
        "ProdName", parent=styles["Normal"],
        fontSize=11, textColor=COLOR_BLACK, fontName="Helvetica-Bold",
        leading=13,
    )
    style_prod_brand = ParagraphStyle(
        "ProdBrand", parent=styles["Normal"],
        fontSize=8, textColor=COLOR_DARK_GRAY, leading=10,
        fontName="Helvetica-Oblique",
    )
    style_prod_meta = ParagraphStyle(
        "ProdMeta", parent=styles["Normal"],
        fontSize=8, textColor=COLOR_DARK_GRAY, leading=10,
    )
    style_prod_genre = ParagraphStyle(
        "ProdGenre", parent=styles["Normal"],
        fontSize=9, textColor=COLOR_BLACK, fontName="Helvetica-Bold",
        leading=11, spaceBefore=3,
    )
    style_prod_variant = ParagraphStyle(
        "ProdVariant", parent=styles["Normal"],
        fontSize=8, textColor=COLOR_DARK_GRAY, leading=10,
        leftIndent=6,
    )

    story = []

    # En-tête — logo détaillé SANS fond coloré
    if logo_detaille.exists():
        try:
            img = RLImage(str(logo_detaille), width=6 * cm, height=3 * cm, kind="proportional")
            img.hAlign = "CENTER"
            story.append(img)
            story.append(Spacer(1, 6 * mm))
        except Exception as exc:
            print(f"  ! Logo PDF non utilisable ({exc}) — en-tête textuel à la place")

    story.append(Paragraph(boutique.get("nom_club", ""), style_title))
    story.append(Paragraph(
        f"Catalogue Vestimentaire · édition {_today_fr()}",
        style_sub,
    ))

    # Liste des produits par catégorie
    categories = {c["id"]: c for c in data["categories"]}
    prods_by_cat = {cid: [] for cid in categories}
    for p in data["produits"]:
        prods_by_cat[p["categorie"]].append(p)

    for cat in data["categories"]:
        prods = prods_by_cat.get(cat["id"], [])
        if not prods:
            continue
        story.append(Paragraph(cat["nom"], style_cat))
        story.append(_hr(COLOR_RED, thickness=1))
        story.append(Spacer(1, 4 * mm))

        # Grille 2 colonnes de cartes produit
        rows = []
        for i in range(0, len(prods), 2):
            pair = prods[i:i + 2]
            row = [_build_product_cell(
                       p, images_dir,
                       style_prod_name, style_prod_brand,
                       style_prod_meta, style_prod_genre,
                       style_prod_variant,
                   ) for p in pair]
            if len(row) == 1:
                row.append("")
            rows.append(row)

        tbl = Table(rows, colWidths=[8.5 * cm, 8.5 * cm], hAlign="LEFT")
        tbl.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("BOX", (0, 0), (-1, -1), 0.3, COLOR_MEDIUM_GRAY),
            ("GRID", (0, 0), (-1, -1), 0.3, COLOR_MEDIUM_GRAY),
        ]))
        story.append(tbl)
        story.append(Spacer(1, 6 * mm))

    doc.build(
        story,
        onFirstPage=_draw_footer,
        onLaterPages=_draw_footer,
    )


def _build_product_cell(produit, images_dir,
                        style_name, style_brand, style_meta,
                        style_genre, style_variant):
    """
    Construit le contenu d'une cellule produit dans le catalogue PDF.

    Format d'affichage attendu :

        Nom de l'article
        Marque — Collection XXXX
        Existe en COULEUR1, COULEUR2, ...

        Modèle HOMMES — 28,00 € TTC
          Tailles : S, M, L, XL, 2XL
        Modèle FEMMES — 28,00 € TTC
          Tailles : XS, S, M, L, XL
    """
    from reportlab.platypus import Table as _T, TableStyle as _TS, Image as _Img

    elements = []

    # Image
    img_path = None
    for fname in (produit.get("images") or []):
        candidate = images_dir / fname
        if candidate.exists():
            img_path = candidate
            break
    if img_path:
        try:
            img = _Img(str(img_path), width=3.5 * cm, height=3.5 * cm, kind="proportional")
            elements.append(img)
        except Exception:
            elements.append(Paragraph("(image non disponible)", style_meta))
    else:
        elements.append(Paragraph("(image non disponible)", style_meta))

    elements.append(Spacer(1, 2 * mm))

    # Nom
    elements.append(Paragraph(produit["nom"], style_name))

    # Marque — Collection
    brand_bits = []
    if produit.get("marque"):
        brand_bits.append(produit["marque"])
    if produit.get("collection"):
        brand_bits.append(produit["collection"])
    if brand_bits:
        elements.append(Paragraph(" — ".join(brand_bits), style_brand))

    # Existe en COULEUR1, COULEUR2, ...
    couleurs = produit.get("couleurs") or []
    if couleurs:
        elements.append(Paragraph(
            f"Existe en {', '.join(couleurs)}", style_meta
        ))

    # Description éventuelle
    descr = produit.get("description")
    if descr:
        elements.append(Spacer(1, 1 * mm))
        elements.append(Paragraph(descr, style_meta))

    # Pour chaque genre : "Modèle XXX — prix / Tailles : ..."
    genres = produit.get("genres") or {}
    # Ordonner les genres pour affichage déterministe
    for genre_key in GENRES_VALIDES:
        if genre_key not in genres:
            continue
        variant = genres[genre_key]
        label = GENRE_LABELS.get(genre_key, genre_key.upper())
        prix = _fmt_eur(variant["prix"])
        elements.append(Paragraph(
            f"Modèle {label} — <font color='#c8102e'><b>{prix} TTC</b></font>",
            style_genre,
        ))
        tailles = variant.get("tailles") or []
        if tailles:
            elements.append(Paragraph(
                f"Tailles : {', '.join(tailles)}", style_variant,
            ))

    # Empiler proprement dans une sous-table
    inner = _T([[e] for e in elements], colWidths=[7.5 * cm])
    inner.setStyle(_TS([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return inner


def _fmt_eur(prix) -> str:
    return f"{float(prix):.2f} €".replace(".", ",")


def _hr(color, thickness=0.5):
    """Petite barre horizontale stylisée (via Table)."""
    t = Table([[""]], colWidths=[17 * cm], rowHeights=[thickness])
    t.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), thickness, color),
    ]))
    return t


def _draw_footer(canvas_obj, doc):
    """Pied de page discret."""
    canvas_obj.saveState()
    canvas_obj.setFont("Helvetica", 8)
    canvas_obj.setFillColor(COLOR_DARK_GRAY)
    page_num = canvas_obj.getPageNumber()
    canvas_obj.drawCentredString(
        A4[0] / 2, 10 * mm,
        f"Société des régates Rennaises · Catalogue Vestimentaire · page {page_num}"
    )
    canvas_obj.restoreState()


def _today_fr() -> str:
    import datetime
    mois = ["janvier", "février", "mars", "avril", "mai", "juin",
            "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
    d = datetime.date.today()
    return f"{d.day} {mois[d.month - 1]} {d.year}"


# ==========================================================
# Entrée principale
# ==========================================================
def main() -> int:
    parser = argparse.ArgumentParser(description="Build du catalogue SRR")
    parser.add_argument("--source", default=".", help="Racine du projet")
    parser.add_argument("--output", default="dist", help="Dossier de sortie")
    parser.add_argument("--skip-pdf", action="store_true",
                        help="Ne pas générer le catalogue PDF")
    args = parser.parse_args()

    src = Path(args.source).resolve()
    dist = Path(args.output).resolve()

    print(f"-> Source : {src}")
    print(f"-> Sortie : {dist}")

    yaml_path = src / "config" / "products.yaml"
    data = load_config(yaml_path)
    nb_variantes = sum(len(p.get("genres", {})) for p in data["produits"])
    print(f"OK YAML : {len(data['produits'])} modèles, "
          f"{nb_variantes} variantes de genre, "
          f"{len(data['categories'])} catégories")

    # Nettoyer + recréer dist/
    if dist.exists():
        shutil.rmtree(dist)
    dist.mkdir(parents=True)

    # 1. Copier les fichiers statiques
    copy_static_files(src, dist)
    print("OK fichiers statiques copiés")

    # 2. Générer products-data.js
    js_out = dist / "js" / "products-data.js"
    js_out.parent.mkdir(parents=True, exist_ok=True)
    write_products_data_js(data, js_out)
    print(f"OK données embarquées : {js_out.relative_to(dist)}")

    # 3. Générer le catalogue PDF
    if not args.skip_pdf:
        try:
            pdf_out = dist / "catalogue.pdf"
            build_catalog_pdf(data, src, pdf_out)
            size_kb = pdf_out.stat().st_size / 1024
            print(f"OK catalogue PDF : {pdf_out.relative_to(dist)} ({size_kb:.0f} Ko)")
        except Exception as exc:
            print(f"! Echec génération PDF : {exc}", file=sys.stderr)

    print(f"\nBuild terminé -> {dist}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

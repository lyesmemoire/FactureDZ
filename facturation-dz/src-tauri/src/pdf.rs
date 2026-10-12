//! Moteur PDF natif (§23) — généré LOCALEMENT, sans Internet.
//! Basé sur printpdf (Rust pur, aucune dépendance système Windows).
//! Polices libres embarquées : LiberationSans + LiberationMono
//! (resources/fonts, voir docs/INSTALLATION.md).
//!
//! Mise en page : A4 portrait, marges 15 mm, tableau des lignes en
//! chasse fixe (LiberationMono) pour des colonnes parfaitement alignées.

use std::fs;
use std::path::Path;

use printpdf::indices::{PdfLayerIndex, PdfPageIndex};
use printpdf::image::{self, DynamicImage, GenericImageView};
use printpdf::{Color, IndirectFontRef, Image, Mm, PdfDocument, PdfDocumentReference, Rgb};
use serde::Deserialize;

use crate::error::{AppError, Result};
use crate::money_fr::{amount_in_words, devise_symbole, format_money};

#[derive(Deserialize)]
pub struct PdfParty {
    pub display_name: String,
    pub adresse: Option<String>,
    pub telephone: Option<String>,
    pub email: Option<String>,
    pub rc: Option<String>,
    pub nif: Option<String>,
    pub nis: Option<String>,
    pub article_imposition: Option<String>,
}

#[derive(Deserialize)]
pub struct PdfLine {
    pub designation: String,
    pub qty: f64,
    pub unite: String,
    pub pu_ht_cents: i64,
    pub remise_pct: f64,
    pub tax_rate_pct: f64,
    pub ht_cents: i64,
}

#[derive(Deserialize)]
pub struct PdfModel {
    pub doc_title: String,          // FACTURE / AVOIR / DEVIS…
    pub number: String,
    pub date: String,
    pub date_echeance: Option<String>,
    pub seller: PdfParty,
    pub buyer: PdfParty,
    pub lines: Vec<PdfLine>,
    pub total_ht_cents: i64,
    pub total_tva_cents: i64,
    /// Autres taxes/droits/contributions (§10) — agrégées hors TVA.
    #[serde(default)]
    pub total_other_taxes_cents: i64,
    pub total_ttc_cents: i64,
    pub vat_detail: Vec<(String, i64, i64)>, // (libellé, base, montant)
    /// Détail des autres taxes (libellé, base, montant).
    #[serde(default)]
    pub other_tax_detail: Vec<(String, i64, i64)>,
    pub conditions_paiement: Option<String>,
    pub banque: Option<String>,
    pub rib: Option<String>,
    pub observations: Option<String>,
    /// Conditions de vente facultatives (devis uniquement).
    #[serde(default)]
    pub conditions_vente: Option<String>,
    pub annulee: bool,
    /// Monnaie du document : DZD (défaut), EUR ou USD (§42).
    #[serde(default)]
    pub devise: Option<String>,
    /// Logo de l'entreprise (data URL PNG/JPEG). Absent ou illisible → document sans logo.
    #[serde(default)]
    pub logo_data_url: Option<String>,
}

/* ------------------------------------------------------------------ */
/* Constantes de mise en page (mm)                                     */
/* ------------------------------------------------------------------ */

const PAGE_W: f64 = 210.0;
const PAGE_H: f64 = 297.0;
const MARGIN: f64 = 15.0;
const CONTENT_W: f64 = PAGE_W - 2.0 * MARGIN;
const BOTTOM: f64 = 22.0;

const BRAND: (f64, f64, f64) = (0.117, 0.227, 0.541);
const RED: (f64, f64, f64) = (0.72, 0.11, 0.11);
const GREY: (f64, f64, f64) = (0.33, 0.33, 0.33);
const BLACK: (f64, f64, f64) = (0.0, 0.0, 0.0);

fn color(c: (f64, f64, f64)) -> Color {
    Color::Rgb(Rgb::new(c.0, c.1, c.2, None))
}

/// Montant suivi du symbole de la monnaie du document (§42).
fn da(cents: i64, devise: &str) -> String {
    format!("{} {}", format_money(cents), devise_symbole(devise))
}

/// Largeur d'un caractère en fonction de la taille (estimation).
fn char_mm(size_pt: f64, mono: bool) -> f64 {
    size_pt * 0.3528 * if mono { 0.60 } else { 0.52 }
}

fn wrap(text: &str, max_chars: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for word in text.split_whitespace() {
        if cur.is_empty() {
            cur = word.to_string();
        } else if cur.chars().count() + 1 + word.chars().count() <= max_chars {
            cur.push(' ');
            cur.push_str(word);
        } else {
            out.push(std::mem::take(&mut cur));
            cur = word.to_string();
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    if out.is_empty() {
        out.push(String::new());
    }
    out
}

fn fmt_qty(q: f64) -> String {
    let s = format!("{:.3}", q);
    let s = s.trim_end_matches('0').trim_end_matches('.');
    s.replace('.', ",")
}

/* ------------------------------------------------------------------ */
/* Curseur de page avec saut de page automatique                       */
/* ------------------------------------------------------------------ */

struct Ctx {
    doc: PdfDocumentReference,
    page: PdfPageIndex,
    layer: PdfLayerIndex,
    y: f64, // position courante mesurée depuis le HAUT de la page
}

impl Ctx {
    fn new(doc: PdfDocumentReference, page: PdfPageIndex, layer: PdfLayerIndex) -> Self {
        Ctx { doc, page, layer, y: MARGIN + 2.0 }
    }

    fn layer_ref(&self) -> printpdf::PdfLayerReference {
        self.doc.get_page(self.page).get_layer(self.layer)
    }

    /// Saute de page si le bloc ne tient pas.
    fn ensure(&mut self, need_mm: f64) {
        if self.y + need_mm > PAGE_H - BOTTOM {
            let (p, l) = self.doc.add_page(Mm(PAGE_W), Mm(PAGE_H), "Page suivante");
            self.page = p;
            self.layer = l;
            self.y = MARGIN + 2.0;
        }
    }

    fn text(&mut self, s: &str, size_pt: f64, x_mm: f64, c: (f64, f64, f64), font: &IndirectFontRef) {
        let layer = self.layer_ref();
        layer.set_fill_color(color(c));
        layer.use_text(s.to_string(), size_pt, Mm(x_mm), Mm(PAGE_H - self.y), font);
    }

    fn advance(&mut self, mm: f64) {
        self.y += mm;
    }

    /// Paragraphe justifié à gauche, retour à la ligne automatique.
    fn paragraph(&mut self, text: &str, size_pt: f64, c: (f64, f64, f64), font: &IndirectFontRef) {
        let max_chars = ((CONTENT_W / char_mm(size_pt, false)) as usize).max(20);
        for line in wrap(text, max_chars) {
            self.ensure(size_pt * 0.5);
            self.text(&line, size_pt, MARGIN, c, font);
            self.advance(size_pt * 0.5);
        }
    }
}

/* ------------------------------------------------------------------ */
/* Tableau des lignes (chasse fixe)                                    */
/* ------------------------------------------------------------------ */

// Colonnes en caractères mono : n° / désignation / qté / PU HT / TVA / total HT
const COL_NO: usize = 3;
const COL_DES: usize = 50;
const COL_QTY: usize = 9;
const COL_PU: usize = 13;
const COL_TVA: usize = 6;
const COL_HT: usize = 15;

fn trim_width(s: &str, max: usize) -> String {
    let mut chars: Vec<char> = s.chars().take(max).collect();
    if s.chars().count() > max {
        if chars.len() >= 2 {
            chars[max - 1] = '…';
        }
    }
    chars.into_iter().collect()
}

fn table_row(no: &str, designation: &str, qty: &str, pu: &str, tva: &str, ht: &str) -> String {
    format!(
        "{:<no_w$} {:<des_w$} {:>qty_w$} {:>pu_w$} {:>tva_w$} {:>ht_w$}",
        no,
        trim_width(designation, COL_DES),
        trim_width(qty, COL_QTY),
        trim_width(pu, COL_PU),
        trim_width(tva, COL_TVA),
        trim_width(ht, COL_HT),
        no_w = COL_NO,
        des_w = COL_DES,
        qty_w = COL_QTY,
        pu_w = COL_PU,
        tva_w = COL_TVA,
        ht_w = COL_HT,
    )
}

fn load_font(doc: &PdfDocumentReference, fonts_dir: &Path, name: &str) -> Result<IndirectFontRef> {
    let path = fonts_dir.join(format!("{name}.ttf"));
    let file = fs::File::open(&path).map_err(|_| {
        AppError::User(format!(
            "Police introuvable : {}. Copiez les polices Liberation (libres) dans resources/fonts — voir docs/INSTALLATION.md.",
            path.display()
        ))
    })?;
    doc.add_external_font(file)
        .map_err(|e| AppError::Other(format!("Chargement de la police {name} : {e}")))
}

/* ------------------------------------------------------------------ */
/* Rendu                                                               */
/* ------------------------------------------------------------------ */

pub fn render_invoice_pdf(model: &PdfModel, out_path: &Path, fonts_dir: &Path) -> Result<()> {
    let dev = model.devise.as_deref().unwrap_or("DZD");
    let (doc, page1, layer1) = PdfDocument::new(
        &format!("{} {}", model.doc_title, model.number),
        Mm(PAGE_W),
        Mm(PAGE_H),
        "Page 1",
    );
    let sans = load_font(&doc, fonts_dir, "LiberationSans-Regular")?;
    let sans_bold = load_font(&doc, fonts_dir, "LiberationSans-Bold")?;
    let mono = load_font(&doc, fonts_dir, "LiberationMono-Regular")?;

    let mut ctx = Ctx::new(doc, page1, layer1);
    let line_h = 4.2; // hauteur de ligne corps 9 pt

    // ---- Bandeau annulation (§21) ----
    if model.annulee {
        ctx.ensure(line_h + 2.0);
        ctx.text(
            "DOCUMENT ANNULÉ — conservé à titre de trace (§21)",
            11.0,
            MARGIN,
            RED,
            &sans_bold,
        );
        ctx.advance(line_h + 2.0);
    }

    // ---- Logo de l'entreprise (haut à gauche) ----
    if let Some(img) = model.logo_data_url.as_deref().and_then(decode_logo) {
        place_logo(&mut ctx, &img);
    }

    // ---- En-tête : vendeur (gauche) / titre et numéro (droite) ----
    ctx.paragraph(&model.seller.display_name, 11.0, BRAND, &sans_bold);
    for opt in [
        model.seller.adresse.as_deref(),
        model.seller.telephone.as_deref(),
        model.seller.email.as_deref(),
    ] {
        if let Some(t) = opt.filter(|t| !t.trim().is_empty()) {
            ctx.ensure(line_h);
            ctx.text(t, 9.0, MARGIN, GREY, &sans);
            ctx.advance(line_h);
        }
    }
    let ids = format!(
        "RC : {}   NIF : {}\nNIS : {}   AI : {}",
        model.seller.rc.as_deref().unwrap_or("—"),
        model.seller.nif.as_deref().unwrap_or("—"),
        model.seller.nis.as_deref().unwrap_or("—"),
        model.seller.article_imposition.as_deref().unwrap_or("—"),
    );
    ctx.ensure(line_h * 2.0);
    for (i, l) in ids.lines().enumerate() {
        ctx.text(l, 8.5, MARGIN, GREY, &sans);
        ctx.advance(if i == 0 { line_h } else { line_h });
    }
    ctx.advance(1.0);

    // Bloc titre/numéro à droite (rendu ligne à ligne à x fixe).
    let title_x = 128.0;
    let saved_y = ctx.y;
    ctx.y = MARGIN + 2.0;
    ctx.text(&model.doc_title, 16.0, title_x, BRAND, &sans_bold);
    ctx.advance(6.5);
    ctx.text(&format!("N° : {}", model.number), 10.0, title_x, BLACK, &sans_bold);
    ctx.advance(4.8);
    ctx.text(&format!("Date : {}", model.date), 9.0, title_x, BLACK, &sans);
    ctx.advance(4.2);
    if let Some(ech) = &model.date_echeance {
        ctx.text(&format!("Échéance : {ech}"), 9.0, title_x, BLACK, &sans);
        ctx.advance(4.2);
    }
    ctx.y = saved_y.max(ctx.y);
    ctx.advance(2.0);

    // ---- Acheteur ----
    ctx.ensure(line_h * 4.0);
    ctx.text("ACHETEUR", 9.0, MARGIN, BRAND, &sans_bold);
    ctx.advance(line_h);
    ctx.paragraph(&model.buyer.display_name, 10.0, BLACK, &sans_bold);
    for opt in [model.buyer.adresse.as_deref()] {
        if let Some(t) = opt.filter(|t| !t.trim().is_empty()) {
            ctx.ensure(line_h);
            ctx.text(t, 9.0, MARGIN, BLACK, &sans);
            ctx.advance(line_h);
        }
    }
    let buyer_ids = format!(
        "RC : {}   NIF : {}   NIS : {}   AI : {}",
        model.buyer.rc.as_deref().unwrap_or("—"),
        model.buyer.nif.as_deref().unwrap_or("—"),
        model.buyer.nis.as_deref().unwrap_or("—"),
        model.buyer.article_imposition.as_deref().unwrap_or("—"),
    );
    ctx.ensure(line_h);
    ctx.text(&buyer_ids, 8.5, MARGIN, GREY, &sans);
    ctx.advance(line_h + 3.0);

    // ---- Tableau des lignes (§23) ----
    ctx.ensure(line_h * 2.0);
    let header = table_row("N°", "Désignation", "Qté", "PU HT", "TVA", "Total HT");
    ctx.text(&header, 8.0, MARGIN, BRAND, &mono);
    ctx.advance(line_h);
    let rule = "─".repeat(header.chars().count().min(110));
    ctx.text(&rule, 8.0, MARGIN, GREY, &mono);
    ctx.advance(line_h);

    for (i, l) in model.lines.iter().enumerate() {
        let qty_str = format!("{} {}", fmt_qty(l.qty), l.unite);
        let tva_str = if l.tax_rate_pct == 0.0 {
            "Exo.".to_string()
        } else {
            format!("{} %", fmt_qty(l.tax_rate_pct))
        };
        let row = table_row(
            &format!("{}", i + 1),
            &l.designation,
            &qty_str,
            &da(l.pu_ht_cents, dev),
            &tva_str,
            &da(l.ht_cents, dev),
        );
        ctx.ensure(line_h);
        ctx.text(&row, 8.0, MARGIN, BLACK, &mono);
        ctx.advance(line_h * 0.95);
        if l.remise_pct > 0.0 {
            ctx.ensure(line_h * 0.9);
            ctx.text(
                &format!("     dont remise {} %", fmt_qty(l.remise_pct)),
                7.5,
                MARGIN,
                GREY,
                &mono,
            );
            ctx.advance(line_h * 0.85);
        }
    }
    ctx.ensure(line_h);
    ctx.text(&rule, 8.0, MARGIN, GREY, &mono);
    ctx.advance(line_h + 1.0);

    // ---- Totaux (§15) : labels à droite, montants alignés ----
    let label_x = 110.0;
    let amount_x = PAGE_W - MARGIN; // alignement à droite via mono
    let total_row = |ctx: &mut Ctx, label: &str, amount: &str, bold: bool| {
        ctx.ensure(line_h);
        let font = if bold { &sans_bold } else { &sans };
        ctx.text(label, 9.0, label_x, BLACK, font);
        // montant cadré à droite : longueur mono connue (15 colonnes)
        let cell = format!("{:>COL_HT$}", amount, COL_HT = COL_HT);
        let width = char_mm(8.0, true) * cell.chars().count() as f64;
        ctx.text(&cell, 8.0, amount_x - width, BLACK, &mono);
        ctx.advance(line_h);
    };

    total_row(&mut ctx, "TOTAL HT", &da(model.total_ht_cents, dev), false);
    for (lib, _base, amount) in &model.vat_detail {
        total_row(&mut ctx, lib, &da(*amount, dev), false);
    }
    for (lib, _base, amount) in &model.other_tax_detail {
        total_row(&mut ctx, lib, &da(*amount, dev), false);
    }
    if model.total_other_taxes_cents > 0 && model.other_tax_detail.is_empty() {
        total_row(&mut ctx, "Autres taxes", &da(model.total_other_taxes_cents, dev), false);
    }
    total_row(&mut ctx, "TOTAL TTC", &da(model.total_ttc_cents, dev), true);
    ctx.advance(2.0);

    // ---- Montant en lettres (§16) ----
    ctx.ensure(line_h * 2.0);
    ctx.text("Arrêté le présent document à la somme de :", 9.0, MARGIN, BLACK, &sans_bold);
    ctx.advance(line_h);
    ctx.paragraph(&amount_in_words(model.total_ttc_cents, dev), 9.0, BLACK, &sans);
    ctx.advance(2.0);

    // ---- Pied : conditions, banque, observations (§24, §40) ----
    if let Some(c) = &model.conditions_paiement {
        ctx.ensure(line_h);
        ctx.text(&format!("Conditions de paiement : {c}"), 9.0, MARGIN, BLACK, &sans);
        ctx.advance(line_h);
    }
    if let Some(mode) = None::<String> {
        let _ = mode;
    }
    if let Some(b) = &model.banque {
        ctx.ensure(line_h);
        ctx.text(&format!("Banque : {b}"), 9.0, MARGIN, BLACK, &sans);
        ctx.advance(line_h);
    }
    if let Some(r) = &model.rib {
        ctx.ensure(line_h);
        ctx.text(&format!("RIB : {r}"), 9.0, MARGIN, BLACK, &sans);
        ctx.advance(line_h);
    }
    if let Some(c) = &model.conditions_vente {
        ctx.advance(1.0);
        ctx.paragraph(&format!("Conditions de vente : {c}"), 8.5, GREY, &sans);
    }
    if let Some(o) = &model.observations {
        ctx.advance(1.0);
        ctx.paragraph(&format!("Observations : {o}"), 8.5, GREY, &sans);
    }

    // ---- Cachet / signature (§24) ----
    ctx.ensure(line_h * 3.0);
    ctx.advance(line_h);
    ctx.text("Cachet de l'entreprise", 9.0, MARGIN, GREY, &sans);
    ctx.text("Signature", 9.0, 140.0, GREY, &sans);
    ctx.advance(line_h * 2.0);

    // ---- Sauvegarde ----
    if let Some(parent) = out_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let file = fs::File::create(out_path)
        .map_err(|e| AppError::User(format!("Création du PDF impossible : {e}")))?;
    ctx.doc
        .save(&mut std::io::BufWriter::new(file))
        .map_err(|e| AppError::Other(format!("Génération du PDF : {e}")))?;
    log::info!("PDF généré : {out_path:?}");
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Logo                                                                */
/* ------------------------------------------------------------------ */

/// Dimensions maximales du logo sur le document (mm) : il ne doit pas
/// écraser l'en-tête, et sa résolution d'impression reste de 300 dpi.
const LOGO_MAX_W_MM: f64 = 50.0;
const LOGO_MAX_H_MM: f64 = 22.0;
const LOGO_DPI: f64 = 300.0;

/// Décode une data URL `data:image/png;base64,…` (ou jpeg). Retourne None si
/// le contenu est absent ou illisible : le document est alors émis sans logo.
pub fn decode_logo(data_url: &str) -> Option<DynamicImage> {
    use base64::Engine;
    let (meta, b64) = data_url.split_once(',')?;
    if !meta.starts_with("data:image/") || !meta.ends_with(";base64") {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64.trim()).ok()?;
    image::load_from_memory(&bytes).ok()
}

/// Place le logo en haut à gauche, à l'échelle, puis réserve sa hauteur.
fn place_logo(ctx: &mut Ctx, img: &DynamicImage) {
    let nat_w = img.width() as f64 / LOGO_DPI * 25.4;
    let nat_h = img.height() as f64 / LOGO_DPI * 25.4;
    if nat_w <= 0.0 || nat_h <= 0.0 {
        return;
    }
    let scale = (LOGO_MAX_W_MM / nat_w).min(LOGO_MAX_H_MM / nat_h).min(1.0);
    let h = nat_h * scale;
    ctx.ensure(h + 3.0);
    let layer = ctx.layer_ref();
    // add_to_layer(calque, x, y du coin bas-gauche, rotation, échelle x/y, dpi)
    Image::from_dynamic_image(img).add_to_layer(
        layer,
        Some(Mm(MARGIN)),
        Some(Mm(PAGE_H - ctx.y - h)),
        None,
        Some(scale),
        Some(scale),
        Some(LOGO_DPI),
    );
    ctx.advance(h + 3.0);
}

#[cfg(test)]
mod logo_tests {
    use super::*;

    /// PNG 1×1 valide (base64).
    const PNG_1PX: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    #[test]
    fn decode_accepte_png_valide() {
        assert!(decode_logo(PNG_1PX).is_some());
    }

    fn modele(logo: Option<&str>) -> PdfModel {
        serde_json::from_value(serde_json::json!({
            "doc_title": "FACTURE",
            "number": "FAC-2026-000001",
            "date": "01/01/2026",
            "date_echeance": null,
            "seller": { "display_name": "Entreprise Test SARL" },
            "buyer": { "display_name": "Client Test" },
            "lines": [],
            "total_ht_cents": 0,
            "total_tva_cents": 0,
            "total_ttc_cents": 0,
            "vat_detail": [],
            "conditions_paiement": null,
            "banque": null,
            "rib": null,
            "observations": null,
            "conditions_vente": null,
            "annulee": false,
            "logo_data_url": logo,
        }))
        .unwrap()
    }

    fn rendre(m: &PdfModel, nom: &str) -> Vec<u8> {
        let out = std::env::temp_dir().join(nom);
        let fonts = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join("fonts");
        render_invoice_pdf(m, &out, &fonts).expect("rendu PDF");
        let octets = std::fs::read(&out).unwrap();
        let _ = std::fs::remove_file(&out);
        octets
    }

    #[test]
    fn pdf_avec_logo_contient_une_image() {
        let avec = rendre(&modele(Some(PNG_1PX)), "logo_test_avec.pdf");
        let sans = rendre(&modele(None), "logo_test_sans.pdf");
        assert!(avec.windows(6).any(|w| w == b"/Image"), "le logo doit être intégré");
        assert!(!sans.windows(6).any(|w| w == b"/Image"), "sans logo, aucune image");
    }

    #[test]
    fn logo_illisible_n_empeche_pas_le_document() {
        let m = modele(Some("data:image/png;base64,%%%invalide"));
        let octets = rendre(&m, "logo_test_invalide.pdf");
        assert!(octets.starts_with(b"%PDF"));
    }

    #[test]
    fn decode_refuse_contenu_invalide() {
        assert!(decode_logo("").is_none());
        assert!(decode_logo("pas une data url").is_none());
        assert!(decode_logo("data:text/plain;base64,aGVsbG8=").is_none());
        assert!(decode_logo("data:image/png;base64,%%%").is_none());
    }
}

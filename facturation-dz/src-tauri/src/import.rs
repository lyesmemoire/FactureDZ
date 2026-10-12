//! Lecture des fichiers d'import (Excel) : .xlsx / .xls / .ods via calamine, .csv maison.
//! Ne fait qu'extraire des cellules sous forme de texte ; le mapping et la validation
//! sont faits côté interface (src/core/importTable.ts).

use std::io::Cursor;

use base64::Engine;
use calamine::{Data, Reader};

use crate::error::AppError;

pub const MAX_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_ROWS: usize = 5_000;

pub type Table = Vec<Vec<String>>;

/// Décode le contenu base64 envoyé par l'interface, puis lit la première feuille ou le CSV.
pub fn read_table_b64(file_name: &str, data_b64: &str) -> Result<Table, AppError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_b64.trim())
        .map_err(|_| AppError::User("Fichier illisible (encodage invalide).".into()))?;
    read_table(file_name, &bytes)
}

pub fn read_table(file_name: &str, bytes: &[u8]) -> Result<Table, AppError> {
    if bytes.len() > MAX_BYTES {
        return Err(AppError::User("Fichier trop volumineux (10 Mo maximum).".into()));
    }
    let lower = file_name.to_lowercase();
    let rows = if lower.ends_with(".csv") {
        parse_csv(bytes)
    } else if lower.ends_with(".xlsx") || lower.ends_with(".xls") || lower.ends_with(".ods") {
        parse_workbook(bytes)?
    } else {
        return Err(AppError::User(
            "Format non pris en charge : utilisez .xlsx, .xls, .ods ou .csv.".into(),
        ));
    };
    // Lignes entièrement vides ignorées
    let mut rows: Table = rows
        .into_iter()
        .filter(|r| r.iter().any(|c| !c.trim().is_empty()))
        .collect();
    if rows.is_empty() {
        return Err(AppError::User("Le fichier ne contient aucune donnée.".into()));
    }
    if rows.len() > MAX_ROWS + 1 {
        return Err(AppError::User(format!(
            "Trop de lignes ({} maximum, en-tête compris).",
            MAX_ROWS + 1
        )));
    }
    // Largeur uniforme pour toutes les lignes
    let width = rows.iter().map(|r| r.len()).max().unwrap_or(0);
    for r in rows.iter_mut() {
        r.resize(width, String::new());
    }
    Ok(rows)
}

fn parse_workbook(bytes: &[u8]) -> Result<Table, AppError> {
    let mut wb = calamine::open_workbook_auto_from_rs(Cursor::new(bytes.to_vec())).map_err(|_| {
        AppError::User("Classeur Excel illisible ou protégé par mot de passe.".into())
    })?;
    let range = match wb.worksheet_range_at(0) {
        Some(Ok(r)) => r,
        _ => return Err(AppError::User("Aucune feuille lisible dans le classeur.".into())),
    };
    Ok(range
        .rows()
        .map(|row| row.iter().map(cell_to_string).collect())
        .collect())
}

pub fn cell_to_string(c: &Data) -> String {
    match c {
        Data::Empty => String::new(),
        Data::String(s) => s.trim().to_string(),
        Data::Float(f) => {
            if f.fract() == 0.0 && f.abs() < 1e15 {
                format!("{}", *f as i64)
            } else {
                format!("{}", f)
            }
        }
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => {
            if *b {
                "1".into()
            } else {
                "0".into()
            }
        }
        Data::DateTime(dt) => dt
            .as_datetime()
            .map(|d| d.format("%Y-%m-%d").to_string())
            .unwrap_or_default(),
        Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
        Data::Error(_) => String::new(),
    }
}

/// CSV avec séparateur « ; » ou « , » (détecté sur la première ligne), guillemets doubles,
/// BOM UTF-8 accepté, fins de ligne CRLF ou LF.
pub fn parse_csv(bytes: &[u8]) -> Table {
    let text = String::from_utf8_lossy(bytes);
    let text: &str = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let first_line = text.lines().next().unwrap_or("");
    let delim = if first_line.matches(';').count() >= first_line.matches(',').count() {
        ';'
    } else {
        ','
    };

    let mut rows: Table = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if in_quotes {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(ch);
            }
        } else {
            match ch {
                '"' => in_quotes = true,
                c if c == delim => {
                    row.push(field.trim().to_string());
                    field.clear();
                }
                '\r' => {}
                '\n' => {
                    row.push(field.trim().to_string());
                    field.clear();
                    rows.push(std::mem::take(&mut row));
                }
                c => field.push(c),
            }
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field.trim().to_string());
        rows.push(row);
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_point_virgule_et_guillemets() {
        let src = "Dénomination;NIF;Adresse\r\n\"Ets \"\"Benali\"\"\";0001;\"Rue, 12\"\r\n";
        let t = read_table("clients.csv", src.as_bytes()).unwrap();
        assert_eq!(t.len(), 2);
        assert_eq!(t[1], vec!["Ets \"Benali\"", "0001", "Rue, 12"]);
    }

    #[test]
    fn csv_virgule_et_bom() {
        let src = "\u{feff}reference,designation\nA1,Papier\n";
        let t = read_table("produits.csv", src.as_bytes()).unwrap();
        assert_eq!(t[0], vec!["reference", "designation"]);
        assert_eq!(t[1], vec!["A1", "Papier"]);
    }

    #[test]
    fn fichier_vide_refuse() {
        assert!(read_table("vide.csv", b"\n\n").is_err());
    }

    #[test]
    fn format_inconnu_refuse() {
        assert!(read_table("x.pdf", b"abc").is_err());
    }

    #[test]
    fn xlsx_invalide_message_utilisateur() {
        let e = read_table("x.xlsx", b"pas un zip").unwrap_err();
        assert!(e.user_message().contains("Classeur Excel illisible"));
    }

    #[test]
    fn trop_gros_refuse() {
        let big = vec![b'a'; MAX_BYTES + 1];
        assert!(read_table("x.csv", &big).is_err());
    }

    #[test]
    fn cellules_nombres_entiers_sans_decimale() {
        assert_eq!(cell_to_string(&Data::Float(1200.0)), "1200");
        assert_eq!(cell_to_string(&Data::Float(12.5)), "12.5");
        assert_eq!(cell_to_string(&Data::Empty), "");
    }
}

#[cfg(test)]
mod xlsx_tests {
    use super::*;

    #[test]
    fn lit_un_vrai_classeur_xlsx() {
        let bytes = include_bytes!("../tests/fixtures/sample.xlsx");
        let t = read_table("sample.xlsx", bytes).unwrap();
        assert_eq!(t[0], vec!["Type", "Dénomination", "NIF", "Wilaya", "Prix unitaire", "Email"]);
        assert_eq!(t[1][0], "ENTREPRISE");
        assert_eq!(t[1][2], "1234567890123456");
        assert_eq!(t[1][4], "1200.5");
        assert_eq!(t[2][1], "");
        assert_eq!(t.len(), 3);
    }
}

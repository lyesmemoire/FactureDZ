//! Montants en lettres — français (§16). Miroir exact du moteur TypeScript
//! (testé par la suite §64/§65). Le montant en lettres est TOUJOURS calculé
//! côté backend à partir du TTC final : jamais modifiable par l'utilisateur.

const UNITS: &[&str] = &[
    "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit",
    "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
    "dix-sept", "dix-huit", "dix-neuf",
];

const TENS: &[&str] = &["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];

fn two_digits(n: u64, elide_s: bool) -> String {
    if n < 20 {
        return UNITS[n as usize].to_string();
    }
    if n < 70 {
        let t = (n / 10) as usize;
        let u = (n % 10) as usize;
        if u == 0 {
            return TENS[t].to_string();
        }
        if u == 1 {
            return format!("{} et un", TENS[t]);
        }
        return format!("{}-{}", TENS[t], UNITS[u]);
    }
    if n < 80 {
        if n == 71 {
            return "soixante et onze".to_string();
        }
        return format!("soixante-{}", UNITS[(n - 60) as usize]);
    }
    if n == 80 {
        return if elide_s { "quatre-vingt".into() } else { "quatre-vingts".into() };
    }
    format!("quatre-vingt-{}", UNITS[(n - 80) as usize])
}

fn chunk(n: u64, elide_s: bool) -> String {
    let h = n / 100;
    let r = n % 100;
    let mut out = String::new();
    if h == 1 {
        out.push_str("cent");
    } else if h > 1 {
        out.push_str(&format!(
            "{} cent{}",
            UNITS[h as usize],
            if r == 0 && !elide_s { "s" } else { "" }
        ));
    }
    if r > 0 {
        let t = two_digits(r, elide_s);
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&t);
    }
    out
}

pub fn int_to_words_fr(mut n: u64) -> String {
    if n == 0 {
        return "zéro".to_string();
    }
    let mut parts: Vec<String> = Vec::new();
    let milliards = n / 1_000_000_000;
    n %= 1_000_000_000;
    let millions = n / 1_000_000;
    n %= 1_000_000;
    let milliers = n / 1000;
    let reste = n % 1000;

    if milliards > 0 {
        parts.push(if milliards == 1 {
            "un milliard".into()
        } else {
            format!("{} milliards", chunk(milliards, false))
        });
    }
    if millions > 0 {
        parts.push(if millions == 1 {
            "un million".into()
        } else {
            format!("{} millions", chunk(millions, false))
        });
    }
    if milliers > 0 {
        parts.push(if milliers == 1 {
            "mille".into()
        } else {
            format!("{} mille", chunk(milliers, true))
        });
    }
    if reste > 0 {
        parts.push(chunk(reste, false));
    }
    parts.join(" ")
}

/// Symbole affiché après les montants (§42) : DZD → « DA », EUR → « € », USD → « $ ».
pub fn devise_symbole(code: &str) -> &'static str {
    match code {
        "EUR" => "€",
        "USD" => "$",
        _ => "DA",
    }
}

/// Unité et sous-unité en lettres, au singulier et au pluriel.
fn noms_devise(code: &str) -> (&'static str, &'static str, &'static str, &'static str) {
    match code {
        "EUR" => ("euro", "euros", "centime", "centimes"),
        "USD" => ("dollar américain", "dollars américains", "cent", "cents"),
        _ => ("dinar algérien", "dinars algériens", "centime", "centimes"),
    }
}

/// 119 000,00 DA → « CENT DIX-NEUF MILLE DINARS ALGÉRIENS ET ZÉRO CENTIME. » (§65)
/// Même règle que l'aperçu HTML (src/core/numberToWordsFr.ts).
pub fn amount_in_words(cents: i64, devise: &str) -> String {
    let neg = cents < 0;
    let abs = cents.unsigned_abs();
    let unites = abs / 100;
    let cts = abs % 100;
    let (u_sing, u_plur, c_sing, c_plur) = noms_devise(devise);
    let unite_label = if unites <= 1 { u_sing } else { u_plur };

    let mut out = String::new();
    if neg {
        out.push_str("moins ");
    }
    out.push_str(&format!("{} {}", int_to_words_fr(unites), unite_label));
    match cts {
        0 => out.push_str(&format!(" et zéro {c_sing}")),
        1 => out.push_str(&format!(" et un {c_sing}")),
        n => out.push_str(&format!(" et {} {c_plur}", int_to_words_fr(n))),
    }
    out.to_uppercase() + "."
}

/// Montant en lettres en dinars (cas historique).
pub fn amount_in_words_dzd(cents: i64) -> String {
    amount_in_words(cents, "DZD")
}

/// Format local (§43) : 125000000 → « 1 250 000,00 ».
pub fn format_money(cents: i64) -> String {
    let neg = cents < 0;
    let abs = cents.unsigned_abs();
    let digits = (abs / 100).to_string();
    let chars: Vec<char> = digits.chars().collect();
    let mut grouped = String::new();
    for (i, ch) in chars.iter().enumerate() {
        if i > 0 && (chars.len() - i) % 3 == 0 {
            grouped.push(' ');
        }
        grouped.push(*ch);
    }
    format!("{}{}, {:02}", if neg { "-" } else { "" }, grouped, abs % 100).replace(" ,", ",")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn montant_en_lettres_selon_la_monnaie() {
        assert_eq!(amount_in_words(11_901, "EUR"), "CENT DIX-NEUF EUROS ET UN CENTIME.");
        assert_eq!(amount_in_words(10_000, "USD"), "CENT DOLLARS AMÉRICAINS ET ZÉRO CENT.");
        assert_eq!(devise_symbole("EUR"), "€");
        assert_eq!(devise_symbole("USD"), "$");
        assert_eq!(devise_symbole("DZD"), "DA");
        assert_eq!(devise_symbole("GBP"), "DA", "monnaie inconnue : repli sur DA");
    }

    #[test]
    fn test_officiel_65() {
        assert_eq!(
            amount_in_words_dzd(11_900_000),
            "CENT DIX-NEUF MILLE DINARS ALGÉRIENS ET ZÉRO CENTIME."
        );
    }

    #[test]
    fn accords() {
        assert_eq!(int_to_words_fr(80), "quatre-vingts");
        assert_eq!(int_to_words_fr(80_000), "quatre-vingt mille");
        assert_eq!(int_to_words_fr(200), "deux cents");
        assert_eq!(int_to_words_fr(200_000), "deux cent mille");
        assert_eq!(int_to_words_fr(119_000), "cent dix-neuf mille");
    }
}

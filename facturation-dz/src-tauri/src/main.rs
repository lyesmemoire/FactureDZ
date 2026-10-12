// FacturationDZ — point d'entrée Windows (§2).
// Prérequis : Windows 10/11 64 bits. Aucun runtime Node/Python requis (§2).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    facturation_dz_lib::run()
}

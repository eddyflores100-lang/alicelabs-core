#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Serialize, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[tauri::command]
async fn github_device_code(client_id: String) -> Result<DeviceCodeResponse, String> {
    if client_id.trim().is_empty() {
        return Err("GitHub OAuth Client ID is not configured.".to_string());
    }

    let response = reqwest::Client::new()
        .post("https://github.com/login/device/code")
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&json!({
            "client_id": client_id
        }))
        .send()
        .await
        .map_err(|error| format!("GitHub device authorization request failed: {error}"))?;

    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Could not read GitHub authorization response: {error}"))?;

    if !status.is_success() {
        return Err(body
            .get("error_description")
            .and_then(Value::as_str)
            .unwrap_or("GitHub rejected the device authorization request.")
            .to_string());
    }

    serde_json::from_value(body)
        .map_err(|error| format!("Invalid GitHub device authorization response: {error}"))
}

#[tauri::command]
async fn github_exchange_device_code(
    client_id: String,
    device_code: String,
) -> Result<Value, String> {
    if client_id.trim().is_empty() || device_code.trim().is_empty() {
        return Err("GitHub client ID and device code are required.".to_string());
    }

    let response = reqwest::Client::new()
        .post("https://github.com/login/oauth/access_token")
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&json!({
            "client_id": client_id,
            "device_code": device_code,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
        }))
        .send()
        .await
        .map_err(|error| format!("GitHub token exchange failed: {error}"))?;

    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Could not read GitHub token response: {error}"))?;

    if !status.is_success() {
        return Err(body
            .get("error_description")
            .and_then(Value::as_str)
            .unwrap_or("GitHub rejected the token exchange.")
            .to_string());
    }

    Ok(body)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            github_device_code,
            github_exchange_device_code
        ])
        .run(tauri::generate_context!())
        .expect("error while running AliceLabs Core");
}

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Serialize, Deserialize)]
struct Credentials {
    origin: String,
    token: String,
}
fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("app.deck.desktop", "cloud-sync")
        .map_err(|_| "Secure credential storage unavailable".into())
}
fn credentials() -> Result<Credentials, String> {
    let secret = entry()?
        .get_password()
        .map_err(|_| "Desktop is not connected".to_string())?;
    serde_json::from_str(&secret).map_err(|_| "Invalid stored credentials".into())
}
async fn request(
    c: &Credentials,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    // Fixed route allowlist; tokens never go to redirects or an arbitrary destination.
    if !["me", "sync", "history", "export"].contains(&path) {
        return Err("Unsupported cloud route".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not open connection")?;
    let url = format!("{}/api/v1/{}", c.origin, path);
    let req = if let Some(data) = body {
        client.post(url).json(&data)
    } else {
        client.get(url)
    };
    let response = req
        .bearer_auth(&c.token)
        .send()
        .await
        .map_err(|_| "Cloud unavailable. Your local Deck is safe.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Cloud returned {}. Reconnect in Account if your session expired.",
            response.status().as_u16()
        ));
    }
    response
        .json()
        .await
        .map_err(|_| "Invalid cloud response".into())
}
#[tauri::command]
pub async fn connect_cloud(origin: String, token: String) -> Result<serde_json::Value, String> {
    let url = reqwest::Url::parse(&origin).map_err(|_| "Enter a valid HTTPS portal URL")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Use your HTTPS Deck portal address".into());
    }
    if token.len() < 40 || token.len() > 100 {
        return Err("Invalid connection token".into());
    }
    let c = Credentials {
        origin: url.origin().ascii_serialization(),
        token,
    };
    let user = request(&c, "me", None).await?;
    entry()?
        .set_password(&serde_json::to_string(&c).map_err(|_| "Could not encode credentials")?)
        .map_err(|_| "Could not save to secure credential storage")?;
    Ok(user)
}
#[tauri::command]
pub async fn cloud_request(
    path: String,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    request(&credentials()?, &path, body).await
}
#[tauri::command]
pub fn disconnect_cloud() -> Result<(), String> {
    entry()?
        .delete_credential()
        .map_err(|_| "Could not remove cloud credentials".into())
}

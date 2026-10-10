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
    expected_user_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    // Fixed route allowlist; tokens never go to redirects or an arbitrary destination.
    if ![
        "me",
        "sync",
        "history",
        "export",
        "devices",
        "devices/register",
        "command-center",
        "command-center/github/repositories",
        "command-center/github/import",
        "command-center/github/refresh",
        "command-center/github/disconnect",
    ]
    .contains(&path)
    {
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
    let req = if let Some(id) = expected_user_id {
        req.header("X-Deck-Account", id)
    } else {
        req
    };
    let response = req
        .bearer_auth(&c.token)
        .send()
        .await
        .map_err(|_| "Cloud unavailable. Your local Deck is safe.".to_string())?;
    if response.status().is_server_error() {
        return Err("Cloud unavailable. Your local Deck is safe.".into());
    }
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
    let user = request(&c, "me", None, None).await?;
    entry()?
        .set_password(&serde_json::to_string(&c).map_err(|_| "Could not encode credentials")?)
        .map_err(|_| "Could not save to secure credential storage")?;
    Ok(user)
}
#[tauri::command]
pub async fn cloud_request(
    path: String,
    body: Option<serde_json::Value>,
    expected_user_id: Option<String>,
) -> Result<serde_json::Value, String> {
    request(&credentials()?, &path, body, expected_user_id.as_deref()).await
}
#[tauri::command]
pub fn disconnect_cloud() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Could not remove cloud credentials".into()),
    }
}

#[tauri::command]
pub fn device_info() -> serde_json::Value {
    serde_json::json!({
        "name": std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "Deck Desktop".into()),
        "platform": std::env::consts::OS,
        "architecture": std::env::consts::ARCH,
        "appVersion": env!("CARGO_PKG_VERSION")
    })
}
fn portal_origin(origin: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(origin).map_err(|_| "Enter a valid HTTPS portal URL")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Use your HTTPS Deck portal address".into());
    }
    Ok(url.origin().ascii_serialization())
}
async fn pairing_request(
    origin: &str,
    path: &str,
    secret: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if secret.len() != 43
        || !secret
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Invalid sign-in proof".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not open connection")?;
    let response = client
        .post(format!("{origin}/api/v1/devices/pair/{path}"))
        .header("Authorization", format!("Pairing {secret}"))
        .json(&body)
        .send()
        .await
        .map_err(|_| "Cloud unavailable. Your local Deck is safe.")?;
    if !response.status().is_success() {
        return Err(
            "Sign-in connection expired or unavailable. Start again in Account settings.".into(),
        );
    }
    response
        .json()
        .await
        .map_err(|_| "Invalid sign-in response".into())
}
#[tauri::command]
pub async fn begin_cloud_signin(
    origin: String,
    secret: String,
    device_id: String,
) -> Result<serde_json::Value, String> {
    let origin = portal_origin(&origin)?;
    let mut metadata = device_info();
    metadata["id"] = device_id.into();
    let response = pairing_request(&origin, "start", &secret, metadata).await?;
    let id = response["id"].as_str().ok_or("Invalid sign-in response")?;
    if id.len() != 36 || !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return Err("Invalid sign-in response".into());
    }
    // Only open the validated origin and fixed callback route, never a server-supplied URL.
    let url = format!("{origin}/desktop-connect?pair={id}");
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("/usr/bin/open")
        .arg(&url)
        .spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();
    result.map_err(|_| "Could not open your browser")?;
    Ok(response)
}
#[tauri::command]
pub async fn poll_cloud_signin(
    origin: String,
    secret: String,
    id: String,
) -> Result<serde_json::Value, String> {
    let origin = portal_origin(&origin)?;
    let response = pairing_request(&origin, "poll", &secret, serde_json::json!({"id":id})).await?;
    if response["pending"] == true {
        return Ok(response);
    }
    let token = response["token"]
        .as_str()
        .ok_or("Invalid sign-in response")?
        .to_string();
    let user = connect_cloud(origin, token).await?;
    Ok(serde_json::json!({"user":user}))
}

/// Opens a GitHub evidence URL, never credentials or an arbitrary scheme.
#[tauri::command]
pub fn open_github_resource(url: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid GitHub URL")?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("github.com")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Only GitHub HTTPS resource links can be opened".into());
    }
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("/usr/bin/open")
        .arg(&url)
        .status();
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &url])
        .status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status = std::process::Command::new("xdg-open").arg(&url).status();
    if status.map_err(|_| "Could not open the browser")?.success() {
        Ok(())
    } else {
        Err("Could not open the browser".into())
    }
}

/// Launch only the registered application; never invoke a project command.
#[tauri::command]
pub fn open_pit_boss() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("/usr/bin/open")
            .args(["-b", "dev.oddware.pitboss"])
            .status()
            .map_err(|_| "Could not open Pit Boss")?;
        if status.success() {
            Ok(())
        } else {
            Err("Pit Boss is not installed or could not be opened".into())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Open Pit Boss from your application launcher on this platform".into())
    }
}

#[cfg(test)]
mod command_center_tests {
    use super::open_github_resource;
    #[test]
    fn rejects_untrusted_external_links_before_opening_any_application() {
        for value in [
            "javascript:alert(1)",
            "https://github.com.evil.test/",
            "https://secret@github.com/",
            "file:///tmp/script",
            "http://github.com/",
        ] {
            assert!(open_github_resource(value.into()).is_err());
        }
    }
}

use axum::{routing::get, Json, Router};
use core_protocol::HealthResponse;
use std::net::SocketAddr;

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        protocol_version: core_protocol::PROTOCOL_VERSION.to_string(),
    })
}

#[tokio::main]
async fn main() {
    let app = Router::new().route("/health", get(health));
    let addr = SocketAddr::from(([127, 0, 0, 1], 47821));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind Core Daemon");
    println!("AliceLabs Core Daemon listening on http://{addr}");
    axum::serve(listener, app)
        .await
        .expect("daemon server failed");
}

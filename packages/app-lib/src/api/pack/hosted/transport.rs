use reqwest::{Client, Response, header};
use std::error::Error as _;
use std::time::{Duration, Instant};

use crate::util::fetch::{
    download_error_category, sanitize_download_error_text, sanitize_url_for_log,
};

const METADATA_TIMEOUT: Duration = Duration::from_secs(30);

// Keep only safe diagnostics in the response extensions. Never retain the
// Authorization value, arbitrary headers, response bodies or URL queries.
#[derive(Clone)]
struct RequestDiagnostic {
    request_id: String,
    requested_url: String,
    started: Instant,
    response_details: String,
}

fn safe_text(text: &str, auth: &str) -> String {
    let token = auth.strip_prefix("Bearer ").unwrap_or(auth);
    let redacted = if token.is_empty() {
        text.to_owned()
    } else {
        text.replace(token, "[redacted]")
    };
    sanitize_download_error_text(&redacted)
}

impl RequestDiagnostic {
    fn new(url: &str, auth: &str) -> Self {
        Self {
            request_id: uuid::Uuid::new_v4().to_string(),
            requested_url: safe_text(&sanitize_url_for_log(url), auth),
            started: Instant::now(),
            response_details: "response=unavailable".into(),
        }
    }

    fn summary(&self) -> String {
        format!(
            "request_id={}; method=GET; requested_url={}; elapsed_ms={}; timeout_ms={}; {}",
            self.request_id,
            self.requested_url,
            self.started.elapsed().as_millis(),
            METADATA_TIMEOUT.as_millis(),
            self.response_details,
        )
    }

    fn received(&mut self, response: &Response, auth: &str) {
        let headers = [
            "server",
            "content-type",
            "content-length",
            "via",
            "eo-log-uuid",
            "x-nws-log-uuid",
            "x-request-id",
            "retry-after",
        ]
        .iter()
        .filter_map(|name| {
            let value = response.headers().get(*name)?.to_str().ok()?;
            Some(format!("{name}={}", safe_text(value, auth)))
        })
        .collect::<Vec<_>>()
        .join(", ");
        self.response_details = format!(
            "status={}; final_url={}; remote_addr={:?}; http_version={:?}; headers=[{}]",
            response.status().as_u16(),
            safe_text(&sanitize_url_for_log(response.url().as_str()), auth),
            response.remote_addr(),
            response.version(),
            headers,
        );
    }

    // `detail` must already be redacted. Bound individual causes rather than
    // truncating the joined chain, so the deepest socket/TLS cause survives.
    fn failure(
        &self,
        stage: &str,
        category: &str,
        detail: &str,
    ) -> crate::Error {
        let diagnostic = self.summary();
        tracing::warn!(
            stage = %stage, category = %category, %diagnostic,
            error_chain = %detail, "StarLight metadata request failed"
        );
        crate::ErrorKind::NetworkError(format!(
            "StarLight metadata request failed: stage={stage}; category={category}; {diagnostic}; cause={detail}"
        )).into()
    }

    fn transport_failure(
        &self,
        stage: &str,
        error: reqwest::Error,
        auth: &str,
    ) -> crate::Error {
        let mut diagnostic = self.clone();
        if let Some(url) = error.url() {
            diagnostic.response_details.push_str(&format!(
                "; failed_url={}",
                safe_text(&sanitize_url_for_log(url.as_str()), auth)
            ));
        }
        let mut causes = Vec::new();
        let mut source = error.source();
        for _ in 0..8 {
            let Some(cause) = source else { break };
            causes.push(safe_text(&cause.to_string(), auth));
            source = cause.source();
        }
        if causes.is_empty() {
            causes.push(safe_text(&error.to_string(), auth));
        }
        let category = if error.is_timeout() {
            Some("timeout")
        } else if error.is_decode() {
            Some("decode")
        } else if error.is_redirect() {
            Some("redirect")
        } else if error.is_builder() {
            Some("request")
        } else {
            None
        };
        let error = crate::Error::from(error.without_url());
        diagnostic.failure(
            stage,
            category.unwrap_or_else(|| download_error_category(&error)),
            &causes.join(" -> "),
        )
    }

    fn from_response(response: &Response, auth: &str) -> Self {
        response
            .extensions()
            .get::<Self>()
            .cloned()
            .unwrap_or_else(|| {
                let mut diagnostic = Self::new(response.url().as_str(), auth);
                diagnostic.received(response, auth);
                diagnostic
            })
    }

    fn json_failure(&self, error: &serde_json::Error) -> crate::Error {
        // Serde's Display may quote response values for schema errors. Record
        // the failure location and kind without copying any response content.
        self.failure(
            "decode",
            "json",
            &format!(
                "JSON response error: kind={:?}; line={}; column={}",
                error.classify(),
                error.line(),
                error.column()
            ),
        )
    }
}

pub(super) async fn metadata_request(
    client: &Client,
    url: &str,
    auth: &str,
) -> crate::Result<Response> {
    let mut diagnostic = RequestDiagnostic::new(url, auth);
    let mut response = client
        .get(url)
        .query(&[("starlight_request", &diagnostic.request_id)])
        .header(header::AUTHORIZATION, auth)
        .header(header::CACHE_CONTROL, "no-cache, no-store")
        .header(header::PRAGMA, "no-cache")
        .timeout(METADATA_TIMEOUT)
        .send()
        .await
        .map_err(|error| diagnostic.transport_failure("send", error, auth))?;
    diagnostic.received(&response, auth);
    if response.status().is_success() {
        tracing::debug!(diagnostic = %diagnostic.summary(), "StarLight metadata response received");
    } else {
        tracing::warn!(stage = "response", category = "http", diagnostic = %diagnostic.summary(), "StarLight metadata HTTP failure");
    }
    response.extensions_mut().insert(diagnostic);
    Ok(response)
}

pub(super) async fn response_json<T: serde::de::DeserializeOwned>(
    response: Response,
    auth: &str,
) -> crate::Result<T> {
    let diagnostic = RequestDiagnostic::from_response(&response, auth);
    let bytes = response
        .bytes()
        .await
        .map_err(|error| diagnostic.transport_failure("body", error, auth))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| diagnostic.json_failure(&error))
}

async fn bounded_json(
    mut response: Response,
    auth: &str,
) -> Option<serde_json::Value> {
    let diagnostic = RequestDiagnostic::from_response(&response, auth);
    let mut bytes = Vec::new();
    loop {
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(error) => {
                diagnostic.transport_failure("body", error, auth);
                return None;
            }
        };
        if bytes.len() + chunk.len() > 16_384 {
            diagnostic.failure(
                "body",
                "size_limit",
                "Error response exceeds 16384 bytes",
            );
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    match serde_json::from_slice(&bytes) {
        Ok(value) => Some(value),
        Err(error) => {
            diagnostic.json_failure(&error);
            None
        }
    }
}

pub(super) async fn response_failure(
    client: &Client,
    response: Response,
    user_url: &str,
    suffix: &str,
    auth: &str,
) -> String {
    let status = response.status().as_u16();
    let trace = response
        .headers()
        .get("eo-log-uuid")
        .and_then(|value| value.to_str().ok())
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 128
                && value
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
        .map(|value| format!("；CDN 请求编号 {value}"))
        .unwrap_or_default();
    let context = format!("（整合包 HTTP {status}；接口 {suffix}{trace}）");
    if let Some(body) = bounded_json(response, auth).await {
        if let Some(message) = body["errorMessage"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
        {
            let token = auth.strip_prefix("Bearer ").unwrap_or(auth);
            let message = if token.is_empty() {
                message.to_owned()
            } else {
                message.replace(token, "[凭据已隐藏]")
            };
            let message: String = message
                .chars()
                .filter(|c| !c.is_control())
                .take(500)
                .collect();
            return format!("StarLight 服务端返回：{message}{context}");
        }
    }
    if !matches!(status, 401 | 403) {
        return format!("StarLight 服务端请求失败{context}");
    }
    let detail = match metadata_request(client, user_url, auth).await {
        Ok(user_response) => {
            let user_status = user_response.status().as_u16();
            if user_status == 200 {
                let valid_user = bounded_json(user_response, auth)
                    .await
                    .is_some_and(|body| {
                        body["payload"]["uuid"]
                            .as_str()
                            .is_some_and(|id| !id.is_empty())
                            && body["payload"]["username"].is_string()
                    });
                if valid_user {
                    "皮肤站登录有效，但整合包接口返回错误，且没有提供具体原因。请用请求编号查询服务端或 CDN 日志".to_owned()
                } else {
                    "整合包接口拒绝访问，用户接口返回内容异常，无法确认登录状态"
                        .to_owned()
                }
            } else if matches!(user_status, 401 | 403) {
                format!(
                    "整合包和用户接口均拒绝登录凭据（用户接口 HTTP {user_status}）。请重新登录；若仍失败，请检查服务端鉴权及 CDN 配置"
                )
            } else {
                format!(
                    "整合包接口拒绝访问，暂时无法复核登录状态（用户接口 HTTP {user_status}）"
                )
            }
        }
        Err(_) => "整合包接口拒绝访问，用户接口连接失败，暂时无法复核登录状态"
            .to_owned(),
    };
    format!("{detail}{context}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tracing::instrument::WithSubscriber;

    #[derive(Clone, Default)]
    struct LogBuffer(Arc<Mutex<Vec<u8>>>);

    impl std::io::Write for LogBuffer {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl LogBuffer {
        fn text(&self) -> String {
            String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
        }

        fn subscriber(
            &self,
        ) -> impl tracing::Subscriber + Send + Sync + 'static {
            let buffer = self.clone();
            tracing_subscriber::fmt()
                .without_time()
                .with_ansi(false)
                .with_max_level(tracing::Level::DEBUG)
                .with_writer(move || buffer.clone())
                .finish()
        }
    }

    #[tokio::test]
    async fn hosted_connection_failure_logs_causes_and_redacts_credentials() {
        let listener =
            tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let client = Client::builder().no_proxy().build().unwrap();
        let logs = LogBuffer::default();
        let error = metadata_request(
            &client,
            &format!("http://url-user:url-password@{address}/sync-state?token=query-secret#private-fragment"),
            "Bearer account-secret",
        )
        .with_subscriber(logs.subscriber())
        .await
        .unwrap_err();
        let diagnostic = format!("{}\n{}", logs.text(), error);
        for expected in [
            "stage=send",
            "category=connect",
            "request_id=",
            "elapsed_ms=",
            "/sync-state",
        ] {
            assert!(
                diagnostic.contains(expected),
                "missing {expected}: {diagnostic}"
            );
        }
        assert!(
            diagnostic.contains("tcp") || diagnostic.contains("os error"),
            "{diagnostic}"
        );
        for secret in [
            "url-user",
            "url-password",
            "query-secret",
            "private-fragment",
            "account-secret",
        ] {
            assert!(
                !diagnostic.contains(secret),
                "leaked {secret}: {diagnostic}"
            );
        }
    }

    #[tokio::test]
    async fn hosted_http_failure_logs_redirect_destination_and_cdn_ids() {
        let listener =
            tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            for response in [
                "HTTP/1.1 302 Found\r\nLocation: /upstream?signature=redirect-secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                "HTTP/1.1 502 Bad Gateway\r\nServer: nginx\r\nEO-LOG-UUID: edge-123\r\nX-NWS-LOG-UUID: cdn-456\r\nSet-Cookie: session=cookie-secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            ] {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") {
                    request.push(socket.read_u8().await.unwrap());
                }
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        let client = Client::builder().no_proxy().build().unwrap();
        let logs = LogBuffer::default();
        let response = metadata_request(
            &client,
            &format!("{base}/sync-state"),
            "Bearer account-secret",
        )
        .with_subscriber(logs.subscriber())
        .await
        .unwrap();
        assert_eq!(response.status(), 502);
        let diagnostic = logs.text();
        for expected in [
            "status=502",
            "requested_url=",
            "/sync-state",
            "final_url=",
            "/upstream",
            "remote_addr=",
            "HTTP/1.1",
            "edge-123",
            "cdn-456",
            "nginx",
        ] {
            assert!(
                diagnostic.contains(expected),
                "missing {expected}: {diagnostic}"
            );
        }
        for secret in ["redirect-secret", "cookie-secret", "account-secret"] {
            assert!(
                !diagnostic.contains(secret),
                "leaked {secret}: {diagnostic}"
            );
        }
        server.await.unwrap();
    }

    #[tokio::test]
    async fn hosted_response_failures_keep_the_response_context_without_logging_bodies()
     {
        for (body, declared_length, expected_stage) in [
            ("<html>account-secret</html>", 27, "decode"),
            ("{", 100, "body"),
        ] {
            let listener =
                tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") {
                    request.push(socket.read_u8().await.unwrap());
                }
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nEO-LOG-UUID: body-123\r\nContent-Length: {declared_length}\r\nConnection: close\r\n\r\n{body}"
                );
                socket.write_all(response.as_bytes()).await.unwrap();
            });
            let logs = LogBuffer::default();
            let client = Client::builder().no_proxy().build().unwrap();
            let error = async {
                let response = metadata_request(
                    &client,
                    &format!("{base}/sync-state"),
                    "Bearer account-secret",
                )
                .await
                .unwrap();
                response_json::<serde_json::Value>(
                    response,
                    "Bearer account-secret",
                )
                .await
                .unwrap_err()
            }
            .with_subscriber(logs.subscriber())
            .await;
            let diagnostic = format!("{}\n{error}", logs.text());
            for expected in [
                format!("stage={expected_stage}"),
                "status=200".into(),
                "body-123".into(),
                "text/html".into(),
                "request_id=".into(),
            ] {
                assert!(
                    diagnostic.contains(&expected),
                    "missing {expected}: {diagnostic}"
                );
            }
            assert!(!diagnostic.contains("account-secret"), "{diagnostic}");
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn hosted_read_timeout_is_distinguished_from_http_failure() {
        let listener =
            tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url =
            format!("http://{}/sync-state", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (_socket, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_millis(500)).await;
        });
        let client = Client::builder()
            .no_proxy()
            .read_timeout(Duration::from_millis(50))
            .build()
            .unwrap();
        let logs = LogBuffer::default();
        let error = metadata_request(&client, &url, "Bearer account-secret")
            .with_subscriber(logs.subscriber())
            .await
            .unwrap_err();
        let diagnostic = format!("{}\n{error}", logs.text());
        for expected in [
            "category=timeout",
            "stage=send",
            "response=unavailable",
            "timeout_ms=30000",
        ] {
            assert!(
                diagnostic.contains(expected),
                "missing {expected}: {diagnostic}"
            );
        }
        server.abort();
    }

    #[test]
    fn hosted_diagnostics_redact_before_truncating_long_credentials() {
        let token = "secret".repeat(100);
        let auth = format!("Bearer {token}");
        let text = safe_text(
            &format!(
                "server {token} https://user:password@example.com/path?signature=secret#fragment"
            ),
            &auth,
        );
        assert!(text.contains("[redacted]"));
        for secret in ["secret", "password", "user", "signature", "fragment"] {
            assert!(!text.contains(secret), "{text}");
        }
    }

    #[tokio::test]
    async fn hosted_json_schema_errors_never_echo_server_body_values() {
        let response = Response::from(
            http::Response::builder()
                .status(200)
                .body("\"unrelated-private-value\"")
                .unwrap(),
        );
        let logs = LogBuffer::default();
        let error = response_json::<u64>(response, "Bearer account-secret")
            .with_subscriber(logs.subscriber())
            .await
            .unwrap_err();
        let diagnostic = format!("{}\n{error}", logs.text());
        assert!(diagnostic.contains("kind=Data"), "{diagnostic}");
        assert!(diagnostic.contains("line=1"), "{diagnostic}");
        assert!(
            !diagnostic.contains("unrelated-private-value"),
            "{diagnostic}"
        );
    }

    #[tokio::test]
    async fn hosted_auth_failure_verifies_same_credential_without_exposing_it()
    {
        for (pack_status, user_status, body, expected) in [
            (
                401,
                200,
                r#"{"payload":{"uuid":"owner","username":"Player"}}"#,
                "皮肤站登录有效",
            ),
            (403, 401, "{}", "均拒绝登录凭据"),
            (401, 200, "<html>Proxy error</html>", "用户接口返回内容异常"),
        ] {
            let listener =
                tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                let mut requests = Vec::new();
                for (status, body) in [(pack_status, ""), (user_status, body)] {
                    let (mut socket, _) = listener.accept().await.unwrap();
                    let mut request = Vec::new();
                    while !request.ends_with(b"\r\n\r\n") {
                        request.push(socket.read_u8().await.unwrap());
                    }
                    requests.push(String::from_utf8(request).unwrap());
                    let response = format!(
                        "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nEO-LOG-UUID: trace-123\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    socket.write_all(response.as_bytes()).await.unwrap();
                }
                requests
            });
            let client = Client::builder().no_proxy().build().unwrap();
            let auth = "Bearer test-secret-never-display";
            let response =
                metadata_request(&client, &format!("{base}/default"), auth)
                    .await
                    .unwrap();
            let message = response_failure(
                &client,
                response,
                &format!("{base}/user"),
                "/default",
                auth,
            )
            .await;
            assert!(message.contains(expected), "{message}");
            assert!(message.contains(&format!("整合包 HTTP {pack_status}")));
            assert!(message.contains("trace-123"));
            assert!(!message.contains("test-secret"));
            let requests = server.await.unwrap();
            for (request, path) in requests.iter().zip(["/default", "/user"]) {
                assert!(
                    request
                        .starts_with(&format!("GET {path}?starlight_request="))
                );
                let headers = request.to_ascii_lowercase();
                assert!(headers.contains(
                    "authorization: bearer test-secret-never-display\r\n"
                ));
                assert!(
                    headers.contains("cache-control: no-cache, no-store\r\n")
                );
            }
        }
    }

    #[tokio::test]
    async fn hosted_business_errors_preserve_server_reason_without_login_probe()
    {
        for status in [400, 403, 409, 500] {
            let listener =
                tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") {
                    request.push(socket.read_u8().await.unwrap());
                }
                let body = r#"{"error":"IllegalState","errorMessage":"整合包 Mod 标签已删除，请管理员重新设置 test-secret-never-display"}"#;
                let response = format!(
                    "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(response.as_bytes()).await.unwrap();
            });
            let client = Client::builder().no_proxy().build().unwrap();
            let auth = "Bearer test-secret-never-display";
            let response = metadata_request(
                &client,
                &format!("{base}/tagged-mods/2"),
                auth,
            )
            .await
            .unwrap();
            let message = response_failure(
                &client,
                response,
                &format!("{base}/user"),
                "/tagged-mods/2",
                auth,
            )
            .await;
            assert!(
                message.contains("整合包 Mod 标签已删除，请管理员重新设置"),
                "{message}"
            );
            assert!(message.contains("/tagged-mods/2"));
            assert!(message.contains(&format!("HTTP {status}")));
            assert!(!message.contains("test-secret"));
            assert!(!message.contains("请重新登录"));
            server.await.unwrap();
        }
    }
}

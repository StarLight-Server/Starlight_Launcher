//! Platform selection for StarLight pack files and their external redirects.

use super::{
    DIRECT_REQWEST_CLIENT, DownloadRequest, DownloadRoute, ErrorKind,
    FILE_TRANSFER_FIRST_BYTE_TIMEOUT, FetchSemaphore, FileRedirectPolicy,
    NO_REDIRECT_REQWEST_CLIENT, ResourceClass, Url,
    acquire_native_connection_with_pressure,
    add_starlight_direct_recovery_route, fetch_retry_delay,
    infer_resource_class, official_route, retry_after, sanitize_url_for_log,
    send_path_request_with_redirect_policy,
};

pub(super) fn is_starlight_file(url: &Url) -> bool {
    url.scheme() == "https"
        && matches!(
            url.host_str(),
            Some("skin.starlight.cool" | "mod-download.starlight.cool")
        )
        && [
            "/starlight/mod/packs/files/",
            "/starlight/mod/packs/tagged-files/",
        ]
        .iter()
        .any(|prefix| url.path().starts_with(prefix))
}

pub(super) fn resource_for_url(
    url: &str,
    fallback: ResourceClass,
) -> ResourceClass {
    if !matches!(
        fallback,
        ResourceClass::Modpack
            | ResourceClass::Modrinth
            | ResourceClass::CurseForge
    ) {
        return fallback;
    }
    if Url::parse(url)
        .ok()
        .is_some_and(|url| is_starlight_file(&url))
    {
        return ResourceClass::Other;
    }
    match infer_resource_class(url) {
        resource @ (ResourceClass::Modrinth | ResourceClass::CurseForge) => {
            resource
        }
        _ => fallback,
    }
}

fn redirected_request(
    mut request: DownloadRequest,
    target: Url,
) -> DownloadRequest {
    request.resource =
        resource_for_url(target.as_str(), ResourceClass::Modpack);
    request.url = target.into();
    // The destination belongs to another origin. Rebuild its routes without
    // the StarLight credential or any original-origin fallback URLs.
    request.header = None;
    request.candidate_urls.clear();
    request
}

/// Request the first byte to discover redirects without consuming file bodies.
/// Stop before requesting a platform CDN so the existing downloader can apply
/// its mirrors, retries and hashes. Reuse normal HTTP/1 recovery and parsing.
async fn resolve_route(
    request: &DownloadRequest,
    route: &DownloadRoute,
    semaphore: &FetchSemaphore,
    client: &reqwest::Client,
) -> crate::Result<Option<Url>> {
    for attempt in 1..=3 {
        // Resource queue time does not consume the first-byte deadline.
        let permit =
            acquire_native_connection_with_pressure(route, semaphore).await?;
        let response = tokio::time::timeout(
            FILE_TRANSFER_FIRST_BYTE_TIMEOUT,
            send_path_request_with_redirect_policy(
                route,
                request.header.as_ref(),
                None,
                Some(0),
                Some(0),
                client,
                client,
                None,
                FileRedirectPolicy::StopAtContentPlatform,
            ),
        )
        .await
        .unwrap_or_else(|_| {
            Err(ErrorKind::NetworkError(
                "Timed out resolving StarLight file download source".into(),
            )
            .into())
        });
        let (error, delay) = match response {
            Ok((response, target)) => {
                // Empty hosted objects have no byte 0 to satisfy the probe.
                if response.status()
                    == reqwest::StatusCode::RANGE_NOT_SATISFIABLE
                    && request.integrity.size == Some(0)
                {
                    return Ok(None);
                }
                if let Err(error) = response.error_for_status_ref() {
                    (crate::Error::from(error), retry_after(&response))
                } else {
                    return if response.status().is_redirection() {
                        Ok(Some(Url::parse(&target)?))
                    } else {
                        Ok(None)
                    };
                }
            }
            Err(error) => (error, None),
        };
        drop(permit);
        let retryable = match error.raw.as_ref() {
            ErrorKind::FetchError(error) => {
                error.status().is_none_or(|status| {
                    status.is_server_error()
                        || status == reqwest::StatusCode::TOO_MANY_REQUESTS
                        || status == reqwest::StatusCode::REQUEST_TIMEOUT
                })
            }
            ErrorKind::NetworkError(_) => true,
            _ => false,
        };
        if !retryable || attempt == 3 {
            return Err(error);
        }
        // Release resources while honoring the same bounded Retry-After and
        // retry delay used by the downloader. Outer cancellation covers sleep.
        tokio::time::sleep(delay.unwrap_or_else(|| fetch_retry_delay(attempt)))
            .await;
    }
    unreachable!()
}

pub(super) async fn resolve_request(
    request: DownloadRequest,
    semaphore: &FetchSemaphore,
) -> crate::Result<DownloadRequest> {
    if !Url::parse(&request.url)
        .ok()
        .is_some_and(|url| is_starlight_file(&url))
    {
        return Ok(request);
    }
    let mut routes = vec![official_route(&request.url, request.resource)];
    add_starlight_direct_recovery_route(&mut routes);
    let mut last_error = None;
    for route in routes {
        let client = if route.proxy == super::ProxyPolicy::Direct {
            &*DIRECT_REQWEST_CLIENT
        } else {
            &*NO_REDIRECT_REQWEST_CLIENT
        };
        let resolve = resolve_route(&request, &route, semaphore, client);
        let result = if let Some(cancellation) = &request.cancellation {
            tokio::select! {
                _ = cancellation.cancelled() => return Err(ErrorKind::OtherError("download canceled while resolving StarLight file source".into()).into()),
                result = resolve => result,
            }
        } else {
            resolve.await
        };
        match result {
            Ok(Some(target)) => {
                tracing::debug!(
                    url = %sanitize_url_for_log(target.as_str()),
                    "Applying platform download settings to StarLight file redirect"
                );
                return Ok(redirected_request(request, target));
            }
            Ok(None) => return Ok(request),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.expect("StarLight discovery always has an official route"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn discover_redirect(
        request: &DownloadRequest,
        route: &DownloadRoute,
        client: &reqwest::Client,
    ) -> crate::Result<Option<Url>> {
        resolve_route(
            request,
            route,
            &FetchSemaphore(tokio::sync::Semaphore::new(1)),
            client,
        )
        .await
    }

    async fn server(
        responses: Vec<String>,
    ) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        let listener =
            tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            let mut requests = Vec::new();
            for response in responses {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") {
                    request.push(socket.read_u8().await.unwrap());
                }
                requests.push(String::from_utf8(request).unwrap());
                socket.write_all(response.as_bytes()).await.unwrap();
            }
            requests
        });
        (url, handle)
    }

    fn redirect(location: &str) -> String {
        format!(
            "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        )
    }

    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap()
    }

    #[test]
    fn starlight_discovery_is_limited_to_its_file_endpoints() {
        for url in [
            "https://mod-download.starlight.cool/starlight/mod/packs/files/4/hash",
            "https://mod-download.starlight.cool/starlight/mod/packs/tagged-files/hash",
            "https://skin.starlight.cool/starlight/mod/packs/files/4/hash",
        ] {
            assert!(is_starlight_file(&Url::parse(url).unwrap()), "{url}");
        }
        for url in [
            "https://mod-download.starlight.cool/starlight/mod/packs",
            "https://mod-download.starlight.cool.evil.example/starlight/mod/packs/files/4/hash",
            "https://skin.starlight.cool/yggdrasil",
            "http://mod-download.starlight.cool/starlight/mod/packs/files/4/hash",
        ] {
            assert!(!is_starlight_file(&Url::parse(url).unwrap()), "{url}");
        }
    }

    #[tokio::test]
    async fn external_redirects_reenter_platform_routing_without_credentials() {
        use crate::state::DownloadSourceMode;
        for (target, expected, mirror) in [
            (
                "https://mediafilez.forgecdn.net/files/1/2/mod.jar",
                ResourceClass::CurseForge,
                "https://mod.tianpao.top/files/1/2/mod.jar",
            ),
            (
                "https://cdn-alt.modrinth.com/data/p/versions/v/mod.jar?download=1",
                ResourceClass::Modrinth,
                "https://mod.tianpao.top/data/p/versions/v/mod.jar?download=1",
            ),
        ] {
            let (base, handle) =
                server(vec![redirect("/next"), redirect(target)]).await;
            let request = DownloadRequest::new(&base, ResourceClass::Modpack)
                .with_header("Authorization", "Bearer test-only-secret")
                .with_candidate_urls([
                    "https://mod-download.starlight.cool/starlight/mod/packs/files/4/original",
                ])
                .with_integrity(super::super::Integrity {
                    sha256: Some("hash".into()),
                    size: Some(42),
                    ..Default::default()
                })
                .with_http1_segmented_download(false);
            let route = official_route(&base, ResourceClass::Other);
            let discovered = discover_redirect(&request, &route, &client())
                .await
                .unwrap()
                .unwrap();
            let resolved = redirected_request(request, discovered);
            assert_eq!(resolved.url, target);
            assert_eq!(resolved.resource, expected);
            assert!(resolved.header.is_none());
            assert!(resolved.candidate_urls.is_empty());
            assert_eq!(resolved.integrity.sha256.as_deref(), Some("hash"));
            assert_eq!(resolved.integrity.size, Some(42));
            assert!(!resolved.allow_http1_segmented_download);
            for (mode, first) in [
                (DownloadSourceMode::MirrorPreferred, mirror),
                (DownloadSourceMode::OfficialPreferred, target),
                (DownloadSourceMode::OfficialOnly, target),
            ] {
                let routes = super::super::resolve_download_routes_for(
                    &resolved.url,
                    resolved.resource,
                    mode,
                );
                assert_eq!(routes[0].url, first);
                if mode == DownloadSourceMode::OfficialOnly {
                    assert_eq!(routes.len(), 1);
                }
            }
            let automatic = super::super::resolve_download_routes_for(
                &resolved.url,
                resolved.resource,
                DownloadSourceMode::Auto,
            );
            assert!(automatic.iter().any(|route| route.url == target));
            assert!(automatic.iter().any(|route| route.url == mirror));
            let requests = handle.await.unwrap();
            assert_eq!(requests.len(), 2);
            for request in requests {
                let request = request.to_ascii_lowercase();
                assert!(
                    request
                        .contains("authorization: bearer test-only-secret\r\n")
                );
                assert!(request.contains("range: bytes=0-0\r\n"));
            }
        }
    }

    #[tokio::test]
    async fn self_hosted_response_keeps_original_request_and_authentication() {
        let (base, handle) = server(vec![
            "HTTP/1.1 206 Partial Content\r\nContent-Length: 1\r\nConnection: close\r\n\r\nx".into(),
        ]).await;
        let request = DownloadRequest::new(&base, ResourceClass::Other)
            .with_header("Authorization", "Bearer retained");
        let route = official_route(&base, ResourceClass::Other);
        assert!(
            discover_redirect(&request, &route, &client())
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(handle.await.unwrap().len(), 1);
        assert_eq!(request.header.unwrap().1, "Bearer retained");
    }

    #[tokio::test]
    async fn discovery_never_forwards_authentication_across_origins() {
        let target = "https://cdn.modrinth.com/data/p/versions/v/mod.jar";
        let (second, second_handle) = server(vec![redirect(target)]).await;
        let (first, first_handle) = server(vec![redirect(&second)]).await;
        let request = DownloadRequest::new(&first, ResourceClass::Other)
            .with_header("Authorization", "Bearer private");
        let route = official_route(&first, ResourceClass::Other);
        assert_eq!(
            discover_redirect(&request, &route, &client())
                .await
                .unwrap()
                .unwrap()
                .as_str(),
            target
        );
        assert!(
            first_handle.await.unwrap()[0]
                .to_ascii_lowercase()
                .contains("authorization:")
        );
        assert!(
            !second_handle.await.unwrap()[0]
                .to_ascii_lowercase()
                .contains("authorization:")
        );
    }

    #[tokio::test]
    async fn redirect_loops_are_bounded() {
        let (base, handle) = server(vec![redirect("/loop"); 6]).await;
        let request = DownloadRequest::new(&base, ResourceClass::Other);
        let route = official_route(&base, ResourceClass::Other);
        assert!(
            discover_redirect(&request, &route, &client())
                .await
                .is_err()
        );
        assert_eq!(handle.await.unwrap().len(), 6);
    }

    #[tokio::test]
    async fn discovery_preserves_http_failures_and_rejects_downgrades() {
        for response in [
            "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
            redirect("http://cdn.modrinth.com/data/p/versions/v/mod.jar"),
        ] {
            let (base, handle) = server(vec![response]).await;
            let request = DownloadRequest::new(&base, ResourceClass::Other);
            let route = official_route(&base, ResourceClass::Other);
            assert!(discover_redirect(&request, &route, &client()).await.is_err());
            assert_eq!(handle.await.unwrap().len(), 1);
        }
    }

    #[tokio::test]
    async fn verified_starlight_cache_does_not_require_discovery() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cached.jar");
        tokio::fs::write(&path, b"abc").await.unwrap();
        let request = DownloadRequest::new(
            "https://mod-download.starlight.cool/starlight/mod/packs/files/4/hash",
            ResourceClass::Modpack,
        ).with_integrity(super::super::Integrity {
            sha256: Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".into()),
            size: Some(3),
            ..Default::default()
        });
        let semaphore =
            super::super::FetchSemaphore(tokio::sync::Semaphore::new(0));
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            super::super::download_to_path_inner(
                request, &path, &semaphore, None,
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(result.attempts, 0);
        assert_eq!(result.size, 3);
    }

    #[tokio::test]
    async fn discovery_honors_recorded_http1_fallback() {
        let _guard = super::super::tests::H2_FALLBACK_TEST_LOCK.lock().unwrap();
        let (base, handle) = server(vec![
            "HTTP/1.1 206 Partial Content\r\nContent-Length: 1\r\nConnection: close\r\n\r\nx".into(),
        ]).await;
        let request = DownloadRequest::new(&base, ResourceClass::Other);
        let route = official_route(&base, ResourceClass::Other);
        let authority = super::super::url_authority(&base).unwrap();
        super::super::record_authority_h2_failure(&authority);
        let h2_only = reqwest::Client::builder()
            .no_proxy()
            .http2_prior_knowledge()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        assert!(
            discover_redirect(&request, &route, &h2_only)
                .await
                .unwrap()
                .is_none()
        );
        assert!(handle.await.unwrap()[0].starts_with("GET / HTTP/1.1"));
    }

    #[tokio::test]
    async fn queued_discovery_does_not_use_up_the_network_timeout() {
        let (base, handle) = server(vec![
            "HTTP/1.1 206 Partial Content\r\nContent-Length: 1\r\nConnection: close\r\n\r\nx".into(),
        ]).await;
        let request = DownloadRequest::new(&base, ResourceClass::Other);
        let route = official_route(&base, ResourceClass::Other);
        let semaphore =
            std::sync::Arc::new(FetchSemaphore(tokio::sync::Semaphore::new(0)));
        let release = semaphore.clone();
        let queued = tokio::spawn(async move {
            tokio::time::sleep(
                FILE_TRANSFER_FIRST_BYTE_TIMEOUT
                    + std::time::Duration::from_millis(100),
            )
            .await;
            release.0.add_permits(1);
        });
        assert!(
            resolve_route(&request, &route, &semaphore, &client())
                .await
                .unwrap()
                .is_none()
        );
        queued.await.unwrap();
        assert_eq!(handle.await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn discovery_can_be_canceled_while_waiting_for_resources() {
        let mut request = DownloadRequest::new(
            "https://mod-download.starlight.cool/starlight/mod/packs/files/4/hash",
            ResourceClass::Modpack,
        );
        let cancellation = tokio_util::sync::CancellationToken::new();
        cancellation.cancel();
        request.cancellation = Some(cancellation);
        let semaphore = FetchSemaphore(tokio::sync::Semaphore::new(0));
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            resolve_request(request, &semaphore),
        )
        .await
        .unwrap();
        assert!(result.unwrap_err().to_string().contains("canceled"));
    }

    #[tokio::test]
    async fn discovery_retries_transient_failures_and_honors_retry_after() {
        let target = "https://cdn.modrinth.com/data/p/versions/v/mod.jar";
        let (base, handle) = server(vec![
            "HTTP/1.1 503 Service Unavailable\r\nRetry-After: 0\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
            "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
            redirect(target),
        ]).await;
        let request = DownloadRequest::new(&base, ResourceClass::Other);
        let route = official_route(&base, ResourceClass::Other);
        let started = std::time::Instant::now();
        let resolved = discover_redirect(&request, &route, &client())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(resolved.as_str(), target);
        assert!(started.elapsed() >= std::time::Duration::from_secs(1));
        assert_eq!(handle.await.unwrap().len(), 3);
    }
}

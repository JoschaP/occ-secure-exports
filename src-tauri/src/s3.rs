//! S3 access: build a client from a profile, list objects, stream a GET body.
//!
//! Works against AWS, MinIO, IONOS and Ceph. `force_path_style` is required for
//! MinIO/Ceph where virtual-hosted-style buckets are not available.

use aws_config::BehaviorVersion;
use aws_sdk_s3::config::{Credentials, Region};
use aws_sdk_s3::Client;
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::profile::ConnectionProfile;

/// One object as shown in the explorer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectInfo {
    /// Full object key.
    pub key: String,
    /// Size in bytes.
    pub size: u64,
    /// Last-modified as RFC 3339, if known.
    pub last_modified: Option<String>,
}

/// Build an S3 client for the given profile and secret access key.
pub async fn build_client(profile: &ConnectionProfile, secret_access_key: &str) -> AppResult<Client> {
    if profile.endpoint.trim().is_empty() {
        return Err(AppError::Config("The endpoint URL is empty.".into()));
    }

    let credentials = Credentials::new(
        profile.access_key_id.clone(),
        secret_access_key.to_string(),
        None,
        None,
        "occ-companion",
    );

    let region = Region::new(if profile.region.trim().is_empty() {
        "us-east-1".to_string()
    } else {
        profile.region.clone()
    });

    let shared = aws_config::defaults(BehaviorVersion::latest())
        .region(region)
        .credentials_provider(credentials)
        .endpoint_url(profile.endpoint.clone())
        .load()
        .await;

    let conf = aws_sdk_s3::config::Builder::from(&shared)
        .force_path_style(profile.path_style)
        .build();

    Ok(Client::from_conf(conf))
}

/// List every object under `prefix` (paginated, follows continuation tokens).
pub async fn list_objects(
    client: &Client,
    bucket: &str,
    prefix: &str,
) -> AppResult<Vec<ObjectInfo>> {
    let mut out = Vec::new();
    let mut paginator = client
        .list_objects_v2()
        .bucket(bucket)
        .set_prefix(if prefix.is_empty() {
            None
        } else {
            Some(prefix.to_string())
        })
        .into_paginator()
        .send();

    while let Some(page) = paginator.next().await {
        let page = page.map_err(|e| AppError::S3(format!("Could not list the bucket: {}", service_msg(&e))))?;
        for obj in page.contents() {
            let Some(key) = obj.key() else { continue };
            // Skip "directory marker" zero-byte keys ending in '/'.
            if key.ends_with('/') {
                continue;
            }
            out.push(ObjectInfo {
                key: key.to_string(),
                size: obj.size().unwrap_or(0).max(0) as u64,
                last_modified: obj.last_modified().and_then(|t| t.fmt(aws_smithy_types::date_time::Format::DateTime).ok()),
            });
        }
    }

    Ok(out)
}

/// Pull a short, human-readable message out of an SDK error.
pub(crate) fn service_msg<E: std::error::Error>(e: &E) -> String {
    let mut msg = e.to_string();
    let mut source = e.source();
    while let Some(s) = source {
        msg = s.to_string();
        source = s.source();
    }
    msg
}

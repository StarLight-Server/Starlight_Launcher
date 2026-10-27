use semver::Version;

pub fn requires_update(current: &Version, target: &Version) -> bool {
    current != target
}

pub fn is_rollback(current: &Version, target: &Version) -> bool {
    requires_update(current, target) && !is_remote_newer(current, target)
}

pub struct UpdateTarget<T> {
    target: Option<String>,
    check_revision: u64,
    pub pending: Option<T>,
}

impl<T> Default for UpdateTarget<T> {
    fn default() -> Self {
        Self {
            target: None,
            check_revision: 0,
            pending: None,
        }
    }
}

impl<T> UpdateTarget<T> {
    pub fn begin_check(&mut self) -> u64 {
        self.check_revision = self.check_revision.wrapping_add(1);
        self.check_revision
    }

    pub fn select_checked(
        &mut self,
        revision: u64,
        version: Option<&str>,
    ) -> bool {
        if revision != self.check_revision {
            return false;
        }
        self.select(version);
        true
    }

    pub fn select(&mut self, version: Option<&str>) {
        if self.target.as_deref() != version {
            self.target = version.map(str::to_owned);
            self.pending = None;
        }
    }

    pub fn is_selected(&self, version: &str) -> bool {
        self.target.as_deref() == Some(version)
    }

    pub fn enqueue(&mut self, version: &str, download: T) -> bool {
        if !self.is_selected(version) {
            return false;
        }
        self.pending = Some(download);
        true
    }
}

// semver compares prerelease identifiers lexically, so "beta10" < "beta9"
// (because the character '1' sorts before '9'). Our release names use a
// "betaN" scheme where N is a decimal counter, so a strict lexical compare
// would wrongly report an older beta as the latest. Use a comparator that
// treats the trailing digits of a prerelease identifier numerically.
pub fn is_remote_newer(current: &Version, remote: &Version) -> bool {
    use std::cmp::Ordering;

    let core = (remote.major, remote.minor, remote.patch).cmp(&(
        current.major,
        current.minor,
        current.patch,
    ));
    if core != Ordering::Equal {
        return core == Ordering::Greater;
    }

    // Same x.y.z. A final release outranks any prerelease of that version.
    match (current.pre.is_empty(), remote.pre.is_empty()) {
        (true, true) => false,
        (true, false) => false,
        (false, true) => true,
        (false, false) => {
            compare_prerelease(remote.pre.as_str(), current.pre.as_str())
                == Ordering::Greater
        }
    }
}

/// Split a prerelease identifier into its non-digit prefix and an optional
/// trailing decimal number (so "beta10" -> ("beta", Some(10))).
fn split_prerelease_identifier(segment: &str) -> (&str, Option<u64>) {
    let digit_start = segment
        .char_indices()
        .find(|(_, c)| c.is_ascii_digit())
        .map(|(i, _)| i);
    match digit_start {
        Some(i) => (&segment[..i], segment[i..].parse::<u64>().ok()),
        None => (segment, None),
    }
}

/// Compare two prerelease strings, treating a trailing run of ASCII digits
/// as a decimal number (so "beta10" > "beta9"). All other segments fall back
/// to a plain lexical comparison.
fn compare_prerelease(left: &str, right: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;

    let left_segments: Vec<&str> = left.split('.').collect();
    let right_segments: Vec<&str> = right.split('.').collect();

    for (l, r) in left_segments.iter().zip(right_segments.iter()) {
        let (l_prefix, l_num) = split_prerelease_identifier(l);
        let (r_prefix, r_num) = split_prerelease_identifier(r);

        match (l_num, r_num) {
            (Some(ln), Some(rn)) if l_prefix == r_prefix => match ln.cmp(&rn) {
                Ordering::Equal => continue,
                other => return other,
            },
            _ => {
                let prefix_cmp = l_prefix.cmp(r_prefix);
                if prefix_cmp != Ordering::Equal {
                    return prefix_cmp;
                }
                let num_cmp = l_num.cmp(&r_num);
                if num_cmp != Ordering::Equal {
                    return num_cmp;
                }
            }
        }
    }

    left_segments.len().cmp(&right_segments.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use semver::Version;

    fn version(value: &str) -> Version {
        Version::parse(value).unwrap()
    }

    #[test]
    fn follows_the_server_target_in_both_directions() {
        for (current, target) in [
            ("1.0.2-beta12", "1.0.2-beta9"),
            ("1.0.2-beta9", "1.0.2-beta12"),
            ("1.2.0", "1.1.0"),
            ("1.1.0", "1.2.0"),
            ("1.1.0", "1.1.0-beta1"),
        ] {
            assert!(requires_update(&version(current), &version(target)));
        }
        assert!(!requires_update(
            &version("1.0.2-beta12"),
            &version("1.0.2-beta12")
        ));
    }

    #[test]
    fn rollback_direction_uses_numeric_beta_suffixes() {
        assert!(is_rollback(
            &version("1.0.2-beta12"),
            &version("1.0.2-beta9")
        ));
        assert!(!is_rollback(
            &version("1.0.2-beta9"),
            &version("1.0.2-beta12")
        ));
        assert!(is_rollback(&version("1.2.0"), &version("1.1.0")));
        assert!(!is_rollback(&version("1.1.0"), &version("1.2.0")));
        assert!(!is_rollback(&version("1.2.0"), &version("1.2.0")));
    }

    #[test]
    fn a_final_release_outranks_the_matching_prerelease() {
        // Graduation: the release channel's final version is newer than the
        // beta channel's prerelease of the same x.y.z.
        assert!(is_remote_newer(&version("1.0.2-beta16"), &version("1.0.2")));
        assert!(!is_remote_newer(
            &version("1.0.2"),
            &version("1.0.2-beta16")
        ));
        // A final release of an older x.y.z does not graduate a newer beta.
        assert!(!is_remote_newer(
            &version("1.0.2-beta16"),
            &version("1.0.1")
        ));
        // Beta-to-beta comparisons still use the numeric suffix rule.
        assert!(is_remote_newer(
            &version("1.0.2-beta9"),
            &version("1.0.2-beta16")
        ));
        assert!(!is_remote_newer(
            &version("1.0.2-beta16"),
            &version("1.0.2-beta16")
        ));
        // A newer prerelease of a future x.y.z outranks the final release.
        assert!(is_remote_newer(&version("1.0.2"), &version("1.0.3-beta1")));
    }

    #[test]
    fn changing_the_target_discards_an_already_downloaded_update() {
        let mut state = UpdateTarget::default();
        state.select(Some("1.0.2-beta12"));
        assert!(state.enqueue("1.0.2-beta12", "new installer"));
        state.select(Some("1.0.2-beta9"));
        assert!(state.pending.is_none());
        assert!(state.enqueue("1.0.2-beta9", "rollback installer"));
        assert_eq!(state.pending, Some("rollback installer"));
    }

    #[test]
    fn a_stale_download_cannot_replace_the_selected_rollback() {
        let mut state = UpdateTarget::default();
        state.select(Some("1.0.2-beta12"));
        state.select(Some("1.0.2-beta9"));
        assert!(state.enqueue("1.0.2-beta9", "rollback installer"));
        assert!(!state.enqueue("1.0.2-beta12", "late installer"));
        assert_eq!(state.pending, Some("rollback installer"));
    }

    #[test]
    fn late_checks_cannot_reauthorize_a_superseded_version() {
        let mut state = UpdateTarget::default();
        let old_check = state.begin_check();
        let rollback_check = state.begin_check();
        assert!(state.select_checked(rollback_check, Some("1.0.2-beta9")));
        assert!(state.enqueue("1.0.2-beta9", "rollback installer"));
        assert!(!state.select_checked(old_check, Some("1.0.2-beta12")));
        assert!(!state.enqueue("1.0.2-beta12", "late installer"));
        assert_eq!(state.pending, Some("rollback installer"));
    }

    #[test]
    fn repeated_checks_preserve_the_matching_download_and_no_update_clears_it()
    {
        let mut state = UpdateTarget::default();
        state.select(Some("1.0.2-beta9"));
        state.enqueue("1.0.2-beta9", "rollback installer");
        state.select(Some("1.0.2-beta9"));
        assert_eq!(state.pending, Some("rollback installer"));
        state.select(None);
        assert!(state.pending.is_none());
        assert!(!state.enqueue("1.0.2-beta9", "late installer"));
    }
}

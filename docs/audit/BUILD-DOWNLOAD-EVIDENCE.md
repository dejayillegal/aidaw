# Gradle distribution download hardening

Initial runtime candidate4061a93e89f3512b37dbb5a3a822664abfc78f98 passed application/browser/audio checks on PR CI41998745260 attempt1, but failed before Android compilation: Gradle8.14.3-all.zip redirect returned HTTP504. Push CI41998725575 separately timed out reading the distribution with networkTimeout10000ms. These are download/environment failures, not evidence of an Android compiler or application failure. The failed results remain part of the evidence.

Small follow-up: retain Gradle8.14.3 and the existing verified wrapper JAR, choose its binary-only distribution (build execution does not require bundled sources/docs), increase network timeout to60000ms, and pin distributionSha256Sum. No validation, signing, version identity or browser gate is bypassed. No new retry property from newer Gradle versions is assumed supported.

Official sources checked November5,2026:

- https://gradle.org/release-checksums/ lists8.14.3 bin SHA256 `bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531` and wrapper JAR `7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172`.
- https://services.gradle.org/distributions/gradle-8.14.3-bin.zip.sha256 independently returned the same bin digest via Python urllib HTTPS.
- https://docs.gradle.org/current/userguide/gradle_wrapper.html documents binary/all distributions, network timeout and distributionSha256Sum. The existing wrapper already recognizes networkTimeout.

Local sha256sum of android/gradle/wrapper/gradle-wrapper.jar matches the official digest. `bash android/gradlew --version` initially cannot access the distribution from the local Java process (Network is unreachable). This local limitation does not qualify an APK. Final clean SDK/Java21 CI must execute checksum-verified download, assembly and APK validation; exact final run and APK checksum belong on the PR. Persistent upstream outage remains BLOCKED; it is never converted to a PASS or ignored exit status. Rollback this properties change alone if necessary; no project/schema migration or signing change.

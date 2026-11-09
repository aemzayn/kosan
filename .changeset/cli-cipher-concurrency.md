---
"@kosan/cli": minor
---

- New `cipher` config option: `kosan migrate` decrypts stored tenant passwords before connecting (it previously sent the ciphertext).
- `concurrency` from the config file is now honoured when `--concurrency` is not passed.
- Config loading validates fields instead of casting, and reports a malformed `cipher`.
- A tenant whose database cannot be reached (bad credentials, DB down, decrypt failure) is now reported as `failed` instead of aborting the whole `kosan migrate` run.
- `concurrency` in the config file must be a positive integer; invalid values are rejected instead of silently starting zero workers.

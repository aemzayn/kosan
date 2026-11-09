---
"@kosan/cli": minor
---

- New `cipher` config option: `kosan migrate` decrypts stored tenant passwords before connecting (it previously sent the ciphertext).
- `concurrency` from the config file is now honoured when `--concurrency` is not passed.
- Config loading validates fields instead of casting, and reports a malformed `cipher`.

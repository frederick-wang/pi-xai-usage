# Snapshots and alerts are scoped by account fingerprint

Two SuperGrok logins share provider id `xai` and can share period timestamps. JSONL snapshots and alert dedup keyed only by provider would splice accounts. Each snapshot carries a non-reversible fingerprint of the proxy `userId`. Rate estimates and alert re-arm require the same fingerprint and the same period identity (`currentPeriod.start` + `end`). The fingerprint is not reversible to the `userId`; the raw id never enters the file.

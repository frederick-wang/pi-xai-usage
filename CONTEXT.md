# pi-xai-usage

A pi coding agent extension that surfaces xAI SuperGrok / X Premium consumer-subscription usage in the agent UI while the `xai` provider is active.

## Language

**Plan provider**:
The pi provider id `xai`. The only provider this extension activates on.
_Avoid_: grok-build, xai-auth, Grok CLI provider

**Included allowance**:
The consumer subscription pool reported as `creditUsagePercent` (used percent, 0–100), or as legacy `used` / `monthlyLimit` cents when the percent is absent.
_Avoid_: quota remaining, credits left, RPM, API team billing

**On-demand usage**:
USD spend against an optional on-demand cap (`onDemandUsed` / `onDemandCap` cent wrappers). Distinct from the included allowance.
_Avoid_: extra credits, overage (unless the payload uses that word)

**Prepaid balance**:
USD prepaid amount (`prepaidBalance` cent wrapper). Distinct from included allowance and on-demand usage.
_Avoid_: account balance (DeepSeek), wallet

**Quota window**:
The current included-allowance period (`currentPeriod`), weekly or monthly when `type` says so, otherwise unknown.
_Avoid_: 5h window, rate-limit window, token window

**Snapshot**:
One successful billing reading: included used percent, period identity, reset time, and the account fingerprint it belongs to.
_Avoid_: cache entry, reading

**Stale**:
A snapshot kept after a failed refresh, marked in the footer rather than discarded.
_Avoid_: expired, invalid

**Reset time**:
`currentPeriod.end` (else `billingPeriodEnd`) as epoch milliseconds, shown as a local countdown.
_Avoid_: expiry, deadline

**Plan tier**:
Sanitized `subscriptionTier` string (e.g. SuperGrok). Never taken from user identity fields.
_Avoid_: plan type, productUsage

**Account fingerprint**:
A non-reversible digest of the proxy `userId`, used only to scope snapshots and alerts. The `userId` itself is never displayed or persisted.
_Avoid_: user id, account id, email

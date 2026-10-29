# Fork notes: LTE quota + host balancer

Additions on top of [remnawave/backend](https://github.com/remnawave/backend) v3.4.7.
Licensed under **AGPL-3.0-only**, same as upstream (see `LICENCE`). If you run a modified
version as a network service you must offer its source to the users of that service.

Everything is additive: two new tables, one new module, one new scheduler task and a
two-line hook in `SubscriptionService`. No upstream model, DTO or contract is changed, so
rebasing on upstream stays cheap.

## What already exists upstream (not re-implemented)

- Auto status `LIMITED` / `EXPIRED` by traffic limit and expiry (users watchdog).
- HWID device limits and `hwid_user_devices`.
- Node health (`isConnected`, `isDisabled`) and host `shuffleHost` / `randomizeHosts`.

## 1. Separate LTE traffic quota

- A node is "LTE" when `node_balancer_settings.is_lte = true`.
- Traffic through LTE nodes is added to `lte_user_quota.used_bytes` and **not** to the user's
  main `used_traffic_bytes` (lifetime / online counters stay shared).
- `lte_user_quota.limit_bytes = 0` means unlimited (same convention as upstream).
- Reset strategy per user: `NO_RESET | DAY | WEEK | MONTH` (cron reuses upstream expressions).

### Enforcement (needs one-time setup)

Access is revoked the way the panel already does it: by squad membership.

1. Create a config profile whose inbounds live on your LTE nodes and an **internal squad**
   that contains those inbounds. Attach your LTE hosts to that squad.
2. Put the squad UUID into `LTE_INTERNAL_SQUAD_UUID` and add the users who may use LTE to it.
3. When a user exhausts the quota the task (every 30 s) removes them from that squad and
   publishes `AddUsersToNodeEvent`, so nodes drop the user. After a reset or a raised limit
   they are added back automatically.

Without `LTE_INTERNAL_SQUAD_UUID` usage is still counted, but nobody is cut off (a warning
is logged at startup).

### Admin API (ADMIN role only, not available to API tokens)

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/lte-quota/users/:username` | |
| PUT | `/api/lte-quota/users/:username` | `{ "limitBytes": "107374182400", "resetStrategy": "MONTH" }` |
| POST | `/api/lte-quota/users/:username/reset` | |
| GET | `/api/lte-quota/nodes` | |
| PUT | `/api/lte-quota/nodes/:uuid` | `{ "isLte": true, "weight": 100, "maxOnline": null }` |

## 2. Host balancer

Opt-in via host tag **`LB`**. In every subscription:

- `LB` hosts are re-ordered **inside the positions the `LB` hosts already occupy**; other hosts
  keep their place.
- Order is ascending by `online users / weight` of the best usable node behind the host
  (±10 % jitter so identical nodes share users).
- Hosts whose nodes are down, disabled, connecting or over `max_online` move to the end
  (fallback order) instead of being dropped.
- Online = `user_traffic.online_at` within `BALANCER_ONLINE_WINDOW_SECONDS` (default 300).
- State is cached for 5 s; a DB error leaves the original order untouched.
- Has no effect when `randomizeHosts` is enabled in subscription settings (shuffle wins).

## Configuration

```
LTE_INTERNAL_SQUAD_UUID=          # empty = no cut-off
BALANCER_ONLINE_WINDOW_SECONDS=300
```

## Not covered / known limits

- No UI: nodes and quotas are managed through the admin API above.
- Balancing is per subscription request; it does not move already connected clients.
- A user who is manually removed from the LTE squad while blocked is added back on restore.

# Velvet Link Panel

Velvet Link Panel is a panel for creating client configurations and serving them through
subscription links. It is a fork of [Remnawave Backend](https://github.com/remnawave/backend)
3.4.11 with two additions: a separate traffic quota for LTE nodes and load-aware host ordering
in subscriptions.

Client apps, including Velvet Link App, connect to the panel by a subscription link.

## Components

| Component | Source |
|---|---|
| Backend | this repository |
| Frontend | standard Remnawave |
| Node | standard Remnawave |
| Subscription page | standard Remnawave |

## Features

Standard Remnawave features, unchanged:

- users, internal squads, config profiles and hosts;
- subscription links for client apps;
- device limits by HWID;
- automatic `LIMITED` / `EXPIRED` status when the traffic limit or the expiry date is reached.

Added in this fork:

- **LTE quota.** Traffic through LTE nodes is counted separately from the main quota, with its
  own limit and reset period per user.
- **Host balancer.** Hosts tagged `LB` are ordered in every subscription by the load of their
  nodes. Hosts on unavailable or full nodes move to the end of the list.

The full fork description is in [FORK.md](FORK.md).

## LTE quota

- A node becomes an LTE node through the admin API (`isLte: true`).
- Traffic through LTE nodes goes to the user's LTE counter. The main traffic counter does not
  grow.
- Each user has an LTE limit in bytes (`0` means unlimited) and a reset period: `DAY`, `WEEK`,
  `MONTH` or `NO_RESET`.
- A user who has used up the LTE limit is removed from the LTE internal squad, and the nodes stop
  accepting that user. Squad membership is the standard Remnawave access mechanism.
- After a reset or a raised limit the user returns to the squad automatically.
- The check runs every 30 seconds.

### Setup

1. Create a config profile with inbounds on the LTE nodes and an internal squad with those
   inbounds. Attach the LTE hosts to this squad.
2. Set `LTE_INTERNAL_SQUAD_UUID` to the squad UUID.
3. Add the users who are allowed to use LTE to the squad.
4. Mark the LTE nodes with `PUT /api/lte-quota/nodes/:uuid`.

Without `LTE_INTERNAL_SQUAD_UUID` the panel counts LTE traffic but does not cut anyone off.

## Host balancer

- Works only for hosts tagged `LB`. Other hosts keep their positions in the subscription.
- `LB` hosts are reordered within the positions they already occupy, lowest load first. The
  load of a host is `online users / weight` of its least loaded available node.
- A user counts as online for `BALANCER_ONLINE_WINDOW_SECONDS` after the last activity.
- Hosts whose nodes are all down, disabled, connecting or over `maxOnline` go to the end of the
  list and stay available as fallback.
- `weight` and `maxOnline` are set per node.
- On a database error the original order is kept.
- When `randomizeHosts` is enabled in the subscription settings, the panel shuffles hosts and
  the balancer does not apply.

## Configuration

Fork variables, in addition to the standard Remnawave `.env`:

| Variable | Default | Description |
|---|---|---|
| `LTE_INTERNAL_SQUAD_UUID` | empty | Internal squad that grants access to LTE nodes. Empty disables the cutoff. |
| `BALANCER_ONLINE_WINDOW_SECONDS` | `300` | Seconds a user counts as online for the host balancer. |

## Admin API

Fork endpoints live under `/api/lte-quota` and require the `ADMIN` role. API tokens have no
access to them.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/lte-quota/users/:username` | LTE quota of a user |
| `PUT` | `/api/lte-quota/users/:username` | Set limit and reset period |
| `POST` | `/api/lte-quota/users/:username/reset` | Reset used LTE traffic |
| `GET` | `/api/lte-quota/nodes` | LTE flag, weight and online limit of all nodes |
| `PUT` | `/api/lte-quota/nodes/:uuid` | Set LTE flag, weight and online limit of a node |

Get an admin token:

```bash
curl -X POST https://panel.example.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "username": "admin", "password": "<password>" }'
```

The token is in `response.accessToken`.

Set a monthly 100 GB LTE limit:

```bash
curl -X PUT https://panel.example.com/api/lte-quota/users/<username> \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{ "limitBytes": "107374182400", "resetStrategy": "MONTH" }'
```

`limitBytes` is passed as a string so that values above 2^53 survive JSON.

Mark a node as LTE and set its balancer parameters:

```bash
curl -X PUT https://panel.example.com/api/lte-quota/nodes/<node-uuid> \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{ "isLte": true, "weight": 100, "maxOnline": 500 }'
```

`weight` is from 1 to 10000, default 100. `maxOnline: null` means no online limit.

## Running

- Development: see [DEVELOPMENT.md](DEVELOPMENT.md).
- Production: build the image from this repository's `Dockerfile` and use it instead of
  `remnawave/backend` in `docker-compose-prod.yml`. Migrations are applied on container start.

## Notes

- The fork adds two tables (`lte_user_quota`, `node_balancer_settings`) and does not change
  upstream models, DTOs or API contracts.
- There is no UI for the fork features. LTE quotas and node settings are managed through the
  admin API.
- The balancer orders hosts when a subscription is requested. Clients that are already
  connected stay on their node.

## License

[AGPL-3.0](LICENCE), same as Remnawave. Anyone who runs a modified version as a network service
must offer its source code to the users of that service.

Velvet Link Panel is built on [Remnawave](https://docs.rw/). Thanks to the Remnawave
[contributors](https://github.com/remnawave/backend/graphs/contributors).

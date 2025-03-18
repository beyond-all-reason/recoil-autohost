# Recoil Autohost

Starts [Recoil] engine dedicated game servers as-a-service over the [Tachyon] protocol.

```mermaid
---
title: Whole system view
---
graph LR
  subgraph player's machine
    lobby --> engine
  end

  lobby-server <-- tachyon protocol --> autohost
  lobby-server <-- tachyon protocol --> lobby

  subgraph game server
    autohost <-- engine autohost protocol --> engine-dedicated
    engine-dedicated <-- engine protocol --> engine
  end

  style autohost stroke-width:2px,stroke-dasharray:4,stroke:#ee4444
```

## Overview

This repo contain the Autohost service as defined in the [Tachyon] protocol
definition. The service connects to the configured lobby server endpoint and
allows lobby to start new battles. A single Autohost service can manage many
battles in parallel. The autohost then facilitates communication between the
running dedicated [Recoil] engine processes and lobby server (for example
[Teiserver]): messages, commands, game updates.

Currently the service implements fully the Tachyon Autohost endpoints but isn't
yet fully ready for production deployments.

## Usage

Autohost takes a single JSON configuration file as argument and starts the
operation:

```shell
npm install
npm run start config.json | npx pino-pretty
```

A minimal configuration file looks like:

<!-- prettier-ignore -->
```json
{
  "tachyonServer": "lobby-server.example.com",
  "authClientId": "autohost1",
  "authClientSecret": "pass1",
  "hostingIP": "123.123.123.123"
}
```

To see all options take a look at schema in [`src/config.ts`](./src/config.ts).

Autohost expects existence of `engines` folder that contains folder with
different engine versions, for example:

```console
$ tree engines -L 1
engines
├── 105.1.1-2590-gb9462a0 BAR105
└── local -> ../../spring/build-linux/install
```

During execution, autohost creates a new directory for each started battle
under `instances` directory, for example `instances/5a7b1354-e3ff-4a98-946e-9bece3b869a3/`.

## Development

### Git hooks

It is recommended to set up a simple [Git pre-commit hook](https://git-scm.com/book/ms/v2/Customizing-Git-Git-Hooks)
provided in the repo ([`pre-commit`](./pre-commit)) that runs automatic checks
on changes in every new commit: formatting type-checking, tests, linting.

```shell
ln -s ../../pre-commit .git/hooks/pre-commit
```

### Testing with tachyon server fake

This repository contains a minimal bare bones implementation of Tachyon lobby
server: [`src/tachyonServer.fake.ts`](./src/tachyonServer.fake.ts) that can be
used to test full end to end behavior of autohost without running real server.

To start the service run

```
npm run start-tachyon-fake | npx pino-pretty
```

The service will listen for autohost on port 8084 and [`config.dev.json`](./config.dev.json)
contains the config that will make autohost connect to it:

```
npm run start config.dev.json | npx pino-pretty
```

The fake prints all tachyon messages it receives and sends JSON messages it
gets via HTTP to the connected autohost. See below example session to see how
`autohost/subscribeUpdates` and `autohost/start` are send to first connected
autohost.

#### Example session

1. Set up BAR checkout as described in the main game repository
   https://github.com/beyond-all-reason/Beyond-All-Reason.
2. Make sure you have "Quicksilver Remake 1.24" map installed.
3. Fetch engine

    ```shell
    curl -L https://github.com/beyond-all-reason/spring/releases/download/spring_bar_%7BBAR105%7D105.1.1-2590-gb9462a0/spring_bar_.BAR105.105.1.1-2590-gb9462a0_linux-64-minimal-portable.7z -o engine.7z
    7z x engine.7z -o'engines/105.1.1-2590-gb9462a0 BAR105'
    ```

4. Start tachyon fake and autohost as described above.
5. Subscribe to all updates from autohost.

    ```shell
    printf '{"since":%d}' $(date '+%s%6N') | curl --json @- http://127.0.0.1:8084/request/0/subscribeUpdates
    ```

6. Create a simple start script request in `start.json`:

    <!-- prettier-ignore -->
    ```json
    {
      "battleId": null,
      "engineVersion": "105.1.1-2590-gb9462a0 BAR105",
      "gameName": "Beyond All Reason $VERSION",
      "mapName": "Quicksilver Remake 1.24",
      "startPosType": "ingame",
      "allyTeams": [{
        "startBox": { "top": 0, "bottom": 0.3, "left": 0, "right": 1 },
        "teams": [{
          "faction": "Cortex",
          "bots": [{
            "aiShortName": "BARb",
            "aiVersion": "stable",
            "hostUserId": "11111"
          }]
        }]
      }, {
        "startBox": { "top": 0.7, "bottom": 1, "left": 0, "right": 1 },
        "teams": [{
          "faction": "Armada",
          "players": [{
            "userId": "11111",
            "name": "Player",
            "password": "password1"
          }]
        }]
      }]
    }
    ```

7. Start the engine dedicated in autohost:

    ```shell
    jq ".battleId = \"$(uuidgen -r)\"" start.json | curl --json @- http://127.0.0.1:8084/request/0/start
    ```

8. Join the game yourself, using the port that will be printed on the tachyon
   server fake output and user name and password from `start.json`:

    ```shell
    ./engines/105.1.1-2590-gb9462a0\ BAR105/spring --isolation --write-dir "{absolute path to your data folder}""  spring://Player:password1@127.0.0.1:20001
    ```

> [!NOTE]
> Until [a fix](https://github.com/beyond-all-reason/spring/pull/1876) gets
> released in some of the future engine version, you have only 30s between
> autohost starts the game and you connect to it.

### Running the Test Case with Docker

The repository includes a test case script that automates the example session above using Docker. This provides a consistent environment for testing the autohost service.

For detailed information about the test case, including prerequisites, configuration, and troubleshooting, see the [Test Case Documentation](./testcase/README.md).

#### Prerequisites

1. Docker installed on your system
2. Required system packages:
   ```bash
   # For Ubuntu/Debian
   sudo apt-get update
   sudo apt-get install -y p7zip-full curl jq uuid-runtime
   ```

#### Running the Test

1. Navigate to the project root directory:
   ```bash
   cd /path/to/recoil-autohost
   ```

2. Run the test script:
   ```bash
   ./testcase/testcase_run.sh
   ```

The script will:
- Create necessary directories
- Download and extract the required engine version
- Start the Docker services
- Subscribe to updates
- Start a test battle
- Provide instructions for joining the game

To view logs while the test is running:
```bash
docker compose logs -f
```

To stop the test environment, press Ctrl+C. The script will automatically clean up all resources.

[Recoil]: https://github.com/beyond-all-reason/spring
[Tachyon]: https://github.com/beyond-all-reason/tachyon
[Teiserver]: https://github.com/beyond-all-reason/teiserver

# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Write to **hello@myradostudio.com** with a description, the affected version and, if you can, steps to reproduce.

Never include a real API key, a phone number or tracking data of a real parcel in a report. If a key has been exposed, replace it in your Nova Poshta business cabinet.

## Supported versions

Only the latest published version receives fixes.

## What the server does with your data

- The API key (`NOVAPOSHTA_API_KEY`), when you set one, is read from an environment variable and sent only to the API origin in `NOVAPOSHTA_API_URL` (by default `https://api.novaposhta.ua`), in the body of each request, as the API requires. Plain `http://` is refused for anything but localhost.
- Nothing is written to disk. stderr receives startup messages and the type of a transport error; requests, responses, the key, waybill numbers and phone numbers are never logged. There is no telemetry.
- Tool results go to the MCP client and from there to the AI model you use.

## Things to keep in mind

- The server is read-only: it calls seven lookup and calculation methods and refuses any other. A personal API key, however, is not read-only at Nova Poshta: the same key can create and delete waybills in other programs. Treat it accordingly.
- A waybill number together with the phone number of the sender or the recipient opens the names, phones and addresses of both. `track_parcels` passes them to the model only when a phone number is given.
- Your MCP client stores the environment variables you give it, usually in a plain-text configuration file. Protect that file like any other credential store.
- Text that comes from Nova Poshta (descriptions of cargo, names) is passed to the model unchanged and can carry prompt-injection attempts: the description of a parcel is written by its sender.
- This is an unofficial project. It is not affiliated with or endorsed by Nova Poshta.
